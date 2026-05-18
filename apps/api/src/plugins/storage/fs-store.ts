import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

export function objectFilePath(storageDir: string, bucketId: string, name: string): string {
  return path.join(storageDir, bucketId, name);
}

export async function ensureBucketDir(storageDir: string, bucketId: string): Promise<void> {
  await fs.mkdir(path.join(storageDir, bucketId), { recursive: true });
}

export async function writeObject(
  storageDir: string,
  bucketId: string,
  name: string,
  data: Buffer,
): Promise<{ etag: string; size: number }> {
  const filePath = objectFilePath(storageDir, bucketId, name);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, data);
  const etag = `"${crypto.createHash('md5').update(data).digest('hex')}"`;
  return { etag, size: data.length };
}

export async function readObject(
  storageDir: string,
  bucketId: string,
  name: string,
): Promise<Buffer | null> {
  try {
    return await fs.readFile(objectFilePath(storageDir, bucketId, name));
  } catch {
    return null;
  }
}

export async function deleteObjects(
  storageDir: string,
  bucketId: string,
  names: string[],
): Promise<void> {
  await Promise.all(
    names.map(async (name) => {
      try {
        await fs.unlink(objectFilePath(storageDir, bucketId, name));
        await pruneEmptyDirs(storageDir, bucketId, name);
      } catch {
        // ignore missing files
      }
    }),
  );
}

export async function deleteBucketDir(storageDir: string, bucketId: string): Promise<void> {
  await fs.rm(path.join(storageDir, bucketId), { recursive: true, force: true });
}

async function pruneEmptyDirs(storageDir: string, bucketId: string, name: string): Promise<void> {
  const bucketRoot = path.join(storageDir, bucketId);
  let dir = path.dirname(objectFilePath(storageDir, bucketId, name));
  while (dir !== bucketRoot && dir.startsWith(bucketRoot)) {
    const entries = await fs.readdir(dir).catch(() => null);
    if (!entries || entries.length > 0) break;
    await fs.rmdir(dir).catch(() => {});
    dir = path.dirname(dir);
  }
}
