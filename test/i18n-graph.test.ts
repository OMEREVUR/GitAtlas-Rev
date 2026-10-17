import { afterEach, describe, expect, it } from 'vitest';
import { setLang } from '../src/i18n';
import { text } from '../src/i18n/graph';
import { CI_LABELS, ciLabel } from '../src/webview/githubBanner';

afterEach(() => setLang('tr'));

/** Sözlük değerini örnek argümanlarla metne çevirir (fonksiyonlar sayı/metin parametre alır). */
function render(v: unknown): string {
  return typeof v === 'function' ? (v as (...a: unknown[]) => string)(2, '2', 3) : String(v);
}

describe('graph sözlüğü', () => {
  it('varsayılan Türkçe; metinler aynen korunur', () => {
    const t = text();
    expect(t.loadMore).toBe("Daha eski commit'leri yükle");
    expect(t.plainList).toBe('Sade liste');
    expect(t.files(3, '3')).toBe('3 dosya');
    expect(t.filesOf('2', 10, '10')).toBe('2 / 10 dosya');
    expect(t.openPrs(1, '1')).toBe('1 açık PR');
    expect(t.shownAsOf('3 saat önce')).toBe(' PR ve CI bilgileri 3 saat önceki hâliyle gösteriliyor.');
    expect(ciLabel('failure')).toBe('CI başarısız');
  });

  it('İngilizce: tekil/çoğul ve doğal cümleler', () => {
    setLang('en');
    const t = text();
    expect(t.loadMore).toBe('Load older commits');
    expect(t.files(1, '1')).toBe('1 file');
    expect(t.files(1200, '1,200')).toBe('1,200 files');
    expect(t.filesOf('1', 1, '1')).toBe('1 / 1 file');
    expect(t.filesOf('2', 10, '10')).toBe('2 / 10 files');
    expect(t.commits(1, '1')).toBe('1 commit');
    expect(t.commits(5, '5')).toBe('5 commits');
    expect(t.moreFiles(1, '1')).toBe('+1 more file');
    expect(t.openPrs(1, '1')).toBe('1 open PR');
    expect(t.openPrs(3, '3')).toBe('3 open PRs');
    expect(t.conflictRisk(1, '1')).toBe('conflict risk in 1 file');
    expect(t.conflictRisk(2, '2')).toBe('conflict risk in 2 files');
    expect(t.mergeParentsAria(3)).toBe('merge (3 parents)');
    expect(t.refTag('v1.0')).toBe('v1.0 (tag)');
    expect(t.shownAsOf('3 hours ago')).toBe(' PR and CI info is shown as of 3 hours ago.');
    expect(t.resetAt('10:40 AM')).toBe('The limit resets at 10:40 AM.');
    expect(t.viewDiff('graph.ts')).toBe('View diff of graph.ts');
  });

  it('CI etiketleri her okumada etkin dile göre (CI_LABELS getter\'ları dahil)', () => {
    expect(CI_LABELS.success).toBe('CI geçti');
    setLang('en');
    expect(CI_LABELS.success).toBe('CI passed');
    expect(CI_LABELS.pending).toBe('CI running');
    expect(ciLabel('none')).toBe('No CI');
    setLang('tr');
    expect(CI_LABELS.none).toBe('CI yok');
  });

  it('İngilizce sözlükte Türkçe harf yok; iki dilde aynı anahtarlar', () => {
    const trKeys = Object.keys(text()).sort();
    setLang('en');
    const en = text();
    expect(Object.keys(en).sort()).toEqual(trKeys);
    for (const [key, value] of Object.entries(en)) {
      expect(render(value), key).not.toMatch(/[çğıöşüÇĞİÖŞÜ]/);
    }
  });
});
