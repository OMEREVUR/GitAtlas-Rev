import { afterEach, describe, expect, it } from 'vitest';
import { setLang } from '../src/i18n/index';
import { text } from '../src/i18n/changes';
import { changeLetter, changeText } from '../src/webview/changes';

afterEach(() => setLang('tr'));

describe('i18n: Değişiklikler sekmesi', () => {
  it('varsayılan Türkçe metinler aynen korunur', () => {
    const t = text();
    expect(t.secStaged).toBe("COMMIT'E GİRECEKLER");
    expect(t.cbCommitPush).toBe('Commit ve gönder');
    expect(t.sbFetch).toBe('Getir');
    expect(t.stTitle(2)).toBe('SAKLANANLAR (STASH) · 2');
    expect(t.showMore(500, 1811)).toBe('500 dosya daha göster (1.811 kalan)');
    expect(changeText('untracked')).toBe('İzlenmiyor');
  });

  it("İngilizcede sözlükteki terimler ve tekil/çoğul", () => {
    setLang('en');
    const t = text();
    expect(t.secStaged).toBe('STAGED CHANGES');
    expect(t.stageAllBtn).toBe('Stage all');
    expect(t.resolvedBtn).toBe('Mark resolved');
    expect(t.abortBtn).toBe('Abort');
    expect(t.cbCommitPush).toBe('Commit & push');
    expect(t.cbAmend).toBe('Amend last commit');
    expect(t.cbUndo).toBe('Undo last commit');
    expect(t.sbFetch).toBe('Fetch');
    expect(t.sbPull).toBe('Pull');
    expect(t.sbPush).toBe('Push');
    expect(t.sbPublish).toBe('Publish');
    expect(t.stTitle(3)).toBe('STASHES · 3');
    expect(t.prConnect).toBe('Connect to GitHub');
    expect(t.prMine(0)).toBe('MY PULL REQUESTS (0)');
    expect(t.fileCount(1)).toBe('1 file');
    expect(t.fileCount(1200)).toBe('1,200 files');
    expect(t.bandConflicts(1)).toContain('1 conflict.');
    expect(t.bandConflicts(2)).toContain('2 conflicts.');
    expect(t.sbAheadBehindAria(1, 3)).toBe('1 commit to push, 3 commits to pull');
    expect(t.showMore(1, 1)).toBe('Show 1 more file (1 left)');
    expect(changeText('untracked')).toBe('Untracked');
  });

  it('durum harfleri dilden bağımsız', () => {
    setLang('en');
    expect(changeLetter('modified')).toBe('M');
    expect(changeLetter('conflicted')).toBe('U');
  });
});
