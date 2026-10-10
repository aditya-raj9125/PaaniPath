import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export interface Session { readonly actor: string; readonly cookie: string | undefined }
export function session(cookieHeader: string, secret: string, secure: boolean): Session {
  const token = cookieHeader.split(';').map(value => value.trim()).find(value => value.startsWith('pp_session='))?.slice(11);
  if (token !== undefined) {
    const [actor, signature] = token.split('.');
    if (actor !== undefined && signature !== undefined && /^[a-f0-9]{32}$/.test(actor)) {
      const expected = createHmac('sha256', secret).update(actor).digest('hex');
      const bytes = Buffer.from(signature, 'hex');
      if (bytes.length === 32 && timingSafeEqual(bytes, Buffer.from(expected, 'hex'))) return { actor, cookie: undefined };
    }
  }
  const actor = randomBytes(16).toString('hex');
  const signature = createHmac('sha256', secret).update(actor).digest('hex');
  return { actor, cookie: `pp_session=${actor}.${signature}; Path=/; HttpOnly; SameSite=Strict; Max-Age=2592000${secure ? '; Secure' : ''}` };
}
