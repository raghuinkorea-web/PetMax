/**
 * Private receipt/attachment storage.
 *
 * Nothing written here is reachable over a public URL. Files are stored
 * under an opaque, content-addressed key and can only be read back
 * through GET /api/files/:id, which re-checks the caller's right to the
 * record that owns the file.
 */
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, writeFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config.js';
import { one } from '../lib/db.js';
import { badRequest, tooLarge } from '../lib/errors.js';
import type { Sql } from '../lib/db.js';
import { pool } from '../lib/db.js';

const root = path.resolve(process.cwd(), config.storage.localPath);

/** Magic-byte check: never trust a client-supplied Content-Type alone. */
const SIGNATURES: Array<{ mime: string; test: (b: Buffer) => boolean }> = [
  { mime: 'image/jpeg',  test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { mime: 'image/png',   test: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { mime: 'image/webp',  test: (b) => b.subarray(0, 4).toString('ascii') === 'RIFF' && b.subarray(8, 12).toString('ascii') === 'WEBP' },
  { mime: 'image/heic',  test: (b) => b.subarray(4, 8).toString('ascii') === 'ftyp' },
  { mime: 'application/pdf', test: (b) => b.subarray(0, 5).toString('ascii') === '%PDF-' },
];

export function detectMime(buffer: Buffer): string | null {
  return SIGNATURES.find((s) => s.test(buffer))?.mime ?? null;
}

export interface StoredFile {
  id: string; storageKey: string; mimeType: string; sizeBytes: number; checksum: string;
}

export interface UploadInput {
  buffer: Buffer;
  originalName: string;
  declaredMime: string;
  uploadedBy: string;
  purpose: 'receipt' | 'work_proof' | 'avatar' | 'assignment_attachment';
}

export async function storeFile(input: UploadInput, client: Sql = pool): Promise<StoredFile> {
  if (input.buffer.length === 0) throw badRequest('The uploaded file is empty.');
  if (input.buffer.length > config.storage.maxUploadBytes) {
    throw tooLarge(`Files must be ${Math.round(config.storage.maxUploadBytes / 1024 / 1024)} MB or smaller.`);
  }

  const actualMime = detectMime(input.buffer);
  if (!actualMime) {
    throw badRequest('Unsupported file. Upload a JPG, PNG, WEBP, HEIC image or a PDF.');
  }
  if (!config.storage.allowedMime.includes(actualMime)) {
    throw badRequest(`${actualMime} files are not permitted. Allowed: ${config.storage.allowedMime.join(', ')}.`);
  }

  const checksum = createHash('sha256').update(input.buffer).digest('hex');
  const ext = actualMime === 'application/pdf' ? 'pdf' : actualMime.split('/')[1];
  // Sharded by checksum prefix so a directory never holds millions of entries.
  const storageKey = `${input.purpose}/${checksum.slice(0, 2)}/${checksum.slice(2, 4)}/${randomUUID()}.${ext}`;
  const absolute = path.join(root, storageKey);

  await mkdir(path.dirname(absolute), { recursive: true });
  await writeFile(absolute, input.buffer, { mode: 0o600 });

  try {
    const row = await one<{ id: string }>(
      `INSERT INTO files (storage_key, original_name, mime_type, size_bytes, checksum_sha256, uploaded_by, purpose)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [storageKey, sanitiseName(input.originalName), actualMime, input.buffer.length,
       checksum, input.uploadedBy, input.purpose], client);
    return { id: row!.id, storageKey, mimeType: actualMime, sizeBytes: input.buffer.length, checksum };
  } catch (err) {
    await unlink(absolute).catch(() => {});
    throw err;
  }
}

export const absolutePathFor = (storageKey: string): string => {
  const resolved = path.resolve(root, storageKey);
  // Defence in depth against a crafted key escaping the storage root.
  if (!resolved.startsWith(root + path.sep)) throw badRequest('Invalid file reference.');
  return resolved;
};

export const readStreamFor = (storageKey: string) => createReadStream(absolutePathFor(storageKey));

const sanitiseName = (name: string): string =>
  name.replace(/[^\w.\- ]+/g, '_').slice(0, 180) || 'upload';
