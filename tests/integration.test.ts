import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, symlink, readFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { Project } from '../node/service/project.js';
import { serve } from '../node/service/http.js';
import { createMcp } from '../node/integration/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
const temp = async (name: string) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'uml-' + name));
  await writeFile(path.join(root, 'A.php'), `<?php class ${name} {}`);
  return Project.open(root);
};
test('HTTP project identity, snapshots, version conflict, source confinement and cross-origin/CSRF protection', async (t) => {
  const p = await temp('Http');
  const s = await p.scan();
  const running = await serve(p);
  t.after(() => new Promise<void>((r) => running.server.close(() => r())));
  const b = await (await fetch(running.url + '/api/bootstrap')).json();
  const query = `?project=${p.id}&snapshot=${s.id}`;
  const call = (
    route: string,
    method = 'GET',
    body?: unknown,
    token = b.token,
  ) =>
    fetch(running.url + '/api/' + route + query, {
      method,
      headers: { 'Content-Type': 'application/json', 'X-Uml-Token': token },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  assert.equal((await call('graph')).status, 200);
  assert.equal(
    (await fetch(running.url + '/api/graph?project=other&snapshot=' + s.id))
      .status,
    400,
  );
  assert.equal(
    (await fetch(running.url + '/api/graph?project=' + p.id + '&snapshot=old'))
      .status,
    409,
  );
  assert.equal(
    (
      await fetch(running.url + '/api/bootstrap', {
        headers: { Origin: 'http://evil.example' },
      })
    ).status,
    403,
  );
  assert.equal((await call('scan', 'POST', {}, 'bad')).status, 403);
  const proposal = { name: 'Plan', layers: [] };
  assert.equal(
    (
      await call('proposals', 'PUT', {
        id: 'one',
        expectedVersion: 0,
        proposal,
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await call('proposals', 'PUT', {
        id: 'one',
        expectedVersion: 0,
        proposal,
      })
    ).status,
    409,
  );
  const src = await (
    await fetch(running.url + '/api/source' + query + '&element=Http')
  ).json();
  assert.match(src.code, /class Http/);
  await symlink('/etc/passwd', path.join(p.root, 'A.php.link'));
  await p.atomic('snapshot.json', {
    ...s,
    nodes: [{ ...s.nodes[0], file: 'A.php.link' }],
  });
  const blocked = await fetch(
    running.url + '/api/source' + query + '&element=Http',
  );
  assert.equal(blocked.status, 400);
  assert.match((await blocked.json()).error, /outside/);
});
test('two MCP clients and two projects isolate graphs, selections and proposals, returning conflicts across processes', async (t) => {
  const p = await temp('One'),
    q = await temp('Two');
  const a = await p.scan(),
    b = await q.scan();
  async function connect(project: Project) {
    const server = createMcp(project),
      client = new Client({ name: 'test', version: '1.0' }),
      [ct, st] = InMemoryTransport.createLinkedPair();
    await server.connect(st);
    await client.connect(ct);
    t.after(async () => {
      await client.close();
      await server.close();
    });
    return client;
  }
  const one = await connect(p),
    two = await connect(await Project.open(p.root)),
    other = await connect(q);
  const text = (r: any) => JSON.parse(r.content[0].text);
  const ids = { projectId: p.id, snapshotId: a.id };
  assert.equal(
    text(await one.callTool({ name: 'get_graph', arguments: ids })).project.id,
    p.id,
  );
  assert((await other.callTool({ name: 'get_graph', arguments: ids })).isError);
  assert.equal(
    text(
      await other.callTool({
        name: 'get_graph',
        arguments: { projectId: q.id, snapshotId: b.id },
      }),
    ).nodes[0].name,
    'Two',
  );
  await one.callTool({
    name: 'set_context',
    arguments: {
      ...ids,
      sessionId: 'session-one',
      selection: ['One'],
      proposalId: null,
    },
  });
  assert.equal(
    text(
      await two.callTool({
        name: 'get_context',
        arguments: { ...ids, sessionId: 'session-two' },
      }),
    ).context,
    null,
  );
  assert.deepEqual(
    text(
      await two.callTool({
        name: 'get_context',
        arguments: { ...ids, sessionId: 'session-one' },
      }),
    ).context.selection,
    ['One'],
  );
  const data = {
    ...ids,
    id: 'p',
    expectedVersion: 0,
    proposal: { name: 'Plan', layers: [] },
  };
  assert.equal(
    text(await one.callTool({ name: 'update_proposal', arguments: data }))
      .version,
    1,
  );
  const conflict = await two.callTool({
    name: 'update_proposal',
    arguments: data,
  });
  assert(conflict.isError);
  assert.equal(text(conflict).current.version, 1);
  assert.equal((await q.proposals()).length, 0);
});
test('CLI built scan, facts, convert, partial exit code and stdio MCP use only Node runtime', async () => {
  const library = await import('../dist/viewer/index.js');
  assert.equal(typeof library.Viewer, 'function');
  assert.match(await readFile('dist/viewer/index.css', 'utf8'), /react-flow/);
  const p = await temp('Cli');
  let r = spawnSync(
    process.execPath,
    ['dist/node/cli.js', 'scan', '--project', p.root],
    { encoding: 'utf8' },
  );
  assert.equal(r.status, 0, r.stderr);
  assert.equal(JSON.parse(r.stdout).nodes[0].name, 'Cli');
  r = spawnSync(
    process.execPath,
    ['dist/node/cli.js', 'scan', '--project', p.root, '--facts'],
    { encoding: 'utf8' },
  );
  assert.equal(r.status, 0);
  assert.equal(JSON.parse(r.stdout).files[0].declarations[0].name, 'Cli');
  await writeFile(path.join(p.root, 'Broken.php'), '<?php class {');
  r = spawnSync(
    process.execPath,
    ['dist/node/cli.js', 'scan', '--project', p.root],
    { encoding: 'utf8' },
  );
  assert.equal(r.status, 2, r.stderr);
  assert.equal(JSON.parse(r.stdout).metadata.complete, false);
  const output = path.join(p.root, 'policy.json');
  r = spawnSync(
    process.execPath,
    [
      'dist/node/cli.js',
      'convert',
      '--input',
      'examples/php-shop.policy.edn',
      '--out',
      output,
    ],
    { encoding: 'utf8' },
  );
  assert.equal(r.status, 0, r.stderr);
  assert.equal(JSON.parse(await readFile(output, 'utf8')).data.prefix, 'Shop');
});
test('real stdio MCP handshake works with PATH containing only Node, and disconnect does not stop other clients', async (t) => {
  const { StdioClientTransport } = await import(
    '@modelcontextprotocol/sdk/client/stdio.js'
  );
  const p = await temp('Stdio');
  const snapshot = await p.scan();
  const bin = await mkdtemp(path.join(os.tmpdir(), 'uml-node-only-'));
  await symlink(process.execPath, path.join(bin, 'node'));
  const clients: Client[] = [];
  for (let i = 0; i < 2; i++) {
    const c = new Client({ name: 'stdio-' + i, version: '1' });
    await c.connect(
      new StdioClientTransport({
        command: process.execPath,
        args: [path.resolve('dist/node/cli.js'), 'mcp', '--project', p.root],
        env: { PATH: bin },
        stderr: 'pipe',
      }),
    );
    clients.push(c);
  }
  t.after(async () => {
    await Promise.all(clients.map((c) => c.close()));
  });
  const args = { projectId: p.id, snapshotId: snapshot.id };
  const tools = await clients[0].listTools();
  assert(tools.tools.some((t) => t.name === 'get_graph'));
  await clients[0].close();
  const g: any = await clients[1].callTool({
    name: 'get_graph',
    arguments: args,
  });
  assert.equal(JSON.parse(g.content[0].text).nodes[0].name, 'Stdio');
});
