import { randomUUID } from 'node:crypto';
import { AppError, assert } from '@paanipath/domain';
import { PaaniPathService } from './service.ts';
import { session } from './session.ts';
import { PlaceSearch } from './places.ts';

export interface ApiRequest { readonly method: string; readonly path: string; readonly headers: Readonly<Record<string, string | undefined>>; readonly body: string }
export interface ApiResponse { readonly status: number; readonly headers: Readonly<Record<string, string>>; readonly body: string | Uint8Array }

export class Application {
  constructor(readonly service: PaaniPathService, private readonly secret: string, private readonly secure = false,
    private readonly places = new PlaceSearch()) {}
  async handle(request: ApiRequest): Promise<ApiResponse> {
    const requestId = randomUUID();
    const actor = session(request.headers.cookie ?? '', this.secret, this.secure);
    const headers: Record<string, string> = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store',
      'x-content-type-options': 'nosniff', 'x-request-id': requestId };
    if (actor.cookie !== undefined) headers['set-cookie'] = actor.cookie;
    try {
      assert(request.body.length <= 1_500_000, 'PAYLOAD_TOO_LARGE', 'Request exceeds the upload limit.', 413);
      if (request.method !== 'GET') {
        assert(request.headers['x-paanipath'] === '1', 'INVALID_ORIGIN', 'Use the PaaniPath application to submit updates.', 403);
        assert((request.headers['content-type'] ?? '').includes('application/json'), 'CONTENT_TYPE', 'Use application/json.', 415);
      }
      const value = await this.dispatch(request, actor.actor);
      if (value instanceof Uint8Array) return { status: 200, headers: { ...headers, 'content-type': value[0] === 137 ? 'image/png' : 'image/jpeg', 'cache-control': 'private, max-age=3600' }, body: value };
      return { status: request.method === 'POST' && request.path === '/api/reports' ? 201 : 200, headers, body: JSON.stringify(value) };
    } catch (error) {
      const known = error instanceof AppError;
      if (!known) console.error(JSON.stringify({ requestId, code: 'INTERNAL_ERROR', error: error instanceof Error ? error.message : 'unknown' }));
      if (known && error.status === 429) headers['retry-after'] = '60';
      return { status: known ? error.status : 500, headers,
        body: JSON.stringify({ error: { code: known ? error.code : 'INTERNAL_ERROR',
          message: known ? error.message : 'Something went wrong. Please retry.', requestId } }) };
    }
  }

  private async dispatch(request: ApiRequest, actor: string): Promise<unknown> {
    const { method, path } = request;
    if (method === 'GET' && path === '/api/health') return { status: 'ok', name: 'PaaniPath', graphSource: 'openrouteservice' };
    if (method === 'GET' && path === '/api/bootstrap') return this.service.bootstrap(actor);
    if (method === 'GET' && path === '/api/reports') return this.service.reports();
    if (method === 'POST' && path === '/api/places/search') {
      const body = parseJson(request.body);
      assert(body !== null && typeof body === 'object' && 'query' in body && typeof body.query === 'string', 'INVALID_SEARCH', 'Enter a valid place search.');
      return this.places.search(body.query, 'online' in body && body.online === true);
    }
    if (method === 'GET' && /^\/api\/photos\/[a-f0-9-]{36}$/.test(path)) {
      const photo = await this.service.store.getPhoto(path.slice('/api/photos/'.length));
      assert(photo, 'NOT_FOUND', 'Photo not found.', 404);
      return photo.bytes;
    }
    const body = parseJson(request.body);
    if (method === 'POST' && path === '/api/routes') return this.service.routes(body);
    if (method === 'POST' && path === '/api/reports') return this.service.report(body, actor);
    if (method === 'POST' && /^\/api\/reports\/[^/]+\/vote$/.test(path)) return this.service.vote(path.split('/')[3] ?? '', body, actor);
    if (method === 'POST' && path === '/api/demo') return this.service.simulate(body, actor);
    throw new AppError('NOT_FOUND', 'This API endpoint does not exist.', 404);
  }
}

function parseJson(body: string): unknown {
  if (body.length === 0) return {};
  try { return JSON.parse(body) as unknown; }
  catch { throw new AppError('INVALID_JSON', 'Request body is not valid JSON.'); }
}
