import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { parsePhp } from '../node/languages/php.js';
import { attachMetrics } from '../node/core/migration.js';
import { Project, Conflict } from '../node/service/project.js';
import { viewAt, importLegacyGraph, applyPolicy } from '../node/core/graph.js';
import { proposalSchema, policySchema } from '../node/core/model.js';

test('review: a shared PHP property type and nullable flag apply to every declarator', () => {
  const f = parsePhp(
    'a.php',
    String.raw`<?php namespace App; use Other\Value as Alias; class A {public readonly ?Alias $a, $b; public Alias|\DateTime $c, $d;}`,
  );
  assert.deepEqual(f.errors, []);
  const p = f.declarations[0].properties;
  assert.deepEqual(
    p.map((x) => [x.name, x.type, x.types, x.readonly]),
    [
      ['a', '?Value', ['Other\\Value'], true],
      ['b', '?Value', ['Other\\Value'], true],
      ['c', 'Value|DateTime', ['Other\\Value', 'DateTime'], false],
      ['d', 'Value|DateTime', ['Other\\Value', 'DateTime'], false],
    ],
  );
});
test('review: absent namespaces never match metrics to another node', () => {
  const nodes = [
    { id: 'A', name: 'A' },
    { id: 'B', name: 'B' },
    { id: 'C', name: 'C', ns: 'App.C' },
  ];
  const actual = attachMetrics(nodes, [
    { nodes: [{ id: 'A', metrics: { coverage: 0.9 } }] },
    {
      entries: [{ name: 'unscoped', crap: 42 }],
      outcomes: { one: 'killed' },
      metrics: { cc: 17 },
    },
  ]);
  assert.deepEqual(
    actual.map((n) => n.metrics),
    [{ coverage: 0.9 }, undefined, undefined],
  );
  const scoped = attachMetrics(nodes, [
    { namespace: 'App.C', outcomes: { one: 'killed' } },
    {
      nodes: [
        { id: 'wrong', ns: 'App.C', metrics: { coverage: 0.5 } },
        { id: 'C', metrics: { coverage: 0.8 } },
      ],
    },
  ]);
  assert.equal(scoped[2].metrics?.coverage, 0.8);
  assert.deepEqual(scoped[2].metrics?.mutation, { killed: 1 });
});
test('review: a new scan never reuses an older snapshot ID after importing metrics', async () => {
  const root = await mkdtemp('/tmp/uml-review-id-');
  await writeFile(root + '/A.php', '<?php class A {}');
  const p = await Project.open(root);
  const before = await p.scan();
  const metrics = await p.importMetrics([
    { nodes: [{ id: 'A', metrics: { coverage: 0.9 } }] },
  ]);
  const after = await p.scan();
  assert.equal(new Set([before.id, metrics.id, after.id]).size, 3);
  await assert.rejects(p.snapshot(before.id), Conflict);
  assert.equal(after.nodes[0].id, before.nodes[0].id);
  assert.equal(after.nodes[0].metrics?.coverage, 0.9);
});
test('review: every nested proposal group remains reachable and preserves boundary relations', () => {
  const p = proposalSchema.parse({
    schemaVersion: 1,
    id: 'p',
    name: 'P',
    version: 1,
    layers: [
      {
        id: 'l',
        label: 'Layer',
        nses: [
          {
            id: 'outer',
            label: 'Outer',
            nses: [{ id: 'inner', label: 'Inner', nses: ['A'] }, 'B'],
          },
        ],
      },
    ],
  });
  const s = {
    nodes: [
      { id: 'A.x', name: 'X' },
      { id: 'B.y', name: 'Y' },
      { id: 'C.z', name: 'Z' },
    ],
    edges: [
      {
        id: 'e',
        from: 'A.x',
        to: 'C.z',
        kind: 'dependency' as const,
        sources: [],
      },
    ],
  };
  assert(
    viewAt(s, 'proposal.l', p).nodes.some(
      (n) => n.id === 'group.outer' && n.drill,
    ),
  );
  assert(
    viewAt(s, 'group.outer', p).nodes.some(
      (n) => n.id === 'group.inner' && n.drill,
    ),
  );
  const deepest = viewAt(s, 'group.inner', p);
  assert(deepest.nodes.some((n) => n.id === 'A.x'));
  assert(deepest.edges.some((e) => e.from === 'A.x' && e.to === 'C'));
});
test('review: a class sharing its namespace prefix does not hide children', () => {
  const s = {
    nodes: [
      { id: 'Foo', name: 'Foo' },
      { id: 'Foo.Bar', name: 'Bar' },
    ],
    edges: [],
  };
  assert.equal(viewAt(s).nodes[0].drill, true);
  assert.deepEqual(
    viewAt(s, 'Foo').nodes.map((n) => n.id),
    ['Foo', 'Foo.Bar'],
  );
});
test('review: aggregate policy omissions and relationship overrides apply at each view level', () => {
  const base = {
    nodes: [
      { id: 'A.a', name: 'A' },
      { id: 'B.b', name: 'B' },
    ],
    edges: [
      {
        id: 'e',
        from: 'A.a',
        to: 'B.b',
        kind: 'dependency' as const,
        violating: true,
        sources: [],
      },
    ],
  };
  const override = policySchema.parse({
    'edge-kinds': { 'A|B': 'association' },
  });
  assert.equal(
    viewAt({ ...base, policy: override }).edges[0].kind,
    'association',
  );
  assert.equal(viewAt({ ...base, policy: override }).edges[0].violating, false);
  assert.equal(
    viewAt({
      ...base,
      policy: policySchema.parse({ 'omit-edges': [['A', 'B']] }),
    }).edges.length,
    0,
  );
});
test('review: legacy proposal layers provide policy ranks when levels are absent', () => {
  const p = policySchema.parse({
    proposal: [
      { label: 'Inner', nses: ['A'] },
      { label: 'Outer', nses: ['B'] },
    ],
  });
  assert.equal(
    applyPolicy(
      [
        { id: 'A.a', name: 'A' },
        { id: 'B.b', name: 'B' },
      ],
      [{ id: 'e', from: 'A.a', to: 'B.b', kind: 'dependency', sources: [] }],
      p,
    ).edges[0].violating,
    true,
  );
});
test('review: Python nested and continued imports resolve without inventing a from module', async () => {
  const { pythonAdapter } = await import('../node/languages/modules.js');
  const code = String.raw`from app.model \
 import Animal
s = "import should_not_exist"
def f():
 from .model import Animal
 import json
 return Animal()
class C:
 import os.path
`;
  const graph = pythonAdapter.analyze(
    [
      { file: 'app/__init__.py', code: '' },
      { file: 'app/model.py', code: 'class Animal: pass\n' },
      { file: 'app/use.py', code },
    ],
    policySchema.parse({ prefix: 'app' }),
  );
  assert.deepEqual(graph.diagnostics, []);
  for (const to of ['model', 'json', 'os.path'])
    assert(
      graph.edges.some((e) => e.from === 'use' && e.to === to),
      to,
    );
  assert(!graph.nodes.some((n) => ['from', 'should_not_exist'].includes(n.id)));
});
test('review: stacked IR diagrams import as scoped views over a deduplicated graph', async () => {
  const { migrateProposals } = await import('../node/core/migration.js');
  const data = {
    title: 'Doc',
    diagrams: [
      {
        title: 'One',
        packages: [
          {
            id: 'p',
            label: 'P',
            classes: [
              { id: 'a', name: 'A' },
              { id: 'b', name: 'B' },
            ],
          },
        ],
        edges: [{ from: 'a', to: 'b', kind: 'association' }],
      },
      {
        title: 'Two',
        packages: [
          {
            id: 'p',
            label: 'P',
            classes: [
              { id: 'a', name: 'A' },
              { id: 'b', name: 'B' },
            ],
          },
        ],
        edges: [],
      },
    ],
  };
  const graph = importLegacyGraph(data);
  assert.equal(graph.nodes.length, 2);
  assert.equal(graph.edges.length, 1);
  const views = migrateProposals(data);
  assert.deepEqual(
    views.map((p) => p.name),
    ['One', 'Two'],
  );
  assert.equal(viewAt(graph, '', views[0]).edges.length, 0); // intra-package relation appears after drilling
  assert.equal(viewAt(graph, 'proposal.p', views[0]).edges.length, 1);
  assert.equal(viewAt(graph, 'proposal.p', views[1]).edges.length, 0);
  const p = await Project.open(await mkdtemp('/tmp/uml-review-diagrams-'));
  await p.importGraph(data, policySchema.parse({}));
  assert.equal((await p.snapshot()).nodes.length, 2);
  assert.equal((await p.proposals()).length, 2);
  assert.throws(() => importLegacyGraph({ unrecognized: 'IR' }));
});
test('review: legacy field/method text retains types, args and returns, including text-only and string members', async () => {
  const graph = importLegacyGraph({
    packages: [
      {
        id: 'p',
        classes: [
          {
            id: 'a',
            name: 'A',
            fields: [{ name: 'books', type: 'Book[]' }, 'free text'],
            ops: [
              { name: 'find', args: ['isbn'], returns: 'Book' },
              { text: 'run()' },
            ],
          },
        ],
      },
    ],
    edges: [],
  });
  const p = await Project.open(await mkdtemp('/tmp/uml-review-members-'));
  await p.importGraph(
    { classes: graph.nodes, edges: [] },
    policySchema.parse({}),
  );
  const n = (await p.snapshot()).nodes[0];
  assert.deepEqual(
    n.fields?.map((m) => m.text),
    ['books : Book[]', 'free text'],
  );
  assert.deepEqual(
    n.ops?.map((m) => m.text),
    ['find(isbn) : Book', 'run()'],
  );
});
test('review: delete/recreate and legacy reimport cannot revive a stale proposal version', async () => {
  const root = await mkdtemp('/tmp/uml-review-aba-');
  const p = await Project.open(root);
  const data = { name: 'Original', layers: [] };
  const first = await p.updateProposal('same', 0, data);
  await p.deleteProposal('same', first.version);
  const reopened = await Project.open(root);
  const replacement = await reopened.updateProposal('same', 0, {
    ...data,
    name: 'Replacement',
  });
  assert(replacement.version > first.version);
  await assert.rejects(
    p.updateProposal('same', first.version, { ...data, name: 'Stale' }),
    Conflict,
  );
  assert.equal((await p.proposals())[0].name, 'Replacement');
  await p.deleteProposal('same', replacement.version);
  await p.importGraph(
    {
      classes: [{ id: 'a', name: 'A' }],
      edges: [],
      proposals: [{ id: 'same', name: 'Imported', layers: [] }],
    },
    policySchema.parse({}),
  );
  assert((await p.proposals())[0].version > replacement.version);
  await assert.rejects(
    p.updateProposal('same', replacement.version, data),
    Conflict,
  );
});
test('review: MCP rename retains an imported diagram scope, including for older callers that omit scope', async (t) => {
  const { createMcp } = await import('../node/integration/mcp.js');
  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
  const { InMemoryTransport } = await import(
    '@modelcontextprotocol/sdk/inMemory.js'
  );
  const p = await Project.open(await mkdtemp('/tmp/uml-review-scope-'));
  const d = {
    packages: [
      {
        id: 'p',
        classes: [
          { id: 'a', name: 'A' },
          { id: 'b', name: 'B' },
        ],
      },
    ],
    edges: [],
  };
  await p.importGraph(
    {
      diagrams: [
        {
          ...d,
          title: 'One',
          edges: [{ from: 'a', to: 'b', kind: 'association' }],
        },
        { ...d, title: 'Two' },
      ],
    },
    policySchema.parse({}),
  );
  const snapshot = await p.snapshot();
  let proposal = (await p.proposals())[1];
  const server = createMcp(p),
    client = new Client({ name: 'review', version: '1' }),
    [ct, st] = InMemoryTransport.createLinkedPair();
  await server.connect(st);
  await client.connect(ct);
  t.after(async () => {
    await client.close();
    await server.close();
  });
  async function rename(input: unknown) {
    const result: any = await client.callTool({
      name: 'update_proposal',
      arguments: {
        projectId: p.id,
        snapshotId: snapshot.id,
        id: proposal.id,
        expectedVersion: proposal.version,
        proposal: input,
      },
    });
    assert(!result.isError, result.content[0].text);
    proposal = JSON.parse(result.content[0].text);
  }
  await rename({ ...proposal, name: 'Two renamed' });
  assert.deepEqual(proposal.scope?.edgeIds, []);
  assert.equal(viewAt(snapshot, 'proposal.p', proposal).edges.length, 0);
  await rename({ name: 'Older caller', layers: proposal.layers });
  assert.deepEqual(proposal.scope?.edgeIds, []);
  assert.equal(viewAt(snapshot, 'proposal.p', proposal).edges.length, 0);
  await rename({ ...proposal, scope: null });
  assert.equal(proposal.scope, null);
  assert.equal(viewAt(snapshot, 'proposal.p', proposal).edges.length, 1);
});
