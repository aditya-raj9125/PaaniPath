import type { ApiProblem, BootstrapResponse, PlaceSearchResponse, ReportInput, ReportsResponse, RouteRequest, RouteResponse, VoteInput } from '@paanipath/domain';

export class ApiClientError extends Error {
  constructor(readonly code: string, message: string, readonly status: number) { super(message); this.name = 'ApiClientError'; }
}
async function request<T>(path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const options: RequestInit = { credentials: 'same-origin', signal: signal ?? AbortSignal.timeout(12_000) };
  if (body !== undefined) {
    options.method = 'POST'; options.headers = { 'content-type': 'application/json', 'x-paanipath': '1' }; options.body = JSON.stringify(body);
  }
  const response = await fetch(path, options);
  if (!response.ok) {
    const problem = await response.json() as ApiProblem;
    throw new ApiClientError(problem.error.code, problem.error.message, response.status);
  }
  return response.json() as Promise<T>;
}
export const api = {
  bootstrap: (): Promise<BootstrapResponse> => request('/api/bootstrap'),
  reports: (): Promise<ReportsResponse> => request('/api/reports'),
  places: (query: string, signal: AbortSignal): Promise<PlaceSearchResponse> => request('/api/places/search', { query, online: true }, signal),
  routes: (body: RouteRequest, signal: AbortSignal): Promise<RouteResponse> => request('/api/routes', body, signal),
  report: (body: ReportInput): Promise<{ merged: boolean; revision: number }> => request('/api/reports', body),
  vote: (id: string, body: VoteInput): Promise<{ revision: number }> => request(`/api/reports/${encodeURIComponent(id)}/vote`, body),
  demo: (body: { action: string; edgeId?: string }): Promise<{ message: string; revision: number }> => request('/api/demo', body),
};
