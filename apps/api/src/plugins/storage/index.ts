import crypto from 'node:crypto';
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { resolveLocalProject } from '../../hooks/resolve-project.js';
import { authenticateProject, authenticateProjectOptional } from '../../hooks/authenticate.js';
import {
  ensureBucketDir,
  writeObject,
  readObject,
  deleteObjects,
  deleteBucketDir,
} from './fs-store.js';
import { createToken, verifyToken } from './signed-url.js';

export interface StoragePluginOptions {
  storageDir: string;
}

// ── Error helper ─────────────────────────────────────────────────────────────

function storageError(reply: FastifyReply, status: number, error: string, message: string) {
  return reply.status(status).send({ statusCode: String(status), error, message });
}

// ── Body reading ──────────────────────────────────────────────────────────────

interface UploadedFile {
  data: Buffer;
  contentType: string;
  cacheControl: string;
  userMetadata: Record<string, unknown> | null;
}

async function readUpload(request: FastifyRequest): Promise<UploadedFile> {
  const ct = request.headers['content-type'] ?? '';

  if (ct.includes('multipart/form-data')) {
    // Iterate all parts so we capture fields regardless of their order in the stream.
    let fileData: Buffer | null = null;
    let contentType = 'application/octet-stream';
    let cacheControl = 'no-cache';
    let userMetadata: Record<string, unknown> | null = null;

    for await (const part of request.parts()) {
      if (part.type === 'file') {
        const chunks: Buffer[] = [];
        for await (const chunk of part.file) chunks.push(chunk as Buffer);
        fileData = Buffer.concat(chunks);
        contentType = part.mimetype;
      } else {
        const val = (part as { value: string }).value;
        if (part.fieldname === 'cacheControl') cacheControl = val;
        else if (part.fieldname === 'cache-control') cacheControl = val;
        else if (part.fieldname === 'metadata') {
          try { userMetadata = JSON.parse(val) as Record<string, unknown>; } catch { /* ignore */ }
        }
      }
    }

    if (!fileData) throw new Error('No file in multipart body');
    return { data: fileData, contentType, cacheControl, userMetadata };
  }

  // Raw binary body — already parsed by '*' content-type parser
  const body = request.body;
  const data = Buffer.isBuffer(body) ? body : Buffer.alloc(0);
  const metaHeader = request.headers['x-metadata'] as string | undefined;
  const userMetadata = metaHeader
    ? (JSON.parse(Buffer.from(metaHeader, 'base64').toString()) as Record<string, unknown>)
    : null;
  return {
    data,
    contentType: ct || 'application/octet-stream',
    cacheControl: (request.headers['cache-control'] as string | undefined) ?? 'no-cache',
    userMetadata,
  };
}

// ── Bucket shape ──────────────────────────────────────────────────────────────

