import { afterEach, describe, expect, it } from 'vitest';
import { setLang } from '../src/i18n';
import { text } from '../src/i18n/map';
import { computeFileStats } from '../src/model/aggregate';
import { NoCommitsError } from '../src/model/repoService';
import { buildTimeline } from '../src/model/timeline';
import type { CommitSummary, RepoSnapshot } from '../src/types';
import { heatLabel } from '../src/webview/heat';

const T0 = Date.UTC(2026, 0, 1, 12);
const commit: CommitSummary = {
  hash: 'a'.repeat(40),
  shortHash: 'aaaaaaa',
  parents: [],
  author: 'Ayse',
  email: 'ayse@example.com',
  date: T0,
  message: 'ilk',
  files: [{ path: 'README.md', added: 1, deleted: 0 }],
};
const snapshot: RepoSnapshot = { root: '/r', headHash: commit.hash, generatedAt: T0, commits: [commit], lineCounts: { 'README.md': 1 } };

describe('i18n — harita alanı', () => {
  afterEach(() => setLang('tr'));

  it('varsayılan Türkçe metinler aynen korunur', () => {
    const t = text();
    expect(t.lines(1234)).toBe('1.234 satır');
    expect(t.fileCountMeta(3)).toBe('3 dosya · kutu boyutu = satır sayısı');
    expect(t.openPrs(2)).toBe('2 açık PR');
    expect(t.recentCommits).toBe("SON COMMIT'LER");
    expect(t.dirty('untracked')).toBe('Yeni (izlenmiyor)');
    expect(t.pct(80)).toBe('%80');
    expect(heatLabel(0)).toBe('Değişmedi');
    expect(heatLabel(5)).toBe('Çok sık');
    expect(buildTimeline(snapshot, computeFileStats(snapshot, 'all', [], T0)).marks[0]?.label).toBe('İlk commit: ilk');
    expect(new NoCommitsError().message).toBe('Bu repoda henüz commit yok.');
  });

  it('İngilizce: tekil/çoğul, sayı biçimi, yüzde', () => {
    setLang('en');
    const t = text();
    expect(t.lines(1)).toBe('1 line');
    expect(t.lines(1234)).toBe('1,234 lines');
    expect(t.commits(1)).toBe('1 commit');
    expect(t.files(2)).toBe('2 files');
    expect(t.openPrs(1)).toBe('1 open PR');
    expect(t.openPrs(3)).toBe('3 open PRs');
    expect(t.outsideFiles(1)).toBe(' 1 file of this commit is outside this folder');
    expect(t.outsideFiles(4)).toBe(' 4 files of this commit are outside this folder');
    expect(t.folderLabel('src', 1, 2000)).toBe('src/ folder, 1 file, 2,000 lines');
    expect(t.everyoneMeta(1, 3)).toBe('1 commit · 3 authors');
    expect(t.cellLabel('Mon', 'Oct 5', 2)).toBe('Mon Oct 5: 2 commits');
    expect(t.segTitle('ayse', 1, 40)).toBe('ayse: 1 line (40%)');
    expect(t.pct(80)).toBe('80%');
    expect(t.rangeTitle('30d')).toBe('Last 30 days');
    expect(t.day(6)).toBe('Sun');
    expect(t.weeklyRhythm(t.everyone)).toBe('WEEKLY RHYTHM · Everyone');
  });

  it('İngilizce: ısı, değişiklik türü, dönüm noktası ve model hatası', () => {
    setLang('en');
    expect([0, 1, 2, 3, 4, 5].map(heatLabel)).toEqual(['Unchanged', 'Very rare', 'Rare', 'Moderate', 'Frequent', 'Very frequent']);
    expect(text().dirty('conflicted')).toBe('Conflict');
    expect(buildTimeline(snapshot, computeFileStats(snapshot, 'all', [], T0)).marks[0]?.label).toBe('First commit: ilk');
    expect(new NoCommitsError().message).toBe('This repository has no commits yet.');
  });

  it('sözlükte Türkçe karakter yalnızca tr tarafında', () => {
    setLang('en');
    const t = text();
    const values: string[] = [];
    for (const v of Object.values(t)) {
      if (typeof v === 'string') values.push(v);
    }
    for (const v of values) expect(v).not.toMatch(/[çğıöşüÇĞİÖŞÜ]/);
  });
});
