import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  readFile,
  readdir,
  mkdtemp,
  writeFile,
  symlink,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { readEdn, convertDocument } from '../node/core/edn.js';
import {
  viewAt,
  markViolations,
  applyPolicy,
  importLegacyGraph,
} from '../node/core/graph.js';
import {
  policySchema,
  proposalSchema,
  snapshotSchema,
} from '../node/core/model.js';
import { Project, Conflict, confined } from '../node/service/project.js';
test('EDN examples and metrics import without executing reader forms', async () => {
  for (const file of (await readdir('examples')).filter((f) =>
    f.endsWith('.edn'),
  )) {
    const v = readEdn(await readFile('examples/' + file, 'utf8'));
    assert(v);
    assert.equal(convertDocument(v).schemaVersion, 1);
  }
  for (const text of [
    '#=(System/exit 0)',
    '#foo "x"',
    '{:x 1 :x 2}',
    '{} {}',
    '[1',
  ])
    assert.throws(() => readEdn(text));
  const data: any = readEdn(await readFile('examples/library.edn', 'utf8'));
  const graph = importLegacyGraph(data);
  assert.equal(
    graph.nodes.find((n) => n.id === 'catalog')?.metrics?.coverage,
    0.91,
  );
  assert(graph.edges.some((e) => e.kind === 'aggregation'));
});
test('hierarchy bundles preserve underlying relations and proposals leave actual graph unchanged', async () => {
  const s = await (
    await Project.open('examples/php-shop/src')
  ).scan({
    policy: readEdn(await readFile('examples/php-shop.policy.edn', 'utf8')),
    save: false,
  });
  const before = JSON.stringify(s);
  const root = viewAt(s);
  assert(root.nodes.some((n) => n.id === 'Domain' && n.drill));
  assert(
    root.edges.find((e) => e.from === 'Domain' && e.to === 'Infrastructure')
      ?.violating,
  );
  assert(
    viewAt(s, 'Domain.Model').nodes.some((n) => n.id === 'Domain.Model.Order'),
  );
  const p = proposalSchema.parse({
    schemaVersion: 1,
    id: 'p',
    name: 'Proposed',
    version: 1,
    layers: [
      {
        id: 'inner',
        label: 'Inner',
        nses: [{ id: 'domain-group', label: 'Domain group', nses: ['Domain'] }],
      },
      {
        id: 'outer',
        label: 'Outer',
        nses: ['Infrastructure', 'Http', 'Application'],
      },
    ],
  });
  assert(viewAt(s, '', p).nodes.some((n) => n.id === 'proposal.inner'));
  assert(
    viewAt(s, 'proposal.inner', p).nodes.some(
      (n) => n.id === 'group.domain-group',
    ),
  );
  assert(
    viewAt(s, 'group.domain-group', p).nodes.some(
      (n) => n.id === 'Domain.Model.Order',
    ),
  );
  assert.equal(JSON.stringify(s), before);
});
test('policy uses longest prefix ranks, omission, edge overrides and only dependency violations', () => {
  const edges = [
    'dependency',
    'inheritance',
    'implements',
    'association',
    'aggregation',
    'composition',
  ].map((kind) => ({
    id: kind,
    from: 'A.X',
    to: 'B.Y',
    kind: kind as any,
    sources: [],
  }));
  assert.deepEqual(
    markViolations(edges, [['A'], ['B']])
      .filter((e) => e.violating)
      .map((e) => e.kind),
    ['dependency'],
  );
  const p = policySchema.parse({
    omit: ['Drop'],
    'edge-kinds': { 'A.X|B.Y': 'composition' },
    foreign: ['B'],
  });
  const graph = applyPolicy(
    [
      { id: 'A.X', name: 'X' },
      { id: 'B.Y', name: 'Y', foreign: true },
      { id: 'Drop.C', name: 'C' },
    ],
    edges,
    p,
  );
  assert.equal(graph.nodes.length, 2);
  assert.equal(graph.edges[0].to, 'B');
});
test('snapshots fingerprint dirty content, stable node IDs, persistent optimistic proposals, isolated sessions and canonical source confinement', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'uml-state-'));
  await writeFile(path.join(root, 'A.php'), '<?php class A {}');
  const p = await Project.open(root);
  const a = await p.scan();
  await writeFile(path.join(root, 'A.php'), '<?php class A {function b(){}}');
  assert(await p.stale(a));
  const b = await p.scan();
  assert.equal(a.nodes[0].id, b.nodes[0].id);
  assert.notEqual(a.metadata.fingerprint, b.metadata.fingerprint);
  assert.notEqual(a.id, b.id);
  await assert.rejects(p.snapshot(a.id), Conflict);
  const input = { name: 'Plan', layers: [] };
  const first = await p.updateProposal('p', 0, input);
  assert.equal(first.version, 1);
  const results = await Promise.allSettled([
    p.updateProposal('p', 1, { ...input, name: 'One' }),
    (await Project.open(root)).updateProposal('p', 1, {
      ...input,
      name: 'Two',
    }),
  ]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal(
    results.filter(
      (r) => r.status === 'rejected' && r.reason instanceof Conflict,
    ).length,
    1,
  );
  assert.equal((await (await Project.open(root)).proposals())[0].version, 2);
  await p.context('one', { selection: ['A'] });
  assert.equal(await p.context('two'), null);
  await symlink('/etc/passwd', path.join(root, 'escape.php'));
  await assert.rejects(p.source('escape.php'), /outside/);
  await assert.rejects(confined(p.root, '../outside'), Error);
  assert.equal(await p.source('A.php'), '<?php class A {function b(){}}');
});
test('existing metrics and legacy proposals migrate, persist and survive rescan', async () => {
  const { attachMetrics, migrateProposals } = await import(
    '../node/core/migration.js'
  );
  const metrics = readEdn(await readFile('.metrics/crap.edn', 'utf8'));
  const mutation = readEdn(
    await readFile('.metrics/mutate/uml-viewer.source.edn', 'utf8'),
  );
  const nodes = attachMetrics(
    [
      { id: 'source', name: 'Source', ns: 'uml-viewer.source' },
      { id: 'unknown', name: 'Unknown' },
    ],
    [metrics, mutation],
  );
  assert(nodes[0].metrics?.mutation);
  assert.equal(nodes[1].metrics, undefined);
  const p = migrateProposals({
    proposal: [{ label: 'Inner', nses: ['Domain'] }],
  });
  assert.equal(p[0].layers[0].label, 'Inner');
  const root = await mkdtemp(path.join(os.tmpdir(), 'uml-metric-'));
  await writeFile(path.join(root, 'A.php'), '<?php class A {}');
  const project = await Project.open(root);
  await project.scan();
  await project.importMetrics([
    { nodes: [{ id: 'A', metrics: { coverage: 0.82 } }] },
  ]);
  assert.equal((await project.scan()).nodes[0].metrics?.coverage, 0.82);
  const other = await Project.open(
    await mkdtemp(path.join(os.tmpdir(), 'uml-import-')),
  );
  await other.importGraph(
    {
      classes: [{ id: 'x', name: 'X' }],
      edges: [],
      proposals: [
        { id: 'old', name: 'Legacy', layers: [{ label: 'Core', nses: ['x'] }] },
      ],
    },
    policySchema.parse({}),
  );
  assert.equal(
    (await (await Project.open(other.root)).proposals())[0].name,
    'Legacy',
  );
});
test('PHP declaration spelling changes retain case-insensitive identity across scans', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'uml-case-'));
  await writeFile(
    path.join(root, 'A.php'),
    '<?php namespace App; class User {} class Uses {function f(User $u){}}',
  );
  const p = await Project.open(root);
  const before = await p.scan();
  await writeFile(
    path.join(root, 'A.php'),
    '<?php namespace App; class USER {} class Uses {function f(USER $u){}}',
  );
  const after = await p.scan();
  assert.equal(
    after.nodes.find((n) => n.name === 'USER')?.id,
    before.nodes.find((n) => n.name === 'User')?.id,
  );
  assert(after.edges.some((e) => e.to === 'User'));
});
