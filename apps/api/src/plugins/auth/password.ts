import { hash, verify, Algorithm } from '@node-rs/argon2';

export async function hashPassword(password: string): Promise<string> {
  return hash(password, {
    algorithm: Algorithm.Argon2id,
    memoryCost: 65536,
    timeCost: 3,
    parallelism: 4,
  });
}

export async function verifyPassword(hashStr: string, password: string): Promise<boolean> {
  return verify(hashStr, password);
}
