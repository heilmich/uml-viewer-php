import {
  realpath,
  readdir,
  readFile,
  mkdir,
  writeFile,
  rename,
  rm,
} from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import {
  policySchema,
  snapshotSchema,
  proposalSchema,
  type Snapshot,
  type Policy,
  type Proposal,
  type SourceFile,
  type LanguageAdapter,
  edgeId,
} from '../core/model.js';
import { applyPolicy, importLegacyGraph } from '../core/graph.js';
import { migrateProposals, attachMetrics } from '../core/migration.js';
import { readEdn } from '../core/edn.js';
import { phpAdapter } from '../languages/php.js';
import {
  pythonAdapter,
  rustAdapter,
  clojureAdapter,
} from '../languages/modules.js';
import { polyglotAdapter } from '../languages/polyglot.js';
import { typescriptAdapter } from '../languages/typescript.js';
export const adapters = new Map<string, LanguageAdapter>([
  ['php', phpAdapter],
  ['polyglot', polyglotAdapter],
  ['python', pythonAdapter],
  ['rust', rustAdapter],
  ['clojure', clojureAdapter],
  ['typescript', typescriptAdapter],
  ['javascript', { ...typescriptAdapter, id: 'javascript' }],
]);
export function registerAdapter(adapter: LanguageAdapter) {
  if (adapters.has(adapter.id))
    throw Error('Adapter already registered: ' + adapter.id);
  adapters.set(adapter.id, adapter);
}
const hash = (s: string) => createHash('sha256').update(s).digest('hex');
const skip = new Set([
  'vendor',
  'node_modules',
  'tests',
  'test',
  'var',
  'cache',
  'build',
  'dist',
  'target',
  '__pycache__',
  'coverage',
  'venv',
  'site-packages',
  '__pypackages__',
]);
export async function confined(root: string, file: string) {
  const canonical = await realpath(path.resolve(root, file));
  const relative = path.relative(root, canonical);
  if (
    relative === '..' ||
    relative.startsWith('..' + path.sep) ||
    path.isAbsolute(relative)
  )
    throw Error('Path outside project root');
  return canonical;
}
export async function sourceFiles(
  root: string,
  adapter: LanguageAdapter,
  policy: Policy,
): Promise<SourceFile[]> {
  const out: SourceFile[] = [];
  const seen = new Set<string>();
  async function walk(dir: string) {
    const actual = await confined(root, dir);
    if (seen.has(actual)) return;
    seen.add(actual);
    for (const e of (await readdir(actual, { withFileTypes: true })).sort(
      (a, b) => a.name.localeCompare(b.name),
    )) {
      const abs = path.join(actual, e.name),
        rel = path.relative(root, abs).replaceAll(path.sep, '/');
      if (
        e.name.startsWith('.') ||
        skip.has(e.name.toLowerCase()) ||
        policy.excludes.some((x) => rel === x || rel.startsWith(x + '/'))
      )
        continue;
      if (e.isSymbolicLink()) continue;
      if (e.isDirectory()) await walk(abs);
      else if (
        adapter.extensions.some((x) => e.name.endsWith(x)) &&
        !/Test\.php$|\.(?:test|spec)\.[cm]?[jt]sx?$|\.d\.ts$/.test(e.name)
      ) {
        const safe = await confined(root, abs);
        out.push({
          file: path.relative(root, safe).replaceAll(path.sep, '/'),
          code: await readFile(safe, 'utf8'),
        });
      }
    }
  }
  await walk(root);
  return out.sort((a, b) => a.file.localeCompare(b.file));
}
export class Conflict extends Error {
  constructor(public current: unknown) {
    super('Version conflict');
  }
}
export class Project {
  readonly id: string;
  readonly name: string;
  readonly dataDir: string;
  private constructor(readonly root: string) {
    this.id = hash(root).slice(0, 24);
    this.name = path.basename(root);
    this.dataDir = path.join(root, '.uml-viewer');
  }
  static async open(root: string) {
    return new Project(await realpath(root));
  }
  async init() {
    await mkdir(this.dataDir, { recursive: true });
    if ((await realpath(this.dataDir)) !== this.dataDir)
      throw Error('State directory must not be a symlink');
  }
  async loadConfig(): Promise<any> {
    try {
      const data = JSON.parse(
        await readFile(
          await confined(this.root, '.uml-viewer/config.json'),
          'utf8',
        ),
      );
      return data;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return {};
      throw e;
    }
  }
  async saveConfig(config: unknown) {
    await this.init();
    await this.atomic('config.json', config);
  }
  async atomic(name: string, value: unknown) {
    await this.init();
    const tmp = path.join(this.dataDir, `.${randomUUID()}.tmp`);
    try {
      await writeFile(tmp, JSON.stringify(value, null, 2) + '\n', {
        flag: 'wx',
      });
      await rename(tmp, path.join(this.dataDir, name));
    } finally {
      await rm(tmp, { force: true });
    }
  }
  async locked<T>(fn: () => Promise<T>): Promise<T> {
    await this.init();
    const lock = path.join(this.dataDir, 'write.lock');
    const deadline = Date.now() + 10000;
    for (;;) {
      try {
        await mkdir(lock);
        break;
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
        if (Date.now() > deadline)
          throw Error(
            'State is locked by another writer; remove write.lock only after confirming that writer has exited',
          );
        await delay(25);
      }
    }
    try {
      return await fn();
    } finally {
      await rm(lock, { recursive: true, force: true });
    }
  }
  async scan(
    options: { policy?: unknown; language?: string; save?: boolean } = {},
  ): Promise<Snapshot> {
    const started = performance.now(),
      config = await this.loadConfig(),
      policy = policySchema.parse(options.policy ?? config.policy ?? {}),
      language = options.language ?? config.language ?? 'php',
      adapter = adapters.get(language);
    if (!adapter)
      throw Error(
        `Unsupported language: ${language}. Registered: ${[...adapters.keys()].join(', ')}`,
      );
    if (language === 'rust' && !policy['lib-crate-name']) {
      try {
        const cargo = await readFile(
          await confined(this.root, 'Cargo.toml'),
          'utf8',
        );
        const section =
          cargo.match(/\[lib\]([\s\S]*?)(?:\n\[|$)/)?.[1] ??
          cargo.match(/\[package\]([\s\S]*?)(?:\n\[|$)/)?.[1] ??
          '';
        const name = section.match(/^name\s*=\s*"([^"]+)"/m)?.[1];
        if (name) policy['lib-crate-name'] = name.replaceAll('-', '_');
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
      }
    }
    const files = await sourceFiles(this.root, adapter, policy),
      raw = adapter.analyze(files, policy),
      graph = applyPolicy(raw.nodes, raw.edges, policy);
    let commit: string | null = null;
    try {
      commit = execFileSync('git', ['-C', this.root, 'rev-parse', 'HEAD'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
    } catch {}
    const fingerprint = hash(JSON.stringify(files)),
      createdAt = new Date().toISOString();
    const snapshot = snapshotSchema.parse({
      schemaVersion: 1,
      id: randomUUID(),
      project: { id: this.id, root: this.root, name: this.name },
      metadata: {
        analyzerVersion: '0.1.0',
        createdAt,
        commit,
        fingerprint,
        language,
        durationMs: Math.round((performance.now() - started) * 100) / 100,
        complete: !raw.diagnostics.some((d) => d.severity === 'error'),
        fileCount: files.length,
      },
      ...graph,
      diagnostics: raw.diagnostics,
      policy,
    });
    if (options.save !== false)
      await this.locked(async () => {
        try {
          const previous = await this.snapshot();
          if (language === 'php') {
            const identities = new Map(
              previous.nodes
                .filter((n) => n.lang === 'php' && n.ns)
                .map((n) => [n.ns!.toLowerCase(), n.id]),
            );
            const remap = new Map(
              snapshot.nodes.map((n) => [
                n.id,
                n.ns ? (identities.get(n.ns.toLowerCase()) ?? n.id) : n.id,
              ]),
            );
            snapshot.nodes = snapshot.nodes.map((n) => ({
              ...n,
              id: remap.get(n.id)!,
            }));
            snapshot.edges = snapshot.edges.map((e) => {
              const from = remap.get(e.from) ?? e.from,
                to = remap.get(e.to) ?? e.to;
              return { ...e, from, to, id: edgeId(from, to, e.kind, e.label) };
            });
          }
          snapshot.nodes = attachMetrics(snapshot.nodes, [
            { nodes: previous.nodes },
          ]);
        } catch (e) {
          if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
        }
        await this.atomic('snapshot.json', snapshot);
        await this.atomic('facts.json', raw.facts ?? {});
        if (!config.policyProposalsImported) {
          const proposals = migrateProposals(policy);
          if (proposals.length && !(await this.proposals()).length)
            await this.atomic(
              'proposals.json',
              await this.rememberImportedProposals(proposals),
            );
        }
        await this.atomic('config.json', {
          ...config,
          policy,
          language,
          policyProposalsImported: true,
        });
      });
    return snapshot;
  }
  async snapshot(id?: string) {
    const s = snapshotSchema.parse(
      JSON.parse(
        await readFile(
          await confined(this.root, '.uml-viewer/snapshot.json'),
          'utf8',
        ),
      ),
    );
    if (s.project.id !== this.id || s.project.root !== this.root)
      throw Error('Snapshot belongs to another project');
    if (id && s.id !== id) throw new Conflict({ snapshotId: s.id });
    return s;
  }
  async stale(snapshot: Snapshot) {
    const adapter = adapters.get(snapshot.metadata.language);
    if (!adapter) return true;
    return (
      hash(
        JSON.stringify(await sourceFiles(this.root, adapter, snapshot.policy)),
      ) !== snapshot.metadata.fingerprint
    );
  }
  async source(file: string) {
    return readFile(await confined(this.root, file), 'utf8');
  }
  async proposals(): Promise<Proposal[]> {
    await this.init();
    try {
      return proposalSchema
        .array()
        .parse(
          JSON.parse(
            await readFile(
              await confined(this.root, '.uml-viewer/proposals.json'),
              'utf8',
            ),
          ),
        );
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw e;
    }
  }
  private async proposalVersions(): Promise<Map<string, number>> {
    try {
      const input = JSON.parse(
        await readFile(
          await confined(this.root, '.uml-viewer/proposal-versions.json'),
          'utf8',
        ),
      );
      if (!input || typeof input !== 'object' || Array.isArray(input))
        throw Error('Invalid proposal revision registry');
      const entries = Object.entries(input);
      if (
        entries.some(
          ([, v]) => typeof v !== 'number' || !Number.isSafeInteger(v) || v < 0,
        )
      )
        throw Error('Invalid proposal revision registry');
      return new Map(entries as [string, number][]);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return new Map();
      throw e;
    }
  }
  private async rememberImportedProposals(proposals: Proposal[]) {
    const versions = await this.proposalVersions();
    const imported = proposals.map((p) => ({
      ...p,
      version: Math.max(p.version, (versions.get(p.id) ?? 0) + 1),
    }));
    for (const p of imported) versions.set(p.id, p.version);
    await this.atomic('proposal-versions.json', Object.fromEntries(versions));
    return imported;
  }
  async updateProposal(id: string, expectedVersion: number, input: unknown) {
    return this.locked(async () => {
      const all = await this.proposals(),
        current = all.find((p) => p.id === id);
      if ((current?.version ?? 0) !== expectedVersion)
        throw new Conflict(current ?? null);
      const versions = await this.proposalVersions();
      const proposal = proposalSchema.parse({
        ...(input as object),
        ...((input as { scope?: unknown })?.scope === undefined &&
        current?.scope !== undefined
          ? { scope: current.scope }
          : {}),
        schemaVersion: 1,
        id,
        version: Math.max(expectedVersion, versions.get(id) ?? 0) + 1,
      });
      versions.set(id, proposal.version);
      await this.atomic('proposal-versions.json', Object.fromEntries(versions));
      await this.atomic('proposals.json', [
        ...all.filter((p) => p.id !== id),
        proposal,
      ]);
      return proposal;
    });
  }
  async deleteProposal(id: string, expectedVersion: number) {
    return this.locked(async () => {
      const all = await this.proposals(),
        current = all.find((p) => p.id === id);
      if (!current || current.version !== expectedVersion)
        throw new Conflict(current ?? null);
      const versions = await this.proposalVersions();
      versions.set(id, Math.max(current.version, versions.get(id) ?? 0) + 1);
      await this.atomic('proposal-versions.json', Object.fromEntries(versions));
      await this.atomic(
        'proposals.json',
        all.filter((p) => p.id !== id),
      );
    });
  }
  async context(sessionId: string, input?: unknown) {
    if (!sessionId || sessionId.length > 200)
      throw Error('Explicit sessionId required');
    const file = 'context-' + hash(sessionId) + '.json';
    if (input !== undefined) {
      await this.locked(() => this.atomic(file, { sessionId, context: input }));
      return input;
    }
    try {
      return JSON.parse(
        await readFile(
          await confined(this.root, '.uml-viewer/' + file),
          'utf8',
        ),
      ).context;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw e;
    }
  }
  async importGraph(data: any, policy: Policy) {
    const graph = importLegacyGraph(data);
    const s = snapshotSchema.parse({
      schemaVersion: 1,
      id: randomUUID(),
      project: { id: this.id, root: this.root, name: this.name },
      metadata: {
        analyzerVersion: 'legacy-import',
        createdAt: new Date().toISOString(),
        commit: null,
        fingerprint: 'imported',
        language: 'imported',
        durationMs: 0,
        complete: true,
        fileCount: 0,
      },
      ...graph,
      diagnostics: [],
      policy,
    });
    await this.locked(async () => {
      const proposals = migrateProposals(data);
      if (proposals.length && (await this.proposals()).length)
        throw new Conflict({
          error: 'Import would replace existing proposals',
        });
      await this.atomic('snapshot.json', s);
      if (proposals.length)
        await this.atomic(
          'proposals.json',
          await this.rememberImportedProposals(proposals),
        );
    });
    return s;
  }
  async importMetrics(documents: any[]) {
    return this.locked(async () => {
      const snapshot = await this.snapshot();
      snapshot.nodes = attachMetrics(snapshot.nodes, documents);
      snapshot.id = randomUUID();
      await this.atomic('snapshot.json', snapshot);
      return snapshot;
    });
  }
}
export async function readDocument(file: string): Promise<any> {
  const text = await readFile(file, 'utf8');
  const value = file.endsWith('.edn') ? readEdn(text) : JSON.parse(text);
  return (value as any)?.format === 'legacy-edn' ? (value as any).data : value;
}
