import { createServer, type IncomingMessage } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { Project, Conflict } from './project.js';
export async function serve(
  project: Project,
  options: { port?: number; host?: string } = {},
) {
  const token = randomBytes(32).toString('hex');
  const host = options.host ?? '127.0.0.1';
  if (!['127.0.0.1', '::1', 'localhost'].includes(host))
    throw Error('Only loopback hosts are supported');
  try {
    await project.snapshot();
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') await project.scan();
    else throw e;
  }
  const assets = fileURLToPath(new URL('../../web/', import.meta.url));
  async function body(req: IncomingMessage) {
    let text = '';
    for await (const chunk of req) {
      text += chunk;
      if (text.length > 1_000_000) throw Error('Request body too large');
    }
    return text ? JSON.parse(text) : {};
  }
  const server = createServer(async (req, res) => {
    const json = (status: number, value: unknown) => {
      res.writeHead(status, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      });
      res.end(JSON.stringify(value));
    };
    try {
      const actual = server.address();
      const port = typeof actual === 'object' && actual ? actual.port : 0;
      const allowed = new Set([
        `127.0.0.1:${port}`,
        `localhost:${port}`,
        `[::1]:${port}`,
      ]);
      if (!allowed.has(req.headers.host ?? ''))
        return json(403, { error: 'Invalid host' });
      const origin = `http://${req.headers.host}`;
      if (req.headers.origin && req.headers.origin !== origin)
        return json(403, { error: 'Cross-origin request refused' });
      const url = new URL(req.url ?? '/', origin);
      if (url.pathname === '/api/bootstrap') {
        if (req.method !== 'GET')
          return json(405, { error: 'Method not allowed' });
        return json(200, {
          token,
          project: { id: project.id, root: project.root, name: project.name },
          snapshotId: (await project.snapshot()).id,
        });
      }
      if (url.pathname.startsWith('/api/')) {
        if (url.searchParams.get('project') !== project.id)
          return json(400, { error: 'Explicit project ID required' });
        if (req.method !== 'GET') {
          const supplied = req.headers['x-uml-token'];
          if (
            typeof supplied !== 'string' ||
            supplied.length !== token.length ||
            !timingSafeEqual(Buffer.from(supplied), Buffer.from(token))
          )
            return json(403, { error: 'Invalid action token' });
        }
        const snapshotId = url.searchParams.get('snapshot');
        if (!snapshotId)
          return json(400, { error: 'Explicit snapshot ID required' });
        const snapshot = await project.snapshot(snapshotId);
        if (url.pathname === '/api/graph' && req.method === 'GET')
          return json(200, { snapshot, stale: await project.stale(snapshot) });
        if (url.pathname === '/api/scan' && req.method === 'POST')
          return json(200, await project.scan());
        if (url.pathname === '/api/source' && req.method === 'GET') {
          const element = snapshot.nodes.find(
            (n) => n.id === url.searchParams.get('element'),
          );
          if (!element?.file)
            return json(404, { error: 'Element has no source' });
          return json(200, {
            file: element.file,
            line: element.line,
            code: await project.source(element.file),
          });
        }
        if (url.pathname === '/api/proposals') {
          if (req.method === 'GET') return json(200, await project.proposals());
          const data = await body(req);
          if (
            typeof data.id !== 'string' ||
            !Number.isInteger(data.expectedVersion)
          )
            return json(400, { error: 'id and expectedVersion required' });
          if (req.method === 'PUT')
            return json(
              200,
              await project.updateProposal(
                data.id,
                data.expectedVersion,
                data.proposal,
              ),
            );
          if (req.method === 'DELETE') {
            await project.deleteProposal(data.id, data.expectedVersion);
            return json(200, { deleted: true });
          }
        }
        if (url.pathname === '/api/context') {
          const session = url.searchParams.get('session');
          if (!session)
            return json(400, { error: 'Explicit session ID required' });
          if (req.method === 'GET')
            return json(200, { context: await project.context(session) });
          if (req.method === 'PUT') {
            const data = await body(req);
            return json(200, {
              context: await project.context(session, {
                projectId: project.id,
                snapshotId,
                selection: data.selection,
                proposalId: data.proposalId,
                discussion: data.discussion,
              }),
            });
          }
        }
        return json(404, { error: 'Unknown operation' });
      }
      if (req.method !== 'GET')
        return json(405, { error: 'Method not allowed' });
      const requested =
        url.pathname === '/'
          ? 'index.html'
          : decodeURIComponent(url.pathname).replace(/^\//, '');
      const absolute = path.resolve(assets, requested);
      if (!absolute.startsWith(path.resolve(assets) + path.sep))
        return json(403, { error: 'Invalid asset path' });
      const bytes = await readFile(absolute);
      const ext = path.extname(absolute);
      res.writeHead(200, {
        'Content-Type':
          (
            {
              '.html': 'text/html; charset=utf-8',
              '.js': 'text/javascript; charset=utf-8',
              '.css': 'text/css; charset=utf-8',
              '.svg': 'image/svg+xml',
            } as Record<string, string>
          )[ext] ?? 'application/octet-stream',
        'Content-Security-Policy':
          "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'self'; object-src 'none'",
        'X-Content-Type-Options': 'nosniff',
      });
      res.end(bytes);
    } catch (e) {
      if (e instanceof Conflict)
        return json(409, { error: e.message, current: e.current });
      if ((e as NodeJS.ErrnoException).code === 'ENOENT')
        return json(404, { error: 'Not found' });
      return json(400, { error: (e as Error).message });
    }
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port ?? 0, host, () => resolve());
  });
  const addr = server.address();
  return {
    server,
    url: `http://${host === '::1' ? '[::1]' : host}:${typeof addr === 'object' && addr ? addr.port : 0}`,
    projectId: project.id,
  };
}
