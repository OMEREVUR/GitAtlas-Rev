import { open } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import * as path from 'node:path';
import { runGit } from './gitRunner';

const CONCURRENCY = 32;
const BINARY_SNIFF_BYTES = 8000;
const CHUNK = 64 * 1024;

/** İzlenen dosyalar, repo köküne göre "/" ayraçlı. */
export async function listTrackedFiles(root: string): Promise<string[]> {
  const out = await runGit(['-c', 'core.quotepath=off', 'ls-files', '-z'], root);
  return out.split('\0').filter((p) => p !== '');
}

/** Metin dosyalarının satır sayıları. Binary, okunamayan ve silinmiş dosyalar sonuçta yer almaz. */
export async function countLines(root: string, paths: string[]): Promise<Record<string, number>> {
  const result: Record<string, number> = {};
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < paths.length) {
      const rel = paths[next++];
      if (rel === undefined) continue;
      const n = await countFile(path.join(root, rel));
      if (n !== null) result[rel] = n;
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, paths.length) }, worker));
  return result;
}

/** '\n' sayısı (+1 son satır '\n' ile bitmiyorsa); binary ya da okunamazsa null. */
async function countFile(file: string): Promise<number | null> {
  let handle: FileHandle;
  try {
    handle = await open(file, 'r');
  } catch {
    return null;
  }
  try {
    const buf = Buffer.allocUnsafe(CHUNK);
    let total = 0;
    let newlines = 0;
    let last = -1;
    for (;;) {
      const { bytesRead } = await handle.read(buf, 0, CHUNK, null);
      if (bytesRead === 0) break;
      for (let i = 0; i < bytesRead; i++) {
        const b = buf[i];
        if (b === 0x0a) newlines++;
        else if (b === 0 && total + i < BINARY_SNIFF_BYTES) return null;
      }
      total += bytesRead;
      last = buf[bytesRead - 1] ?? -1;
    }
    if (total === 0) return 0;
    return last === 0x0a ? newlines : newlines + 1;
  } catch {
    // Klasör (submodule), izin hatası vb.
    return null;
  } finally {
    await handle.close().catch(() => undefined);
  }
}
