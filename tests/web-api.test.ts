import { test } from 'node:test';
import assert from 'node:assert/strict';
import { api, ApiClientError } from '../apps/web/src/api.ts';

test('bootstrap allows 30 seconds for startup instead of the regular 12-second budget', async context => {
  const budgets: number[] = [];
  context.mock.method(AbortSignal, 'timeout', (milliseconds: number) => {
    budgets.push(milliseconds);
    return new AbortController().signal;
  });
  context.mock.method(globalThis, 'fetch', async (path: string, options: RequestInit) => {
    assert.equal(options.credentials, 'same-origin');
    assert.equal(options.method, undefined);
    assert(['/api/bootstrap', '/api/reports'].includes(path));
    return Response.json({ revision: 1 });
  });
  const result = await api.bootstrap();
  assert.equal(result.revision, 1);
  await api.reports();
  assert.deepEqual(budgets, [30_000, 12_000]);
});

test('bootstrap retries a timeout once with a fresh signal', async context => {
  const signals: Array<AbortSignal | null | undefined> = [];
  context.mock.method(globalThis, 'fetch', async (_path: string, options: RequestInit) => {
    signals.push(options.signal);
    if (signals.length === 1) throw new DOMException('signal timed out', 'TimeoutError');
    return Response.json({ revision: 2 });
  });
  assert.equal((await api.bootstrap()).revision, 2);
  assert.equal(signals.length, 2);
  assert.notEqual(signals[0], signals[1]);
});

test('bootstrap body-download timeouts are retried and remain bounded with a readable error', async context => {
  let attempts = 0;
  let controller = new AbortController();
  context.mock.method(AbortSignal, 'timeout', () => {
    controller = new AbortController();
    return controller.signal;
  });
  context.mock.method(globalThis, 'fetch', async () => {
    attempts++;
    const response = Response.json({ revision: 1 });
    context.mock.method(response, 'json', async () => {
      controller.abort(new DOMException('signal timed out', 'TimeoutError'));
      throw new DOMException('Body download aborted', 'AbortError');
    });
    return response;
  });
  await assert.rejects(api.bootstrap(), (error: unknown) => {
    assert(error instanceof ApiClientError);
    assert.equal(error.code, 'REQUEST_TIMEOUT');
    assert.match(error.message, /Check your connection/);
    return true;
  });
  assert.equal(attempts, 2);
});

test('bootstrap does not retry server errors, network failures or user cancellations', async context => {
  for (const failure of ['server', 'network', 'cancel']) {
    let attempts = 0;
    const mock = context.mock.method(globalThis, 'fetch', async () => {
      attempts++;
      if (failure === 'network') throw new TypeError('Failed to fetch');
      if (failure === 'cancel') throw new DOMException('Cancelled', 'AbortError');
      return Response.json({ error: { code: 'SERVICE_UNAVAILABLE', message: 'Unavailable' } }, { status: 503 });
    });
    await assert.rejects(api.bootstrap());
    assert.equal(attempts, 1);
    mock.mock.restore();
  }
});

test('mutating requests are never automatically retried after a timeout', async context => {
  let attempts = 0;
  context.mock.method(globalThis, 'fetch', async (_path: string, options: RequestInit) => {
    attempts++;
    assert.equal(options.method, 'POST');
    throw new DOMException('signal timed out', 'TimeoutError');
  });
  await assert.rejects(api.demo({ action: 'reset' }), { code: 'REQUEST_TIMEOUT' });
  assert.equal(attempts, 1);
});

test('caller-provided cancellation signal is preserved', async context => {
  const controller = new AbortController();
  context.mock.method(globalThis, 'fetch', async (_path: string, options: RequestInit) => {
    assert.equal(options.signal, controller.signal);
    throw new DOMException('Cancelled', 'AbortError');
  });
  await assert.rejects(api.places('Delhi', controller.signal), { name: 'AbortError' });
});
