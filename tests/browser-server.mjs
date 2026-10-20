import { cp, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Project, readDocument } from '../dist/node/service/project.js';
import { serve } from '../dist/node/service/http.js';
const root = await mkdtemp(path.join(tmpdir(), 'uml-browser-'));
await cp('examples/php-shop', root, {
  recursive: true,
  filter: (source) => !source.split(path.sep).includes('.uml-viewer'),
});
await writeFile(
  path.join(root, 'src/Html.php'),
  '<?php namespace Shop; class Html {} // <img src=x onerror="window.SOURCE_EXECUTED=true">',
);
const p = await Project.open(root);
await p.scan({ policy: await readDocument('examples/php-shop.policy.edn') });
await serve(p, { port: 4317 });
