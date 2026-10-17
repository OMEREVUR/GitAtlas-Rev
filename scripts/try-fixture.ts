// Uçtan uca deneme: loadSnapshot + computeFileStats'ı bir repoda çalıştırır, 7d/30d/all özetini ve cache süresini basar.
// Kullanım: npm run try-fixture -- <repo-yolu> [--fresh]
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_IGNORE } from '../src/config';
import { computeFileStats } from '../src/model/aggregate';
import { loadSnapshot } from '../src/model/repoService';
import type { TimeRange } from '../src/types';

async function main(): Promise<void> {
  const root = process.argv[2];
  if (!root) throw new Error('Repo yolu ver: npm run try-fixture -- <repo-yolu>');
  const storageDir = mkdtempSync(join(tmpdir(), 'gitatlas-revrev-try-'));
  try {
    const t0 = performance.now();
    const snap = await loadSnapshot(root, storageDir, () => undefined);
    const t1 = performance.now();
    const snap2 = await loadSnapshot(root, storageDir, () => undefined);
    const t2 = performance.now();
    console.log(`repo: ${snap.root}`);
    console.log(`HEAD: ${snap.headHash.slice(0, 10)} · commit: ${snap.commits.length} · izlenen metin dosyası: ${Object.keys(snap.lineCounts).length}`);
    console.log(`1. çalıştırma (cache yok): ${(t1 - t0).toFixed(0)} ms`);
    console.log(`2. çalıştırma (cache):     ${(t2 - t1).toFixed(0)} ms · aynı HEAD: ${snap2.headHash === snap.headHash} · aynı commit sayısı: ${snap2.commits.length === snap.commits.length}`);
    const now = Date.now();
    for (const range of ['7d', '30d', 'all'] as TimeRange[]) {
      const cutoff = range === 'all' ? 0 : now - (range === '7d' ? 7 : 30) * 864e5;
      const inRange = snap.commits.filter((c) => c.date >= cutoff).length;
      const files = computeFileStats(snap, range, [...DEFAULT_IGNORE], now);
      const changed = files.filter((f) => f.changes > 0).sort((a, b) => b.changes - a.changes);
      console.log(`\n[${range}] aralıktaki commit: ${inRange} · dosya: ${files.length} · değişen dosya: ${changed.length}`);
      for (const f of changed.slice(0, 5)) console.log(`   ${String(f.changes).padStart(3)} commit  ${String(f.lines).padStart(5)} satır  ${f.path}  (${f.authors.join(', ')})`);
    }
    const all = computeFileStats(snap, 'all', [...DEFAULT_IGNORE], now);
    const renamed = snap.commits.flatMap((c) => c.files.filter((f) => f.oldPath).map((f) => ({ from: f.oldPath ?? '', to: f.path })));
    for (const r of renamed) {
      const recs = all.filter((f) => f.path === r.from || f.path === r.to);
      console.log(`\nyeniden adlandırma ${r.from} → ${r.to}: haritada ${recs.length} kayıt ${recs.map((f) => `${f.path} (${f.changes} commit)`).join(', ')}`);
    }
    const binaries = new Set(snap.commits.flatMap((c) => c.files.filter((f) => f.added === 0 && f.deleted === 0 && !f.oldPath).map((f) => f.path)));
    for (const b of binaries) console.log(`0/0 değişiklikli (binary olabilir) ${b}: lineCounts=${snap.lineCounts[b] ?? 'yok'} · haritada ${all.some((f) => f.path === b) ? 'VAR' : 'yok'}`);
    const ignored = Object.keys(snap.lineCounts).filter((p) => !all.some((f) => f.path === p));
    console.log(`\nignore ile düşülen: ${ignored.join(', ') || '(yok)'}`);
  } finally {
    rmSync(storageDir, { recursive: true, force: true });
  }
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
