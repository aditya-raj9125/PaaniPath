import { createApplication } from './runtime.ts';

interface HttpEvent { readonly rawPath: string; readonly headers: Record<string, string>; readonly cookies?: readonly string[]; readonly body?: string; readonly isBase64Encoded?: boolean; readonly requestContext: { readonly http: { readonly method: string } } }
const application = createApplication();
export async function handler(event: HttpEvent): Promise<unknown> {
  const result = await application.handle({ method: event.requestContext.http.method, path: event.rawPath,
    headers: { ...event.headers, cookie: event.cookies?.join('; ') ?? event.headers.cookie },
    body: event.isBase64Encoded ? Buffer.from(event.body ?? '', 'base64').toString('utf8') : event.body ?? '' });
  const binary = result.body instanceof Uint8Array;
  const { 'set-cookie': cookie, ...headers } = result.headers;
  return { statusCode: result.status, headers, ...(cookie === undefined ? {} : { cookies: [cookie] }),
    body: binary ? Buffer.from(result.body).toString('base64') : result.body, isBase64Encoded: binary };
}
