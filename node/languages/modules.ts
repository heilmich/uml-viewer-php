import { parser as pythonParser } from '@lezer/python';
import { parser as rustParser } from '@lezer/rust';
import { parser as clojureParser } from '@nextjournal/lezer-clojure';
import type { SyntaxNode } from '@lezer/common';
import path from 'node:path';
import {
  edgeId,
  type LanguageAdapter,
  type SourceFile,
  type Policy,
  type GraphNode,
  type GraphEdge,
  type AnalysisResult,
} from '../core/model.js';
const title = (s: string) =>
  s
    .split(/[-_]/)
    .map((x) => x[0]?.toUpperCase() + x.slice(1))
    .join('');
const children = (n: SyntaxNode) => {
  const a: SyntaxNode[] = [];
  for (let c = n.firstChild; c; c = c.nextSibling) a.push(c);
  return a;
};
const line = (code: string, offset: number) =>
  code.slice(0, offset).split('\n').length;
function build() {
  const nodes: GraphNode[] = [],
    edges: GraphEdge[] = [],
    diagnostics: AnalysisResult['diagnostics'] = [];
  return {
    nodes,
    edges,
    diagnostics,
    add(
      from: string,
      to: string,
      kind: GraphEdge['kind'],
      file: string,
      ln: number,
    ) {
      if (!to || from === to) return;
      const id = edgeId(from, to, kind);
      if (!edges.some((e) => e.id === id))
        edges.push({
          id,
          from,
          to,
          kind,
          sources: [{ file, line: ln, via: kind }],
        });
    },
    finish() {
      for (const to of new Set(edges.map((e) => e.to)))
        if (!nodes.some((n) => n.id === to))
          nodes.push({ id: to, name: to, foreign: true });
      return { nodes, edges, diagnostics };
    },
  };
}
function errors(
  tree: SyntaxNode,
  file: SourceFile,
  diagnostics: AnalysisResult['diagnostics'],
) {
  const cursor = tree.cursor();
  do {
    if (cursor.type.isError)
      diagnostics.push({
        file: file.file,
        line: line(file.code, cursor.from),
        message:
          'Invalid syntax near ' + file.code.slice(cursor.from, cursor.to + 20),
        severity: 'error',
      });
  } while (cursor.next());
}
export const pythonAdapter: LanguageAdapter = {
  id: 'python',
  extensions: ['.py'],
  analyze(files, policy) {
    const g = build();
    files = files.filter(
      (f) => !/(^|\/)(?:test_.+|.+_tests?|conftest)\.py$/.test(f.file),
    );
    const nested = files.some((f) => f.file === `${policy.prefix}/__init__.py`);
    const module = (file: string) =>
      file
        .replace(/\.py$/, '')
        .replace(/(?:\/)?__init__$/, '')
        .replaceAll('/', '.');
    const full = (file: string) => {
      const m = module(file);
      return nested ? m : [policy.prefix, m].filter(Boolean).join('.');
    };
    const id = (ns: string) =>
      ns.startsWith(policy.prefix + '.')
        ? ns.slice(policy.prefix.length + 1)
        : ns;
    const modules = new Map(files.map((f) => [full(f.file), id(full(f.file))]));
    for (const f of files) {
      const ns = full(f.file),
        from = id(ns),
        tree = pythonParser.parse(f.code);
      errors(tree.topNode, f, g.diagnostics);
      const ops: any[] = [],
        aliases = new Map<string, string>(),
        returns: { target: string; line: number }[] = [],
        bases: { target: string; line: number }[] = [];
      let protocol = false;
      const resolveModule = (raw: string) => {
        if (!raw.startsWith('.')) return raw;
        const dots = raw.match(/^\.+/)![0].length;
        const parent = ns.split('.');
        if (!f.file.endsWith('__init__.py')) parent.pop();
        return [
          ...parent.slice(0, Math.max(0, parent.length - dots + 1)),
          raw.slice(dots),
        ]
          .filter(Boolean)
          .join('.');
      };
      for (const n of children(tree.topNode)) {
        const text = f.code.slice(n.from, n.to);
        if (n.name === 'ImportStatement') {
          const fromMatch = text.match(/^from\s+([\w.]+)\s+import\s+([\s\S]+)/);
          if (fromMatch) {
            const mod = resolveModule(fromMatch[1]);
            for (const part of fromMatch[2]
              .replace(/[()\\\n]/g, ' ')
              .split(',')) {
              const m = part.trim().match(/^([\w*]+)(?:\s+as\s+(\w+))?/);
              if (!m) continue;
              const sub = mod + '.' + m[1],
                target = modules.has(sub) ? sub : mod;
              aliases.set(m[2] ?? m[1], target);
              g.add(
                from,
                modules.get(target) ?? target,
                'dependency',
                f.file,
                line(f.code, n.from),
              );
            }
          } else
            for (const part of text.replace(/^import\s+/, '').split(',')) {
              const m = part.trim().match(/^([\w.]+)(?:\s+as\s+(\w+))?/);
              if (m) {
                aliases.set(m[2] ?? m[1], m[1]);
                g.add(
                  from,
                  modules.get(m[1]) ?? m[1],
                  'dependency',
                  f.file,
                  line(f.code, n.from),
                );
              }
            }
        }
        if (
          n.name === 'ClassDefinition' ||
          n.name === 'FunctionDefinition' ||
          n.name === 'DecoratedStatement'
        ) {
          const def =
            n.name === 'DecoratedStatement'
              ? children(n).find((c) =>
                  ['ClassDefinition', 'FunctionDefinition'].includes(c.name),
                )
              : n;
          if (!def) continue;
          const name = children(def).find((c) => c.name === 'VariableName');
          if (!name) continue;
          const nameText = f.code.slice(name.from, name.to);
          if (nameText.startsWith('_')) continue;
          ops.push({
            name: nameText,
            text: f.code
              .slice(
                def.from,
                children(def).find((c) => c.name === 'Body')?.from ?? def.to,
              )
              .trim(),
            line: line(f.code, def.from),
          });
          if (def.name === 'ClassDefinition') {
            const args = children(def).find((c) => c.name === 'ArgList');
            if (args)
              for (const b of f.code
                .slice(args.from + 1, args.to - 1)
                .split(',')) {
                const base = b.trim();
                if (/(?:^|\.)(Protocol|ABC)$/.test(base)) protocol = true;
                else if (base)
                  bases.push({ target: base, line: line(f.code, def.from) });
              }
          } else {
            const type = children(def).find((c) => c.name === 'TypeDef');
            if (type) {
              const target = f.code
                .slice(type.from, type.to)
                .replace(/^\s*->\s*/, '')
                .trim();
              if (/^[\w.]+$/.test(target))
                returns.push({ target, line: line(f.code, def.from) });
            }
          }
        }
      }
      const targetFor = (name: string) => {
        if (aliases.has(name)) return aliases.get(name)!;
        const parts = name.split('.');
        if (aliases.has(parts[0])) return aliases.get(parts[0])!;
        const candidate = parts.slice(0, -1).join('.');
        return modules.has(candidate) ? candidate : undefined;
      };
      for (const b of bases) {
        const to = targetFor(b.target);
        if (to)
          g.add(from, modules.get(to) ?? to, 'inheritance', f.file, b.line);
      }
      for (const r of returns) {
        const to = targetFor(r.target);
        if (to)
          g.add(from, modules.get(to) ?? to, 'implements', f.file, r.line);
      }
      g.nodes.push({
        id: from,
        name: title(from.split('.').at(-1) ?? ns),
        ns,
        lang: 'python',
        kind: 'module',
        file: f.file,
        line: 1,
        ops,
        ...(protocol ? { stereotype: 'interface' } : {}),
      });
    }
    return g.finish();
  },
};
export const rustAdapter: LanguageAdapter = {
  id: 'rust',
  extensions: ['.rs'],
  analyze(files, policy) {
    const g = build();
    const prefix = String(
      policy['ns-prefix'] ?? [policy.prefix, 'rust'].filter(Boolean).join('.'),
    );
    const rootId = prefix.startsWith(policy.prefix + '.')
      ? prefix.slice(policy.prefix.length + 1)
      : prefix;
    const byFile = new Map(files.map((f) => [f.file, f]));
    const visited = new Set<string>();
    const moduleId = (file: string) => {
      const tail = file
        .replace(/^(?:src\/)?/, '')
        .replace(/\.rs$/, '')
        .replace(/(?:^|\/)lib$/, '')
        .replace(/(?:^|\/)mod$/, '')
        .replaceAll('/', '.');
      return [rootId, tail].filter(Boolean).join('.');
    };
    const known = new Map(files.map((f) => [moduleId(f.file), f.file]));
    const aliases = new Map<string, Map<string, string>>();
    const resolve = (raw: string, current: string) => {
      let parts = raw.split('::').filter(Boolean);
      let base: string[];
      if (parts[0] === 'crate') {
        parts.shift();
        base = rootId.split('.');
      } else if (parts[0] === 'self') {
        parts.shift();
        base = current.split('.');
      } else if (parts[0] === 'super') {
        base = current.split('.');
        while (parts[0] === 'super') {
          base.pop();
          parts.shift();
        }
      } else {
        const alias = aliases.get(current)?.get(parts[0]);
        if (alias) return alias;
        base = rootId.split('.');
      }
      const joined = [...base, ...parts].join('.');
      const candidate = [...known.keys()]
        .filter((k) => joined === k || joined.startsWith(k + '.'))
        .sort((a, b) => b.length - a.length)[0];
      if (candidate && candidate !== rootId) return candidate;
      return ['crate', 'self', 'super'].includes(raw.split('::')[0])
        ? (candidate ?? rootId)
        : raw.split('::')[0];
    };
    function walk(file: string) {
      if (visited.has(file)) return;
      const f = byFile.get(file);
      if (!f) return;
      visited.add(file);
      const current = moduleId(file),
        tree = rustParser.parse(f.code);
      errors(tree.topNode, f, g.diagnostics);
      const ops: any[] = [],
        commands: string[] = [],
        bindings = new Map<string, string>();
      aliases.set(current, bindings);
      let trait = false;
      const top = children(tree.topNode);
      for (const n of top) {
        const text = f.code.slice(n.from, n.to);
        if (n.name === 'ModItem') {
          const m = text.match(/\bmod\s+(\w+)\s*;/);
          if (m) {
            const stem = /(?:^|\/)(?:lib|main|mod)\.rs$/.test(file)
              ? path.posix.dirname(file)
              : file.replace(/\.rs$/, '');
            const dest = [
              path.posix.join(stem, m[1] + '.rs'),
              path.posix.join(stem, m[1] + '/mod.rs'),
            ].find((x) => byFile.has(x));
            if (dest) {
              walk(dest);
              g.add(
                current,
                moduleId(dest),
                'dependency',
                file,
                line(f.code, n.from),
              );
            }
          }
        }
        if (n.name === 'UseDeclaration') {
          const raw = text
            .replace(/^\s*(?:pub\s+)?use\s+/, '')
            .replace(/;\s*$/, '');
          const list = raw.match(/^(.*)::\{(.*)\}$/s);
          for (const item of list
            ? list[2].split(',').map((x) => list[1] + '::' + x.trim())
            : [raw]) {
            const parts = item.split(/\s+as\s+/),
              target = resolve(parts[0], current);
            bindings.set(parts[1] ?? parts[0].split('::').at(-1)!, target);
            g.add(current, target, 'dependency', file, line(f.code, n.from));
          }
        }
        if (n.name === 'TraitItem') trait = true;
        const fn =
          n.name === 'FunctionItem'
            ? n
            : n.name === 'AttributeItem'
              ? children(n).find((x) => x.name === 'FunctionItem')
              : undefined;
        if (fn) {
          const t = f.code.slice(fn.from, fn.to);
          const match = t.match(/\bfn\s+(\w+)/);
          const command = /\btauri\s*::\s*command\b/.test(text);
          if (match && (/^(?:pub\b)/.test(t.trim()) || command)) {
            ops.push({
              name: match[1],
              text: t.split('{')[0].trim(),
              line: line(f.code, fn.from),
            });
            if (command) commands.push(match[1]);
          }
        }
      }
      for (const n of top)
        if (n.name === 'ImplItem') {
          const text = f.code.slice(n.from, n.to),
            m = text.match(
              /\bimpl(?:\s*<[^>]+>)?\s+([\w:]+)(?:<[^>]+>)?\s+for\b/,
            );
          if (m)
            g.add(
              current,
              resolve(m[1], current),
              'implements',
              file,
              line(f.code, n.from),
            );
        }
      g.nodes.push({
        id: current,
        name: path.posix.basename(file),
        ns: policy.prefix + '.' + current,
        lang: 'rust',
        kind: 'module',
        file,
        line: 1,
        ops,
        commands,
        ...(trait ? { stereotype: 'interface' } : {}),
      });
    }
    const root = files.find(
      (f) => f.file === 'lib.rs' || f.file === 'src/lib.rs',
    );
    const main = files.find(
      (f) => f.file === 'main.rs' || f.file === 'src/main.rs',
    );
    if (root) walk(root.file);
    if (main) {
      walk(main.file);
      const libName =
        typeof policy['lib-crate-name'] === 'string'
          ? policy['lib-crate-name']
          : undefined;
      const calls: string[] = [];
      const cursor = rustParser.parse(main.code).cursor();
      do {
        if (cursor.name === 'CallExpression') {
          const text = main.code.slice(cursor.from, cursor.to);
          const m = text.match(/^(\w+)\s*::/);
          if (m) calls.push(m[1]);
        }
      } while (cursor.next());
      if (
        root &&
        calls.some((name) => (libName ? name === libName : /_lib$/.test(name)))
      )
        g.add(
          moduleId(main.file),
          moduleId(root.file),
          'dependency',
          main.file,
          1,
        );
    }
    if (!root && !main) files.forEach((f) => walk(f.file));
    return g.finish();
  },
};
export const clojureAdapter: LanguageAdapter = {
  id: 'clojure',
  extensions: ['.clj', '.cljs', '.cljc'],
  analyze(files, policy) {
    const g = build();
    const surfaces = files
      .map((f) => {
        const tree = clojureParser.parse(f.code);
        errors(tree.topNode, f, g.diagnostics);
        const forms = children(tree.topNode).filter((n) => n.name === 'List');
        const text = (n: SyntaxNode) => f.code.slice(n.from, n.to);
        const ns = forms.find((n) => /^\(ns\s/.test(text(n)));
        const name = ns
          ? text(ns).match(/^\(ns\s+(?:\^[^\s]+\s+)?([^\s()]+)/)?.[1]
          : undefined;
        return { f, forms, ns, name, text };
      })
      .filter((x) => x.name);
    const id = (n: string) =>
      n.startsWith(policy.prefix + '.') ? n.slice(policy.prefix.length + 1) : n;
    const nses = new Set(surfaces.map((s) => s.name!));
    for (const s of surfaces) {
      const from = id(s.name!),
        bindings = new Map<string, string>();
      const ops: any[] = [];
      let protocol = false;
      if (s.ns)
        for (const clause of children(s.ns).filter((n) => n.name === 'List')) {
          const source = s.text(clause);
          if (/^\(:require\b|^\(:use\b/.test(source))
            for (const spec of children(clause).filter((n) =>
              ['Vector', 'Symbol'].includes(n.name),
            )) {
              const raw = s.text(spec);
              const lib = raw.match(/^\[?([^\s\[\]()]+)/)?.[1];
              if (!lib) continue;
              const nested = children(spec).filter((n) => n.name === 'Vector');
              if (nested.length) {
                for (const child of nested) {
                  const txt = s.text(child),
                    sub = txt.match(/^\[([^\s\]]+)/)?.[1];
                  if (!sub) continue;
                  const target = lib + '.' + sub,
                    alias = txt.match(/:as(?:-alias)?\s+([^\s\]]+)/)?.[1];
                  if (alias) bindings.set(alias, target);
                  g.add(
                    from,
                    id(target),
                    'dependency',
                    s.f.file,
                    line(s.f.code, child.from),
                  );
                }
              } else {
                const alias = raw.match(/:as(?:-alias)?\s+([^\s\]]+)/)?.[1];
                if (alias) bindings.set(alias, lib);
                g.add(
                  from,
                  id(lib),
                  'dependency',
                  s.f.file,
                  line(s.f.code, spec.from),
                );
              }
            }
          if (/^\(:import\b/.test(source))
            for (const spec of children(clause).filter((n) =>
              ['Vector', 'Symbol'].includes(n.name),
            )) {
              const lib = s.text(spec).replace(/^\[/, '').split(/\s/)[0];
              const pkg =
                spec.name === 'Vector'
                  ? lib
                  : lib.split('.').slice(0, -1).join('.');
              g.add(
                from,
                pkg,
                'dependency',
                s.f.file,
                line(s.f.code, spec.from),
              );
            }
        }
      for (const form of s.forms) {
        const text = s.text(form),
          m = text.match(
            /^\((defn-?|defmacro|defprotocol|defrecord|deftype|defmulti|def)\s+(?:\^[^\s]+\s+)?([^\s\[()]+)/,
          );
        if (m && m[1] !== 'defn-') {
          ops.push({
            name: m[2],
            text: text.split(/[\n{]/)[0],
            line: line(s.f.code, form.from),
          });
          if (m[1] === 'defprotocol') protocol = true;
        }
        const cursor = form.cursor();
        do {
          if (cursor.name === 'List') {
            const sub = s.f.code.slice(cursor.from, cursor.to);
            const rr = sub.match(
              /^\((?:clojure\.core\/)?requiring-resolve\s+'([^\s()]+)\)/,
            );
            if (rr) {
              const target = rr[1].split('/')[0];
              g.add(
                from,
                id(target),
                'dependency',
                s.f.file,
                line(s.f.code, cursor.from),
              );
            }
          }
          if (
            m &&
            ['defrecord', 'deftype'].includes(m[1]) &&
            cursor.name === 'Symbol'
          ) {
            const token = s.f.code.slice(cursor.from, cursor.to),
              [a, b] = token.split('/');
            if (b && (bindings.has(a) || nses.has(a)))
              g.add(
                from,
                id(bindings.get(a) ?? a),
                'implements',
                s.f.file,
                line(s.f.code, cursor.from),
              );
          }
        } while (cursor.next());
      }
      g.nodes.push({
        id: from,
        name: title(from.split('.').at(-1)!),
        ns: s.name,
        lang: 'clojure',
        kind: 'module',
        file: s.f.file,
        line: 1,
        ops,
        ...(protocol ? { stereotype: 'interface' } : {}),
      });
    }
    return g.finish();
  },
};
