import { chromium } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { Project, readDocument } from '../dist/node/service/project.js';
import { serve } from '../dist/node/service/http.js';
const project = await Project.open(process.argv[2]);
const policy = process.argv[3] ? await readDocument(process.argv[3]) : {};
const snapshot = await project.scan({ policy });
const running = await serve(project);
let browser;
try {
  browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH ?? '/usr/bin/chromium',
    args: ['--no-sandbox'],
  });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  const started = performance.now();
  await page.goto(running.url);
  await page.locator('.react-flow__node').first().waitFor();
  await page.evaluate(
    () =>
      new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
  );
  const report = {
    project: project.root,
    commit: snapshot.metadata.commit,
    files: snapshot.metadata.fileCount,
    declarations: snapshot.nodes.filter((n) => !n.foreign).length,
    externalNodes: snapshot.nodes.filter((n) => n.foreign).length,
    relations: snapshot.edges.length,
    complete: snapshot.metadata.complete,
    analysisMs: snapshot.metadata.durationMs,
    browserNavigationToPaintMs: Math.round(performance.now() - started),
    renderedNodes: await page.locator('.react-flow__node').count(),
    renderedEdges: await page.locator('.react-flow__edge').count(),
    node: process.version,
    chromium: browser.version(),
    viewport: '1440x1000',
    note: 'Single cold browser navigation, including HTTP and JavaScript bootstrap; not an isolated React render benchmark.',
  };
  console.log(JSON.stringify(report, null, 2));
  await page.screenshot({ path: '/tmp/uml-viewer-benchmark.png' });
  if (process.argv[4])
    await writeFile(process.argv[4], JSON.stringify(report, null, 2) + '\n');
} finally {
  await browser?.close();
  await new Promise((r) => running.server.close(r));
}
