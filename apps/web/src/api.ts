import type { ApiProblem, BootstrapResponse, PlaceSearchResponse, ReportInput, ReportsResponse, RouteRequest, RouteResponse, VoteInput } from '@paanipath/domain';

export class ApiClientError extends Error {
  constructor(readonly code: string, message: string, readonly status: number) { super(message); this.name = 'ApiClientError'; }
}
async function request<T>(path: string, body?: unknown, signal?: AbortSignal, timeoutMs = 12_000): Promise<T> {
  const options: RequestInit = { credentials: 'same-origin', signal: signal ?? AbortSignal.timeout(timeoutMs) };
  if (body !== undefined) {
    options.method = 'POST'; options.headers = { 'content-type': 'application/json', 'x-paanipath': '1' }; options.body = JSON.stringify(body);
  }
  try {
    const response = await fetch(path, options);
    if (!response.ok) {
      const problem = await response.json() as ApiProblem;
      throw new ApiClientError(problem.error.code, problem.error.message, response.status);
    }
    // Await the body too: the timeout also covers downloading the report catalogue.
    return await response.json() as T;
  } catch (error) {
    const reason: unknown = options.signal?.reason;
    if ((error instanceof Error && error.name === 'TimeoutError') ||
        (options.signal?.aborted && reason instanceof Error && reason.name === 'TimeoutError')) {
      throw new ApiClientError('REQUEST_TIMEOUT', 'Loading took too long. Check your connection and try again.', 0);
    }
    throw error;
  }
}

async function bootstrap(): Promise<BootstrapResponse> {
  try {
    return await request<BootstrapResponse>('/api/bootstrap', undefined, undefined, 30_000);
  } catch (error) {
    if (!(error instanceof ApiClientError) || error.code !== 'REQUEST_TIMEOUT') throw error;
    // One bounded retry for this read-only request; never replay reports or votes.
    return request<BootstrapResponse>('/api/bootstrap', undefined, undefined, 30_000);
  }
}
export const api = {
  bootstrap,
  reports: (): Promise<ReportsResponse> => request('/api/reports'),
  places: (query: string, signal: AbortSignal): Promise<PlaceSearchResponse> => request('/api/places/search', { query, online: true }, signal),
  routes: (body: RouteRequest, signal: AbortSignal): Promise<RouteResponse> => request('/api/routes', body, signal),
  report: (body: ReportInput): Promise<{ merged: boolean; revision: number }> => request('/api/reports', body),
  vote: (id: string, body: VoteInput): Promise<{ revision: number }> => request(`/api/reports/${encodeURIComponent(id)}/vote`, body),
  demo: (body: { action: string; edgeId?: string }): Promise<{ message: string; revision: number }> => request('/api/demo', body),
};
