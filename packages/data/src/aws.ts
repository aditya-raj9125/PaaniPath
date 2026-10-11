import { createHash, createHmac } from 'node:crypto';
import { gzipSync, gunzipSync } from 'node:zlib';
import { AppError, assert } from '@paanipath/domain';
import type { Photo, Snapshot, Store } from './store.ts';

const sha256 = (value: string | Uint8Array): string => createHash('sha256').update(value).digest('hex');
const hmac = (key: string | Uint8Array, value: string): Buffer => createHmac('sha256', key).update(value).digest();

/** Minimal AWS Signature V4 transport; no browser credentials and no SDK dependency. */
async function awsRequest(service: 'dynamodb' | 's3', region: string, url: URL, method: string,
  body: string | Uint8Array, extraHeaders: Readonly<Record<string, string>> = {}, transport: typeof fetch = fetch): Promise<Response> {
  const access = process.env.AWS_ACCESS_KEY_ID;
  const secret = process.env.AWS_SECRET_ACCESS_KEY;
  assert(access && secret, 'AWS_CONFIGURATION', 'AWS runtime credentials are unavailable.', 500);
  const stamp = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '');
  const date = stamp.slice(0, 8);
  const headers: Record<string, string> = { host: url.host, 'x-amz-date': stamp, 'x-amz-content-sha256': sha256(body), ...extraHeaders };
  if (process.env.AWS_SESSION_TOKEN) headers['x-amz-security-token'] = process.env.AWS_SESSION_TOKEN;
  const names = Object.keys(headers).sort();
  const canonical = [method, url.pathname, url.searchParams.toString(), names.map(name => `${name}:${headers[name]?.trim()}\n`).join(''), names.join(';'), sha256(body)].join('\n');
  const scope = `${date}/${region}/${service}/aws4_request`;
  const key = hmac(hmac(hmac(hmac(`AWS4${secret}`, date), region), service), 'aws4_request');
  const signature = createHmac('sha256', key).update(`AWS4-HMAC-SHA256\n${stamp}\n${scope}\n${sha256(canonical)}`).digest('hex');
  headers.Authorization = `AWS4-HMAC-SHA256 Credential=${access}/${scope}, SignedHeaders=${names.join(';')}, Signature=${signature}`;
  const init: RequestInit = { method, headers, signal: AbortSignal.timeout(8000) };
  if (method !== 'GET') init.body = typeof body === 'string' ? body : Buffer.from(body);
  return transport(url, init);
}

export class DynamoStore implements Store {
  constructor(private readonly table: string, private readonly bucket: string, private readonly region: string, private readonly transport: typeof fetch = fetch) {}
  private async call(operation: string, body: unknown): Promise<Record<string, unknown>> {
    const response = await awsRequest('dynamodb', this.region, new URL(`https://dynamodb.${this.region}.amazonaws.com/`), 'POST', JSON.stringify(body),
      { 'content-type': 'application/x-amz-json-1.0', 'x-amz-target': `DynamoDB_20120810.${operation}` }, this.transport);
    const result = await response.json() as Record<string, unknown>;
    if (!response.ok) {
      if (String(result.__type).includes('ConditionalCheckFailed')) throw new AppError('CONFLICT', 'Concurrent update; retry.', 409);
      throw new AppError('STORAGE_UNAVAILABLE', 'The data service is unavailable. Please retry.', 503);
    }
    return result;
  }
  async read(): Promise<Snapshot | undefined> {
    const result = await this.call('GetItem', { TableName: this.table, Key: { pk: { S: 'PILOT' } }, ConsistentRead: true });
    if (result.Item === undefined) return undefined;
    const item = result.Item as { payload: { S: string }; encoding?: { S: string } };
    const payload = item.encoding?.S === 'gzip-base64' ? gunzipSync(Buffer.from(item.payload.S, 'base64'), { maxOutputLength: 32_000_000 }).toString('utf8') : item.payload.S;
    return JSON.parse(payload) as Snapshot;
  }
  async compareAndSwap(previousRevision: number | undefined, next: Snapshot): Promise<boolean> {
    const payload = gzipSync(JSON.stringify(next)).toString('base64');
    assert(Buffer.byteLength(payload) < 350_000, 'PILOT_CAPACITY', 'This pilot store has reached its capacity. Export reports before expanding the pilot.', 503);
    try {
      await this.call('PutItem', { TableName: this.table,
        Item: { pk: { S: 'PILOT' }, revision: { N: String(next.revision) }, payload: { S: payload }, encoding: { S: 'gzip-base64' } },
        ConditionExpression: previousRevision === undefined ? 'attribute_not_exists(pk)' : 'revision = :previous',
        ...(previousRevision === undefined ? {} : { ExpressionAttributeValues: { ':previous': { N: String(previousRevision) } } }) });
      return true;
    } catch (error) {
      if (error instanceof AppError && error.code === 'CONFLICT') return false;
      throw error;
    }
  }
  async putPhoto(id: string, photo: Photo): Promise<void> {
    const response = await awsRequest('s3', this.region, new URL(`https://${this.bucket}.s3.${this.region}.amazonaws.com/photos/${id}`), 'PUT', photo.bytes,
      { 'content-type': photo.contentType }, this.transport);
    assert(response.ok, 'PHOTO_STORAGE', 'Photo upload failed. Please retry.', 503);
  }
  async getPhoto(id: string): Promise<Photo | undefined> {
    const response = await awsRequest('s3', this.region, new URL(`https://${this.bucket}.s3.${this.region}.amazonaws.com/photos/${id}`), 'GET', '', {}, this.transport);
    if (response.status === 404) return undefined;
    assert(response.ok, 'PHOTO_STORAGE', 'Photo is temporarily unavailable.', 503);
    const contentType = response.headers.get('content-type');
    assert(contentType === 'image/jpeg' || contentType === 'image/png', 'PHOTO_STORAGE', 'Invalid photo content type.', 500);
    return { contentType, bytes: new Uint8Array(await response.arrayBuffer()) };
  }
}
