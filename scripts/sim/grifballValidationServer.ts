import { createServer } from 'node:http';
import { createReadStream, realpathSync, statSync } from 'node:fs';
import { extname, resolve, sep } from 'node:path';
import { canonicalJSON } from '../../src/game/grifballValidation/plan';

export const IDENTITY_PATH = '/__grifball_validation_build__';
const MIME: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.wasm': 'application/wasm', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.webp': 'image/webp', '.ico': 'image/x-icon', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav',
  '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json', '.woff2': 'font/woff2' };
/** Own only this listener. A pre-existing listener must attest to the exact build/runtime identity. */
export async function startValidationServer(identity: unknown, production: string, validation: string, port = 3000) {
  const roots = { production: realpathSync(production), validation: realpathSync(validation) };
  const server = createServer((req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405).end(); return; }
    const pathname = new URL(req.url ?? '/', 'http://localhost').pathname;
    if (pathname === IDENTITY_PATH) { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(identity)); return; }
    try {
      const isValidation = pathname.startsWith('/validation/');
      const root = isValidation ? roots.validation : roots.production;
      const requested = decodeURIComponent(isValidation ? pathname.slice('/validation/'.length) : pathname.slice(1));
      const path = realpathSync(resolve(root, requested || 'index.html'));
      if (!path.startsWith(root + sep) || !statSync(path).isFile()) { res.writeHead(404).end(); return; }
      res.setHeader('Content-Type', MIME[extname(path)] ?? 'application/octet-stream');
      if (req.method === 'HEAD') { res.end(); return; }
      createReadStream(path).on('error', () => res.destroy()).pipe(res);
    } catch { res.writeHead(404).end('Not found'); }
  });
  let owned = true;
  try {
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', () => { server.removeListener('error', reject); resolve(); }); });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EADDRINUSE') throw error;
    owned = false;
    let actual: unknown;
    try { actual = await (await fetch(`http://127.0.0.1:${port}${IDENTITY_PATH}`, { signal: AbortSignal.timeout(2000) })).json(); } catch { /* unverified listener */ }
    if (canonicalJSON(actual ?? null) !== canonicalJSON(identity))
      throw new Error(`Port ${port} is occupied by an unverified or different build. Stop that server explicitly or use its matching run. No process was killed.`);
  }
  const address = server.address();
  const origin = `http://127.0.0.1:${owned && address && typeof address !== 'string' ? address.port : port}`;
  return { origin, owned, close: async () => {
    if (!owned) return;
    server.closeAllConnections(); await new Promise<void>((resolve, reject) => server.close(err => err ? reject(err) : resolve()));
  } };
}
