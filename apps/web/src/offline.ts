import type { ReportInput } from '@paanipath/domain';
import { reportInput } from '@paanipath/domain';
import { api, ApiClientError } from './api.ts';

const KEY = 'paanipath-pending-reports-v1';
export function queuedReports(): ReportInput[] {
  try {
    const values: unknown = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(values) ? values.slice(0, 10).map(reportInput) : [];
  } catch { return []; }
}
export function queueReport(report: ReportInput): void {
  const previous = queuedReports();
  if (previous.length >= 10) throw new Error('Offline queue is full. Reconnect to sync your reports.');
  localStorage.setItem(KEY, JSON.stringify([...previous, report]));
}
export async function flushReports(): Promise<number> {
  const reports = queuedReports();
  let synced = 0;
  while (reports.length > 0) {
    const report = reports[0];
    if (report === undefined) break;
    try { await api.report(report); }
    catch (error) {
      if (!(error instanceof ApiClientError && error.code === 'ALREADY_REPORTED')) break;
    }
    reports.shift(); synced++;
    localStorage.setItem(KEY, JSON.stringify(reports));
  }
  return synced;
}
