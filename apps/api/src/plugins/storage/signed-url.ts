import crypto from 'node:crypto';

export type SignedTokenType = 'download' | 'upload';

interface SignedPayload {
  b: string;             // bucket id
  o: string;             // object name
  t: SignedTokenType;
  exp: number;           // unix epoch
}

function encode(payload: SignedPayload): string {
  return Buffer.from(JSON.stringify(payload)).toString('base64url');
}

function hmac(data: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(data).digest('base64url');
}

export function createToken(
  bucket: string,
  object: string,
  type: SignedTokenType,
  expiresIn: number,
  secret: string,
): string {
  const payload: SignedPayload = {
    b: bucket,
    o: object,
    t: type,
    exp: Math.floor(Date.now() / 1000) + expiresIn,
  };
  const data = encode(payload);
  return `${data}.${hmac(data, secret)}`;
}

export interface VerifiedToken {
  bucket: string;
  object: string;
  type: SignedTokenType;
}

export function verifyToken(
  token: string,
  secret: string,
): VerifiedToken | null {
  const dot = token.lastIndexOf('.');
  if (dot === -1) return null;
  const data = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  if (hmac(data, secret) !== sig) return null;
  try {
    const payload = JSON.parse(Buffer.from(data, 'base64url').toString()) as SignedPayload;
    if (payload.exp < Math.floor(Date.now() / 1000)) return null;
    return { bucket: payload.b, object: payload.o, type: payload.t };
  } catch {
    return null;
  }
}
