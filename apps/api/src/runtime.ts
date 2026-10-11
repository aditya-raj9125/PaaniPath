import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { assert } from '@paanipath/domain';
import { DynamoStore, SqliteStore } from '@paanipath/data';
import { Application } from './application.ts';
import { PaaniPathService } from './service.ts';
import { PlaceSearch } from './places.ts';
import { ApiRouting } from './api-routing.ts';

export function createApplication(): Application {
  const aws = process.env.STORE === 'dynamodb';
  const demoMode = process.env.DEMO_MODE === 'true';
  const seededMode = process.env.SEED_MODE !== 'false';
  const directory = resolve(process.env.DATA_DIR ?? (demoMode ? '.data' : seededMode ? '.data/ncr-seeded' : '.data/ncr-live'));
  const store = aws ? new DynamoStore(process.env.TABLE_NAME ?? '', process.env.PHOTO_BUCKET ?? '', process.env.AWS_REGION ?? 'us-east-1') : new SqliteStore(directory);
  let secret = process.env.SESSION_SECRET;
  if (aws) assert(secret && secret.length >= 32, 'SESSION_SECRET_REQUIRED', 'AWS requires a shared session secret of at least 32 characters.', 500);
  else if (secret === undefined) {
    mkdirSync(directory, { recursive: true });
    const filename = resolve(directory, 'session-secret');
    if (!existsSync(filename)) writeFileSync(filename, randomBytes(32).toString('hex'), { flag: 'wx', mode: 0o600 });
    secret = readFileSync(filename, 'utf8');
  }
  assert(secret, 'SESSION_SECRET_REQUIRED', 'A session secret is required.', 500);
  const routing = new ApiRouting(process.env.ORS_API_KEY ?? '', process.env.ORS_URL ?? 'https://api.openrouteservice.org/v2/directions');
  return new Application(new PaaniPathService(store, { demoMode, seededMode, graphVersion: 'api-routing-v1', routing }), secret, aws,
    new PlaceSearch(process.env.PHOTON_URL ?? 'https://photon.komoot.io/api/'));
}
