import { createHash, randomBytes } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { RepoSnapshot } from '../types';

const CACHE_VERSION = 1;

function cacheFile(storageDir: string, root: string): string {
  const id = createHash('sha1').update(root).digest('hex').slice(0, 16);
  return join(storageDir, `${id}.json`);
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isSnapshot(v: unknown): v is RepoSnapshot {
  return (
    isRecord(v) &&
    typeof v.root === 'string' &&
    typeof v.headHash === 'string' &&
    typeof v.generatedAt === 'number' &&
    Array.isArray(v.commits) &&
    isRecord(v.lineCounts)
  );
}

export async function readSnapshot(storageDir: string, root: string): Promise<RepoSnapshot | undefined> {
  try {
    const raw = await readFile(cacheFile(storageDir, root), 'utf8');
    const data: unknown = JSON.parse(raw);
    if (!isRecord(data) || data.version !== CACHE_VERSION) return undefined;
    const snapshot = data.snapshot;
    if (!isSnapshot(snapshot) || snapshot.root !== root) return undefined;
    return snapshot;
  } catch {
    return undefined;
  }
}

export async function writeSnapshot(storageDir: string, snapshot: RepoSnapshot): Promise<void> {
  await mkdir(storageDir, { recursive: true });
  const file = cacheFile(storageDir, snapshot.root);
  const tmp = `${file}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
  try {
    await writeFile(tmp, JSON.stringify({ version: CACHE_VERSION, snapshot }), 'utf8');
    await rename(tmp, file);
  } catch (err) {
    await rm(tmp, { force: true });
    throw err;
  }
}
