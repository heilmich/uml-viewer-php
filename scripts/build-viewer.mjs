import { build } from 'esbuild';
import { chmod } from 'node:fs/promises';
// Leave dependency imports intact for the host bundler. Bundling CommonJS React
// shims into an ESM library would introduce dynamic require('react') calls.
await build({
  entryPoints: ['viewer/index.tsx'],
  outfile: 'dist/viewer/index.js',
  bundle: true,
  format: 'esm',
  platform: 'browser',
  external: [
    'react',
    'react-dom',
    'react/jsx-runtime',
    '@xyflow/react',
    '@dagrejs/dagre',
    'zod',
  ],
  minify: true,
});
await build({
  entryPoints: ['viewer/bundle.css'],
  outfile: 'dist/viewer/index.css',
  bundle: true,
  minify: true,
});
await chmod('dist/node/cli.js', 0o755);
