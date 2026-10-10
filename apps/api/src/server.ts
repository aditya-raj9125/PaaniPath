import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { createApplication } from './runtime.ts';

export const application = createApplication();
const webRoot = resolve('dist/web');
const MIME: Readonly<Record<string, string>> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json', '.webmanifest': 'application/manifest+json' };
const CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https://tile.openstreetmap.org; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'";

async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
    size += bytes.length;
    if (size > 1_500_000) throw new Error('PAYLOAD_TOO_LARGE');
    chunks.push(bytes);
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function serve(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const pathname = new URL(request.url ?? '/', 'http://localhost').pathname;
  if (pathname.startsWith('/api/')) {
    const headers: Record<string, string | undefined> = {};
    for (const [name, value] of Object.entries(request.headers)) headers[name] = Array.isArray(value) ? value.join(';') : value;
    const result = await application.handle({ method: request.method ?? 'GET', path: pathname, headers, body: await readBody(request) });
    response.writeHead(result.status, result.headers); response.end(result.body); return;
  }
  if (request.method !== 'GET' && request.method !== 'HEAD') { response.writeHead(405, { allow: 'GET, HEAD' }); response.end(); return; }
  const file = resolve(webRoot, `.${decodeURIComponent(pathname === '/' ? '/index.html' : pathname)}`);
  if (!file.startsWith(webRoot + sep)) { response.writeHead(403); response.end(); return; }
  try {
    const info = await stat(file);
    if (!info.isFile()) throw new Error('NOT_FOUND');
    const bytes = await readFile(file);
    response.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream', 'content-security-policy': CSP,
      'x-content-type-options': 'nosniff', 'referrer-policy': 'strict-origin-when-cross-origin', 'cache-control': file.endsWith('sw.js') ? 'no-cache' : 'public, max-age=300' });
    response.end(request.method === 'HEAD' ? undefined : bytes);
  } catch { response.writeHead(404); response.end('Not found'); }
}

export const server = createServer((request, response) => {
  void serve(request, response).catch(error => {
    if (!response.headersSent) response.writeHead(error instanceof Error && error.message === 'PAYLOAD_TOO_LARGE' ? 413 : 500, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ error: { code: 'REQUEST_FAILED', message: 'Could not process the request.' } }));
  });
});
server.requestTimeout = 15_000;
server.headersTimeout = 10_000;
const port = Number(process.env.PORT ?? 3000);
server.listen(port, process.env.HOST ?? '127.0.0.1', () => {
  const address = server.address();
  console.log(`PaaniPath → http://localhost:${typeof address === 'object' && address !== null ? address.port : port}`);
});
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => server.close(() => process.exit(0)));
