import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readSnapshot, writeSnapshot } from '../src/model/cache';
import type { RepoSnapshot } from '../src/types';

const ROOT = join(tmpdir(), 'some-repo');

const snapshot: RepoSnapshot = {
  root: ROOT,
  headHash: 'a'.repeat(40),
  generatedAt: 1_700_000_000_000,
  commits: [
    {
      hash: 'a'.repeat(40),
      shortHash: 'aaaaaaa',
      parents: [],
      author: 'Ayse',
      email: 'ayse@example.com',
      date: 1_700_000_000_000,
      message: 'ilk',
      files: [{ path: 'src/b.ts', oldPath: 'src/a.ts', added: 1, deleted: 0 }],
    },
  ],
  lineCounts: { 'src/b.ts': 1 },
};

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'rewiewrev-cache-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function onlyCacheFile(storage: string): Promise<string> {
  const files = await readdir(storage);
  expect(files).toHaveLength(1);
  expect(files[0]).toMatch(/^[0-9a-f]{16}\.json$/);
  return join(storage, files[0]!);
}

describe('cache', () => {
  it('gidiş-dönüş; olmayan klasörü oluşturur, tmp dosyası bırakmaz', async () => {
    const storage = join(dir, 'nested', 'storage');
    await writeSnapshot(storage, snapshot);
    await onlyCacheFile(storage);
    expect(await readSnapshot(storage, ROOT)).toEqual(snapshot);
  });

  it('üzerine yazar', async () => {
    await writeSnapshot(dir, snapshot);
    const next = { ...snapshot, headHash: 'b'.repeat(40) };
    await writeSnapshot(dir, next);
    await onlyCacheFile(dir);
    expect((await readSnapshot(dir, ROOT))?.headHash).toBe(next.headHash);
  });

  it('eksik dosya → undefined', async () => {
    expect(await readSnapshot(dir, ROOT)).toBeUndefined();
    expect(await readSnapshot(join(dir, 'yok'), ROOT)).toBeUndefined();
  });

  it('bozuk JSON → undefined', async () => {
    await writeSnapshot(dir, snapshot);
    await writeFile(await onlyCacheFile(dir), '{ bozuk', 'utf8');
    expect(await readSnapshot(dir, ROOT)).toBeUndefined();
  });

  it('farklı sürüm veya eksik alan → undefined', async () => {
    await writeSnapshot(dir, snapshot);
    const file = await onlyCacheFile(dir);
    // Sürüm 1 (mailmap öncesi yazar adları) ve gelecekteki sürümler okunmaz → tam tarama.
    for (const version of [1, 3]) {
      await writeFile(file, JSON.stringify({ version, snapshot }), 'utf8');
      expect(await readSnapshot(dir, ROOT)).toBeUndefined();
    }
    await writeFile(file, JSON.stringify({ version: 2, snapshot: { ...snapshot, commits: null } }), 'utf8');
    expect(await readSnapshot(dir, ROOT)).toBeUndefined();
  });

  it('yazılan dosya sürüm 2 taşır', async () => {
    await writeSnapshot(dir, snapshot);
    const data: unknown = JSON.parse(await readFile(await onlyCacheFile(dir), 'utf8'));
    expect(data).toMatchObject({ version: 2 });
  });

  it('dosyadaki root farklıysa → undefined', async () => {
    await writeSnapshot(dir, snapshot);
    const file = await onlyCacheFile(dir);
    await writeFile(file, JSON.stringify({ version: 2, snapshot: { ...snapshot, root: '/baska' } }), 'utf8');
    expect(await readSnapshot(dir, ROOT)).toBeUndefined();
  });

  it('farklı root başka bir dosyaya gider', async () => {
    await writeSnapshot(dir, snapshot);
    expect(await readSnapshot(dir, join(tmpdir(), 'other-repo'))).toBeUndefined();
  });
});
