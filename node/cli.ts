#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { readFile, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { Project, readDocument } from './service/project.js';
import { serve } from './service/http.js';
import { runMcp } from './integration/mcp.js';
import { policySchema } from './core/model.js';
import { convertDocument } from './core/edn.js';
const help = `uml-viewer — Node.js architecture viewer
  serve --project PATH [--port 0] [--open] [--policy FILE] [--lang php]
  scan --project PATH [--lang php|typescript|javascript|python|rust|clojure|polyglot] [--policy FILE] [--out FILE] [--facts]
  convert --input FILE.edn --out FILE.json
  import --project PATH --input FILE.edn
  import --project PATH --input old-graph.edn
  metrics --project PATH --input metrics.edn
  mcp --project PATH
Exit codes: 0 complete/success, 1 command failure, 2 partial scan (JSON still emitted).
No command executes analyzed project code or starts an agent.`;
async function main() {
  const { values: v, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      project: { type: 'string' },
      lang: { type: 'string' },
      policy: { type: 'string' },
      out: { type: 'string' },
      input: { type: 'string' },
      port: { type: 'string' },
      open: { type: 'boolean' },
      facts: { type: 'boolean' },
      help: { type: 'boolean' },
    },
  });
  const command = positionals[0];
  if (v.help || !command) {
    console.log(help);
    return;
  }
  if (command === 'convert') {
    if (!v.input || !v.out) throw Error('--input and --out required');
    await writeFile(
      v.out,
      JSON.stringify(convertDocument(await readDocument(v.input)), null, 2) +
        '\n',
    );
    return;
  }
  if (!v.project) throw Error('--project required');
  const project = await Project.open(v.project);
  if (command === 'mcp') {
    await runMcp(project);
    return;
  }
  if (command === 'metrics') {
    if (!v.input) throw Error('--input required');
    console.log(
      JSON.stringify(
        await project.importMetrics([await readDocument(v.input)]),
      ),
    );
    return;
  }
  if (command === 'import') {
    if (!v.input) throw Error('--input required');
    const data = await readDocument(v.input);
    console.log(
      JSON.stringify(await project.importGraph(data, policySchema.parse(data))),
    );
    return;
  }
  if (command === 'scan') {
    const snapshot = await project.scan({
      language: v.lang,
      policy: v.policy ? await readDocument(v.policy) : undefined,
    });
    const data = v.facts
      ? JSON.parse(await readFile(project.dataDir + '/facts.json', 'utf8'))
      : snapshot;
    const json = JSON.stringify(data, null, 2) + '\n';
    if (v.out) await writeFile(v.out, json);
    else process.stdout.write(json);
    if (!snapshot.metadata.complete) process.exitCode = 2;
    return;
  }
  if (command === 'serve') {
    if (v.policy || v.lang)
      await project.scan({
        language: v.lang,
        policy: v.policy ? await readDocument(v.policy) : undefined,
      });
    const port = v.port === undefined ? 0 : Number(v.port);
    if (!Number.isInteger(port) || port < 0 || port > 65535)
      throw Error('Invalid port');
    const running = await serve(project, { port });
    console.log(
      JSON.stringify({
        url: running.url,
        projectId: project.id,
        root: project.root,
      }),
    );
    if (v.open) {
      const cmd =
        process.platform === 'darwin'
          ? 'open'
          : process.platform === 'win32'
            ? 'cmd'
            : 'xdg-open';
      const args =
        process.platform === 'win32'
          ? ['/c', 'start', '', running.url]
          : [running.url];
      const child = spawn(cmd, args, { stdio: 'ignore' });
      child.on('error', () =>
        console.error(
          'Could not open browser; open the printed address manually.',
        ),
      );
      child.unref();
    }
    const close = () => running.server.close(() => process.exit(0));
    process.on('SIGTERM', close);
    process.on('SIGINT', close);
    return;
  }
  throw Error('Unknown command: ' + command);
}
main().catch((e) => {
  console.error('uml-viewer: ' + e.message);
  process.exitCode = 1;
});
