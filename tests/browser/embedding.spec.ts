import { test, expect } from '@playwright/test';
import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
let script: string, css: string;
test.beforeAll(async () => {
  const entry = path.resolve('dist/viewer/index.js');
  const result = await build({
    stdin: {
      contents: `import React from 'react';import {createRoot} from 'react-dom/client';import {Viewer} from ${JSON.stringify(entry)};
 const root=createRoot(document.getElementById('root'));
 const snapshot={schemaVersion:1,id:'snapshot',project:{id:'project',root:'/tmp/project',name:'Embedding'},metadata:{analyzerVersion:'v',createdAt:'now',commit:null,fingerprint:'f',language:'php',durationMs:0,complete:true,fileCount:2},nodes:[{id:'Foo.A',name:'A'},{id:'Bar.B',name:'B'}],edges:[],diagnostics:[],policy:{prefix:'App',levels:[],omit:[],order:[],'edge-kinds':{},'omit-edges':[],excludes:[]}};
 const proposal={schemaVersion:1,id:'p',name:'P',version:1,notice:'PROPOSAL',omit:[],layers:[{id:'l',label:'Layer',nses:[{id:'outer',label:'Outer',nses:[{id:'inner',label:'Inner',nses:['Foo']}]}]}]};
 window.render=(state)=>root.render(React.createElement(Viewer,{snapshot,proposals:[proposal],state,onStateChange:s=>window.lastState=s}));`,
      resolveDir: process.cwd(),
      loader: 'tsx',
    },
    bundle: true,
    write: false,
    format: 'iife',
    platform: 'browser',
  });
  script = result.outputFiles[0].text;
  css = await readFile('dist/viewer/index.css', 'utf8');
});
async function mount(page: any) {
  await page.setContent('<div id="root"></div>');
  await page.addStyleTag({ content: css });
  await page.addScriptTag({ content: script });
}
test('review: the exported viewer applies navigation, selection and viewport when a host switches sessions', async ({
  page,
}) => {
  await mount(page);
  await page.evaluate(() =>
    (window as any).render({
      path: 'Foo',
      selectedId: 'Foo.A',
      x: 0,
      y: 0,
      zoom: 1,
      proposalId: null,
    }),
  );
  await expect(page.locator('aside h2')).toHaveText('A');
  await expect(page.getByRole('navigation')).toContainText('Foo');
  await page.evaluate(() =>
    (window as any).render({
      path: 'Bar',
      selectedId: 'Bar.B',
      x: 20,
      y: 40,
      zoom: 0.5,
      proposalId: null,
    }),
  );
  await expect(page.locator('aside h2')).toHaveText('B');
  await expect(page.getByRole('navigation')).toContainText('Bar');
  await expect(page.getByRole('navigation')).not.toContainText('Foo');
  await expect
    .poll(() =>
      page
        .locator('.react-flow__viewport')
        .evaluate((el: any) => getComputedStyle(el).transform),
    )
    .toBe('matrix(0.5, 0, 0, 0.5, 20, 40)');
  await page.evaluate(() =>
    (window as any).render({
      path: '',
      selectedId: '',
      x: 20,
      y: 40,
      zoom: 0.5,
      proposalId: null,
    }),
  );
  await expect(
    page.getByRole('combobox', { name: 'Architecture mode' }),
  ).toHaveValue('');
  await page.evaluate(() =>
    (window as any).render({
      path: '',
      selectedId: '',
      x: 20,
      y: 40,
      zoom: 0.5,
      proposalId: 'p',
    }),
  );
  await expect(
    page.getByRole('combobox', { name: 'Architecture mode' }),
  ).toHaveValue('p');
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  await expect(page.locator('.react-flow__viewport')).toHaveCSS(
    'transform',
    'matrix(0.5, 0, 0, 0.5, 20, 40)',
  );
});
test('review: nested proposal groups have working breadcrumbs and return to their immediate parent', async ({
  page,
}) => {
  await mount(page);
  await page.evaluate(() =>
    (window as any).render({
      path: 'proposal.l',
      selectedId: '',
      x: 0,
      y: 0,
      zoom: 1,
      proposalId: 'p',
    }),
  );
  await page.getByTestId('rf__node-group.outer').click();
  await page.getByRole('button', { name: 'Explore component' }).click();
  await page.getByTestId('rf__node-group.inner').click();
  await page.getByRole('button', { name: 'Explore component' }).click();
  await expect(page.getByTestId('rf__node-Foo.A')).toBeVisible();
  const nav = page.getByRole('navigation');
  await expect(nav).toContainText('Layer');
  await expect(nav).toContainText('Outer');
  await expect(nav).toContainText('Inner');
  await page.getByRole('button', { name: '← Back', exact: true }).click();
  await expect(page.getByTestId('rf__node-group.inner')).toBeVisible();
  await expect(nav).not.toContainText('Inner');
  await page.getByRole('button', { name: 'Layer', exact: true }).click();
  await expect(page.getByTestId('rf__node-group.outer')).toBeVisible();
});