function bucketRow(row: Record<string, unknown>) {
  return {
    id: row.id,
    name: row.name,
    owner: row.owner ?? '',
    public: row.public,
    type: 'STANDARD',
    file_size_limit: row.file_size_limit ?? null,
    allowed_mime_types: row.allowed_mime_types ?? null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

// ── Object metadata shape ─────────────────────────────────────────────────────

function objectMetadata(row: Record<string, unknown>) {
  const size = row.size != null ? Number(row.size) : null;
  const lastModified = row.updated_at instanceof Date
    ? row.updated_at.toISOString()
    : (row.updated_at as string | null) ?? null;
  return {
    eTag: row.etag,
    size,
    mimetype: row.content_type,
    cacheControl: row.cache_control,
    lastModified,
    contentLength: size,
    httpStatusCode: 200,
  };
}

function fileRow(row: Record<string, unknown>, nameOverride?: string) {
  return {
    name: nameOverride ?? row.name,
    id: row.id,
    updated_at: row.updated_at instanceof Date ? row.updated_at.toISOString() : (row.updated_at ?? null),
    created_at: row.created_at instanceof Date ? row.created_at.toISOString() : (row.created_at ?? null),
    last_accessed_at: row.last_accessed_at instanceof Date ? row.last_accessed_at.toISOString() : (row.last_accessed_at ?? null),
    metadata: objectMetadata(row),
  };
}

// ── Plugin ────────────────────────────────────────────────────────────────────

const storagePlugin: FastifyPluginAsync<StoragePluginOptions> = async (fastify, opts) => {
  const { storageDir } = opts;

  // Raw binary body parser — fallback for non-JSON, non-multipart uploads.
  // multipart/form-data is excluded so @fastify/multipart keeps handling it.
  fastify.addContentTypeParser('*', (req, payload, done) => {
    if ((req.headers['content-type'] ?? '').includes('multipart/form-data')) {
      done(null, undefined);
      return;
    }
    const chunks: Buffer[] = [];
    payload.on('data', (chunk: Buffer) => chunks.push(chunk));
    payload.on('end', () => done(null, Buffer.concat(chunks)));
    payload.on('error', (err) => done(err as Error, undefined));
  });

  const pre = [resolveLocalProject, authenticateProject] as Parameters<typeof fastify.post>[1]['preHandler'];
  const preOptional = [resolveLocalProject, authenticateProjectOptional] as Parameters<typeof fastify.get>[1]['preHandler'];

  // ── Buckets ────────────────────────────────────────────────────────────────

  // GET /storage/v1/bucket
  fastify.get('/bucket', { preHandler: pre }, async (request, reply) => {
    const db = request.projectDb!;
    const { rows } = await db.query<Record<string, unknown>>('SELECT * FROM storage.buckets ORDER BY created_at');
    return reply.send(rows.map(bucketRow));
  });

  // POST /storage/v1/bucket
  fastify.post('/bucket', { preHandler: pre }, async (request, reply) => {
    const db = request.projectDb!;
    const body = request.body as {
      id: string;
      name: string;
      public?: boolean;
      file_size_limit?: number | null;
      allowed_mime_types?: string[] | null;
    };
    if (!body.id || !body.name) return storageError(reply, 400, 'invalid_input', 'id and name are required');

    try {
      await ensureBucketDir(storageDir, body.id);
      const { rows } = await db.query<Record<string, unknown>>(
        `INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
         VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        [body.id, body.name, body.public ?? false, body.file_size_limit ?? null, body.allowed_mime_types ?? null],
      );
      return reply.status(200).send({ name: rows[0].name });
    } catch (err: unknown) {
      const msg = (err as Error).message ?? '';
      if (msg.includes('unique') || msg.includes('duplicate')) {
        return storageError(reply, 409, 'duplicate_key', `Bucket "${body.name}" already exists`);
      }
      throw err;
    }
  });

  // GET /storage/v1/bucket/:id
  fastify.get('/bucket/:id', { preHandler: pre }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const db = request.projectDb!;
    const { rows } = await db.query<Record<string, unknown>>('SELECT * FROM storage.buckets WHERE id = $1', [id]);
    if (!rows.length) return storageError(reply, 404, 'not_found', 'Bucket not found');
    return reply.send(bucketRow(rows[0]));
  });

  // PUT /storage/v1/bucket/:id
  fastify.put('/bucket/:id', { preHandler: pre }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const db = request.projectDb!;
    const body = request.body as {
      public?: boolean;
      file_size_limit?: number | null;
      allowed_mime_types?: string[] | null;
    };
    const { rows } = await db.query<Record<string, unknown>>(
      `UPDATE storage.buckets
       SET public = COALESCE($2, public),
           file_size_limit = $3,
           allowed_mime_types = $4,
           updated_at = now()
       WHERE id = $1 RETURNING *`,
      [id, body.public ?? null, body.file_size_limit ?? null, body.allowed_mime_types ?? null],
    );
    if (!rows.length) return storageError(reply, 404, 'not_found', 'Bucket not found');
    return reply.send({ message: 'Successfully updated' });
  });

  // DELETE /storage/v1/bucket/:id
  fastify.delete('/bucket/:id', { preHandler: pre }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const db = request.projectDb!;
    const { rows: objs } = await db.query('SELECT 1 FROM storage.objects WHERE bucket_id = $1 LIMIT 1', [id]);
    if (objs.length) return storageError(reply, 409, 'bucket_not_empty', 'Bucket must be emptied before deletion');
    const { rows } = await db.query('DELETE FROM storage.buckets WHERE id = $1 RETURNING id', [id]);
    if (!rows.length) return storageError(reply, 404, 'not_found', 'Bucket not found');
    await deleteBucketDir(storageDir, id);
    return reply.send({ message: 'Successfully deleted' });
  });

  // POST /storage/v1/bucket/:id/empty
  fastify.post('/bucket/:id/empty', { preHandler: pre }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const db = request.projectDb!;
    const { rows: bucket } = await db.query('SELECT id FROM storage.buckets WHERE id = $1', [id]);
    if (!bucket.length) return storageError(reply, 404, 'not_found', 'Bucket not found');
    const { rows: objects } = await db.query<{ name: string }>(
      'DELETE FROM storage.objects WHERE bucket_id = $1 RETURNING name',
      [id],
    );
    await deleteObjects(storageDir, id, objects.map((o) => o.name));
    return reply.send({ message: 'Successfully emptied' });
  });

  // ── Object upload ──────────────────────────────────────────────────────────

  async function handleUpload(
    request: FastifyRequest,
    reply: FastifyReply,
    bucketId: string,
    objectName: string,
    upsert: boolean,
  ) {
    const db = request.projectDb!;
    const { rows: bucket } = await db.query<{ public: boolean; file_size_limit: number | null; allowed_mime_types: string[] | null }>(
      'SELECT public, file_size_limit, allowed_mime_types FROM storage.buckets WHERE id = $1',
      [bucketId],
    );
    if (!bucket.length) return storageError(reply, 404, 'not_found', 'Bucket not found');

    const uploaded = await readUpload(request);

    const sizeLimit = bucket[0].file_size_limit ?? fastify.config.storage.maxFileSizeBytes;
    if (uploaded.data.length > sizeLimit) {
      return storageError(reply, 413, 'entity_too_large', `File exceeds the ${sizeLimit}-byte limit`);
    }

    const allowedTypes = bucket[0].allowed_mime_types;
    if (allowedTypes?.length && !allowedTypes.some((t) => matchMime(t, uploaded.contentType))) {
      return storageError(reply, 415, 'invalid_mime_type', `MIME type "${uploaded.contentType}" is not allowed`);
    }

    const { etag, size } = await writeObject(storageDir, bucketId, objectName, uploaded.data);
    const newVersion = crypto.randomUUID();

    if (upsert) {
      await db.query(
        `INSERT INTO storage.objects (bucket_id, name, owner, owner_id, version, size, content_type, cache_control, etag, user_metadata, updated_at, last_accessed_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, now(), now())
         ON CONFLICT (bucket_id, name) DO UPDATE
           SET owner = EXCLUDED.owner, owner_id = EXCLUDED.owner_id, version = EXCLUDED.version,
               size = EXCLUDED.size, content_type = EXCLUDED.content_type,
               cache_control = EXCLUDED.cache_control, etag = EXCLUDED.etag,
               user_metadata = EXCLUDED.user_metadata, updated_at = now(), last_accessed_at = now()`,
        [bucketId, objectName, request.userId ?? null, request.userId ?? null, newVersion,
          size, uploaded.contentType, uploaded.cacheControl, etag, uploaded.userMetadata ? JSON.stringify(uploaded.userMetadata) : null],
      );
    } else {
      try {
        await db.query(
          `INSERT INTO storage.objects (bucket_id, name, owner, owner_id, version, size, content_type, cache_control, etag, user_metadata)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [bucketId, objectName, request.userId ?? null, request.userId ?? null, newVersion,
            size, uploaded.contentType, uploaded.cacheControl, etag, uploaded.userMetadata ? JSON.stringify(uploaded.userMetadata) : null],
        );
      } catch (err: unknown) {
        const msg = (err as Error).message ?? '';
        if (msg.includes('unique') || msg.includes('duplicate')) {
          return storageError(reply, 409, 'duplicate_key', 'Object already exists. Use x-upsert: true to overwrite');
        }
        throw err;
      }
    }

    return reply.status(200).send({ Id: objectName, Key: `${bucketId}/${objectName}` });
  }

  // POST /storage/v1/object/:bucket/*
  fastify.post('/object/:bucket/*', { preHandler: preOptional }, async (request, reply) => {
    const { bucket } = request.params as { bucket: string };
    const objectName = (request.params as Record<string, string>)['*'];
    const upsert = request.headers['x-upsert'] === 'true';
    return handleUpload(request, reply, bucket, objectName, upsert);
  });

  // PUT /storage/v1/object/:bucket/* (always upsert)
  fastify.put('/object/:bucket/*', { preHandler: preOptional }, async (request, reply) => {
    const { bucket } = request.params as { bucket: string };
    const objectName = (request.params as Record<string, string>)['*'];
    return handleUpload(request, reply, bucket, objectName, true);
  });

  // ── Object download ────────────────────────────────────────────────────────

  async function streamObject(
    request: FastifyRequest,
    reply: FastifyReply,
    bucketId: string,
    objectName: string,
  ) {
    const db = request.projectDb!;
    const { rows } = await db.query<Record<string, unknown>>(
      'SELECT * FROM storage.objects WHERE bucket_id = $1 AND name = $2',
      [bucketId, objectName],
    );
    if (!rows.length) return storageError(reply, 404, 'not_found', 'Object not found');

    const obj = rows[0];
    const data = await readObject(storageDir, bucketId, objectName);
    if (!data) return storageError(reply, 404, 'not_found', 'Object not found');

    await db.query(
      'UPDATE storage.objects SET last_accessed_at = now() WHERE bucket_id = $1 AND name = $2',
      [bucketId, objectName],
    );

    const clientEtag = request.headers['if-none-match'];
    if (clientEtag && clientEtag === obj.etag) {
      return reply.status(304).send();
    }

    return reply
      .header('Content-Type', (obj.content_type as string) ?? 'application/octet-stream')
      .header('Content-Length', String(data.length))
      .header('Cache-Control', (obj.cache_control as string) ?? 'no-cache')
      .header('ETag', obj.etag as string)
      .header('Last-Modified', new Date(obj.updated_at as string).toUTCString())
      .send(data);
  }

  // GET /storage/v1/object/public/:bucket/*  — no auth required
  fastify.get('/object/public/:bucket/*', { preHandler: [resolveLocalProject] }, async (request, reply) => {
    const { bucket } = request.params as { bucket: string };
    const objectName = (request.params as Record<string, string>)['*'];
    const db = request.projectDb!;
    const { rows } = await db.query<{ public: boolean }>('SELECT public FROM storage.buckets WHERE id = $1', [bucket]);
    if (!rows.length || !rows[0].public) return storageError(reply, 400, 'invalid_request', 'Bucket is not public');
    return streamObject(request, reply, bucket, objectName);
  });

  // GET /storage/v1/object/info/:bucket/*
  fastify.get('/object/info/:bucket/*', { preHandler: pre }, async (request, reply) => {
    const { bucket } = request.params as { bucket: string };
    const objectName = (request.params as Record<string, string>)['*'];
    const db = request.projectDb!;
    const { rows } = await db.query<Record<string, unknown>>(
      'SELECT * FROM storage.objects WHERE bucket_id = $1 AND name = $2',
      [bucket, objectName],
    );
    if (!rows.length) return storageError(reply, 404, 'not_found', 'Object not found');
    const obj = rows[0];
    return reply.send({
      id: obj.id,
      version: obj.version,
      name: obj.name,
      bucket_id: obj.bucket_id,
      size: obj.size,
      cache_control: obj.cache_control,
      content_type: obj.content_type,
      etag: obj.etag,
      created_at: obj.created_at,
      updated_at: obj.updated_at,
      last_modified: obj.updated_at,
      last_accessed_at: obj.last_accessed_at,
      metadata: obj.user_metadata ?? {},
    });
  });

  // HEAD /storage/v1/object/:bucket/*
  fastify.head('/object/:bucket/*', { preHandler: preOptional }, async (request, reply) => {
    const { bucket } = request.params as { bucket: string };
    const objectName = (request.params as Record<string, string>)['*'];
    const db = request.projectDb!;
    const { rows } = await db.query<Record<string, unknown>>(
      'SELECT * FROM storage.objects WHERE bucket_id = $1 AND name = $2',
      [bucket, objectName],
    );
    if (!rows.length) return reply.status(404).send();
    const obj = rows[0];
    return reply
      .header('Content-Type', (obj.content_type as string) ?? 'application/octet-stream')
      .header('Content-Length', String(obj.size))
      .header('ETag', obj.etag as string)
      .header('Last-Modified', new Date(obj.updated_at as string).toUTCString())
      .status(200).send();
  });

  // GET /storage/v1/object/:bucket/*  — authenticated download
  fastify.get('/object/:bucket/*', { preHandler: preOptional }, async (request, reply) => {
    const { bucket } = request.params as { bucket: string };
    const objectName = (request.params as Record<string, string>)['*'];
    return streamObject(request, reply, bucket, objectName);
  });

  // ── Bulk delete ────────────────────────────────────────────────────────────

  // DELETE /storage/v1/object/:bucket  (body: { prefixes: string[] })
  fastify.delete('/object/:bucket', { preHandler: pre }, async (request, reply) => {
    const { bucket } = request.params as { bucket: string };
    const body = request.body as { prefixes: string[] };
    const prefixes = body?.prefixes ?? [];
    if (!prefixes.length) return reply.send([]);

    const db = request.projectDb!;
    const { rows } = await db.query<Record<string, unknown>>(
      `DELETE FROM storage.objects WHERE bucket_id = $1 AND name = ANY($2::text[]) RETURNING *`,
      [bucket, prefixes],
    );
    await deleteObjects(storageDir, bucket, rows.map((r) => r.name as string));
    return reply.send(rows.map((r) => fileRow(r)));
  });

  // ── Copy / Move ────────────────────────────────────────────────────────────

  // POST /storage/v1/object/copy
  fastify.post('/object/copy', { preHandler: pre }, async (request, reply) => {
    const body = request.body as {
      bucketId: string;
      sourceKey: string;
      destinationBucket?: string;
      destinationKey: string;
    };
    const db = request.projectDb!;
    const srcBucket = body.bucketId;
    const dstBucket = body.destinationBucket ?? body.bucketId;

    const { rows } = await db.query<Record<string, unknown>>(
      'SELECT * FROM storage.objects WHERE bucket_id = $1 AND name = $2',
      [srcBucket, body.sourceKey],
    );
    if (!rows.length) return storageError(reply, 404, 'not_found', 'Source object not found');

    const data = await readObject(storageDir, srcBucket, body.sourceKey);
    if (!data) return storageError(reply, 404, 'not_found', 'Source file not found');

    const src = rows[0];
    const { etag, size } = await writeObject(storageDir, dstBucket, body.destinationKey, data);

    await db.query(
      `INSERT INTO storage.objects (bucket_id, name, owner, owner_id, version, size, content_type, cache_control, etag, user_metadata)
       VALUES ($1, $2, $3, $4, gen_random_uuid()::text, $5, $6, $7, $8, $9)
       ON CONFLICT (bucket_id, name) DO UPDATE
         SET version = gen_random_uuid()::text, size = EXCLUDED.size,
             content_type = EXCLUDED.content_type, cache_control = EXCLUDED.cache_control,
             etag = EXCLUDED.etag, user_metadata = EXCLUDED.user_metadata, updated_at = now()`,
      [dstBucket, body.destinationKey, src.owner, src.owner_id, size,
        src.content_type, src.cache_control, etag, src.user_metadata],
    );

    return reply.send({ Key: `${dstBucket}/${body.destinationKey}` });
  });

  // POST /storage/v1/object/move
  fastify.post('/object/move', { preHandler: pre }, async (request, reply) => {
    const body = request.body as {
      bucketId: string;
      sourceKey: string;
      destinationBucket?: string;
      destinationKey: string;
    };
    const db = request.projectDb!;
    const srcBucket = body.bucketId;
    const dstBucket = body.destinationBucket ?? body.bucketId;

    const { rows } = await db.query<Record<string, unknown>>(
      'SELECT * FROM storage.objects WHERE bucket_id = $1 AND name = $2',
      [srcBucket, body.sourceKey],
    );
    if (!rows.length) return storageError(reply, 404, 'not_found', 'Source object not found');

    const data = await readObject(storageDir, srcBucket, body.sourceKey);
    if (!data) return storageError(reply, 404, 'not_found', 'Source file not found');

    const src = rows[0];
    const { etag, size } = await writeObject(storageDir, dstBucket, body.destinationKey, data);
    await deleteObjects(storageDir, srcBucket, [body.sourceKey]);

    await db.query(
      `INSERT INTO storage.objects (bucket_id, name, owner, owner_id, version, size, content_type, cache_control, etag, user_metadata)
       VALUES ($1, $2, $3, $4, gen_random_uuid()::text, $5, $6, $7, $8, $9)
       ON CONFLICT (bucket_id, name) DO UPDATE
         SET version = gen_random_uuid()::text, size = EXCLUDED.size,
             content_type = EXCLUDED.content_type, cache_control = EXCLUDED.cache_control,
             etag = EXCLUDED.etag, user_metadata = EXCLUDED.user_metadata, updated_at = now()`,
      [dstBucket, body.destinationKey, src.owner, src.owner_id, size,
        src.content_type, src.cache_control, etag, src.user_metadata],
    );
    await db.query('DELETE FROM storage.objects WHERE bucket_id = $1 AND name = $2', [srcBucket, body.sourceKey]);

    return reply.send({ message: 'Successfully moved' });
  });

  // ── List objects ───────────────────────────────────────────────────────────

  // POST /storage/v1/object/list/:bucket
  fastify.post('/object/list/:bucket', { preHandler: pre }, async (request, reply) => {
    const { bucket } = request.params as { bucket: string };
    const body = request.body as {
      prefix?: string;
      limit?: number;
      offset?: number;
      search?: string;
      sortBy?: { column: string; order: 'asc' | 'desc' };
    } | null;

    const prefix = body?.prefix ?? '';
    const limit = Math.min(body?.limit ?? 100, 1000);
    const offset = body?.offset ?? 0;
    const search = body?.search ?? '';
    const sortCol = ['name', 'created_at', 'updated_at', 'last_accessed_at'].includes(body?.sortBy?.column ?? '')
      ? body!.sortBy!.column : 'name';
    const sortOrder = body?.sortBy?.order === 'desc' ? 'DESC' : 'ASC';

    const db = request.projectDb!;
    const { rows: bucket_check } = await db.query('SELECT id FROM storage.buckets WHERE id = $1', [bucket]);
    if (!bucket_check.length) return storageError(reply, 404, 'not_found', 'Bucket not found');

    const likePattern = `${prefix}${search ? `%${search}%` : '%'}`;
    const { rows } = await db.query<Record<string, unknown>>(
      `SELECT * FROM storage.objects
       WHERE bucket_id = $1 AND name LIKE $2
       ORDER BY ${sortCol} ${sortOrder}
       LIMIT $3 OFFSET $4`,
      [bucket, likePattern, limit, offset],
    );

    // Simulate folder hierarchy: group objects by first path segment after prefix
    const seen = new Set<string>();
    const result: unknown[] = [];

    for (const row of rows) {
      const name = (row.name as string).slice(prefix.length);
      const slashIdx = name.indexOf('/');
      if (slashIdx !== -1) {
        // This object is in a sub-"folder"
        const folder = name.slice(0, slashIdx + 1);
        if (!seen.has(folder)) {
          seen.add(folder);
          result.push({ name: folder, id: null, updated_at: null, created_at: null, last_accessed_at: null, metadata: null });
        }
      } else {
        result.push(fileRow(row, name));
      }
    }

    return reply.send(result);
  });

  // POST /storage/v1/object/list-v2/:bucket
  fastify.post('/object/list-v2/:bucket', { preHandler: pre }, async (request, reply) => {
    const { bucket } = request.params as { bucket: string };
    const body = request.body as {
      prefix?: string;
      limit?: number;
      cursor?: string;
      with_delimiter?: boolean;
      sortBy?: { column: string; order: 'asc' | 'desc' };
    } | null;

    const prefix = body?.prefix ?? '';
    const limit = Math.min(body?.limit ?? 1000, 1000);
    const cursor = body?.cursor ?? null;
    const withDelimiter = body?.with_delimiter ?? true;
    const sortCol = ['name', 'created_at', 'updated_at'].includes(body?.sortBy?.column ?? '') ? body!.sortBy!.column : 'name';
    const sortOrder = body?.sortBy?.order === 'desc' ? 'DESC' : 'ASC';

    const db = request.projectDb!;
    const { rows } = await db.query<Record<string, unknown>>(
      `SELECT * FROM storage.objects
       WHERE bucket_id = $1 AND name LIKE $2 ${cursor ? 'AND name > $4' : ''}
       ORDER BY ${sortCol} ${sortOrder}
       LIMIT $3`,
      cursor
        ? [bucket, `${prefix}%`, limit + 1, cursor]
        : [bucket, `${prefix}%`, limit + 1],
    );

    const hasNext = rows.length > limit;
    const items = hasNext ? rows.slice(0, limit) : rows;

    if (!withDelimiter) {
      return reply.send({
        hasNext,
        nextCursor: hasNext ? (items[items.length - 1].name as string) : null,
        objects: items.map((r) => fileRow(r, (r.name as string).slice(prefix.length))),
        folders: [],
      });
    }

    const seen = new Set<string>();
    const objects: unknown[] = [];
    const folders: unknown[] = [];

    for (const row of items) {
      const name = (row.name as string).slice(prefix.length);
      const slashIdx = name.indexOf('/');
      if (slashIdx !== -1) {
        const folderKey = prefix + name.slice(0, slashIdx + 1);
        if (!seen.has(folderKey)) {
          seen.add(folderKey);
          folders.push({ key: folderKey, name: name.slice(0, slashIdx + 1), updated_at: null, created_at: null });
        }
      } else {
        objects.push(fileRow(row, name));
      }
    }

    return reply.send({
      hasNext,
      nextCursor: hasNext ? (items[items.length - 1].name as string) : null,
      objects,
      folders,
    });
  });

  // ── Signed URLs ────────────────────────────────────────────────────────────

  const jwtSecret = () => fastify.config.project.jwtSecret;
  const baseUrl = () => `http://localhost:${fastify.config.server.port}`;

  // POST /storage/v1/object/sign/:bucket/*  — create single signed download URL
  fastify.post('/object/sign/:bucket/*', { preHandler: pre }, async (request, reply) => {
    const { bucket } = request.params as { bucket: string };
    const objectName = (request.params as Record<string, string>)['*'];
    const body = request.body as { expiresIn: number } | null;
    const expiresIn = body?.expiresIn ?? 3600;

    const db = request.projectDb!;
    const { rows } = await db.query('SELECT id FROM storage.objects WHERE bucket_id = $1 AND name = $2', [bucket, objectName]);
    if (!rows.length) return storageError(reply, 404, 'not_found', 'Object not found');

    const token = createToken(bucket, objectName, 'download', expiresIn, jwtSecret());
    const signedURL = `${baseUrl()}/storage/v1/object/sign/${bucket}/${objectName}?token=${token}`;
    return reply.send({ signedURL });
  });

  // POST /storage/v1/object/sign/:bucket  — create multiple signed download URLs
  fastify.post('/object/sign/:bucket', { preHandler: pre }, async (request, reply) => {
    const { bucket } = request.params as { bucket: string };
    const body = request.body as { paths: string[]; expiresIn: number };
    const expiresIn = body?.expiresIn ?? 3600;
    const paths = body?.paths ?? [];

    const result = paths.map((p) => {
      const token = createToken(bucket, p, 'download', expiresIn, jwtSecret());
      return {
        signedURL: `${baseUrl()}/storage/v1/object/sign/${bucket}/${p}?token=${token}`,
        error: null,
      };
    });
    return reply.send(result);
  });

  // GET /storage/v1/object/sign/:bucket/*?token=...  — use signed URL
  fastify.get('/object/sign/:bucket/*', { preHandler: [resolveLocalProject] }, async (request, reply) => {
    const { bucket } = request.params as { bucket: string };
    const objectName = (request.params as Record<string, string>)['*'];
    const { token } = request.query as { token?: string };
    if (!token) return storageError(reply, 400, 'invalid_request', 'Missing token');

    const verified = verifyToken(token, jwtSecret());
    if (!verified || verified.type !== 'download' || verified.bucket !== bucket || verified.object !== objectName) {
      return storageError(reply, 400, 'invalid_token', 'Invalid or expired token');
    }

    return streamObject(request, reply, bucket, objectName);
  });

  // POST /storage/v1/object/upload/sign/:bucket/*  — create signed upload URL
  fastify.post('/object/upload/sign/:bucket/*', { preHandler: pre }, async (request, reply) => {
    const { bucket } = request.params as { bucket: string };
    const objectName = (request.params as Record<string, string>)['*'];

    const { rows } = await request.projectDb!.query('SELECT id FROM storage.buckets WHERE id = $1', [bucket]);
    if (!rows.length) return storageError(reply, 404, 'not_found', 'Bucket not found');

    const token = createToken(bucket, objectName, 'upload', 3600, jwtSecret());
    const url = `${baseUrl()}/storage/v1/object/upload/sign/${bucket}/${objectName}?token=${token}`;
    return reply.send({ url });
  });

  // PUT /storage/v1/object/upload/sign/:bucket/*?token=...  — upload via signed URL
  fastify.put('/object/upload/sign/:bucket/*', { preHandler: [resolveLocalProject] }, async (request, reply) => {
    const { bucket } = request.params as { bucket: string };
    const objectName = (request.params as Record<string, string>)['*'];
    const { token } = request.query as { token?: string };
    if (!token) return storageError(reply, 400, 'invalid_request', 'Missing token');

    const verified = verifyToken(token, jwtSecret());
    if (!verified || verified.type !== 'upload' || verified.bucket !== bucket || verified.object !== objectName) {
      return storageError(reply, 400, 'invalid_token', 'Invalid or expired token');
    }

    const upsert = request.headers['x-upsert'] === 'true';
    return handleUpload(request, reply, bucket, objectName, upsert);
  });
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function matchMime(pattern: string, actual: string): boolean {
  if (pattern === actual) return true;
  if (pattern.endsWith('/*')) return actual.startsWith(pattern.slice(0, -1));
  return false;
}

export default storagePlugin;
