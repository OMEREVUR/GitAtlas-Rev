import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FileStat, GitHubData, GitRef, PullRequest } from '../src/types';

vi.mock('vscode', () => ({
  EventEmitter: class {
    event = (): void => undefined;
    fire(): void {}
    dispose(): void {}
  },
  workspace: { getConfiguration: () => ({ get: () => undefined }) },
}));

import { setLang } from '../src/i18n';
import { panelText } from '../src/i18n/panel';
import { computeBadges, heatBadge } from '../src/decorations/heatDecorations';
import {
  aheadBehindSentence,
  branchDescription,
  branchTooltipLines,
  githubTooltipLines,
  matchGitHub,
  validateBranchNameInput,
} from '../src/panel/branchTree';
import { mapError } from '../src/panel/panelProvider';
import { githubStatusText } from '../src/panel/statusBar';

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 9, 17);

const ref = (name: string, over: Partial<GitRef> = {}): GitRef => ({
  name, fullName: `refs/heads/${name}`, kind: 'local', hash: 'abc', isHead: false, date: NOW - DAY, subject: 's', author: 'a', ...over,
});
const pr = (number: number, headRef: string, over: Partial<PullRequest> = {}): PullRequest => ({
  number, title: `PR ${number}`, url: '', author: 'a', headRef, baseRef: 'main', isDraft: false, updatedAt: 0, files: [], ci: 'success', ...over,
});
const file = (path: string, changes: number): FileStat => ({ path, lines: 1, changes, added: 0, deleted: 0, lastModified: 0, authors: [] });

afterEach(() => setLang('tr'));

describe('panel metinleri: İngilizce', () => {
  it('her iki dilde aynı anahtarlar', () => {
    setLang('tr');
    const tr = Object.keys(panelText()).sort();
    setLang('en');
    expect(Object.keys(panelText()).sort()).toEqual(tr);
  });

  it('Branch ağacı', () => {
    setLang('en');
    expect(branchDescription(ref('old', { date: NOW - 40 * DAY }), NOW)).toBe('stale · 5 weeks ago');
    expect(aheadBehindSentence(ref('f', { compareTo: 'origin/main', ahead: 1, behind: 3 }))).toBe('Compared to origin/main · 1 ahead, 3 behind');
    expect(branchTooltipLines(ref('x', { upstream: 'origin/x', date: NOW - 40 * DAY }), NOW)).toContain('Tracking: origin/x');
    expect(branchTooltipLines(ref('x', { date: NOW - 40 * DAY }), NOW)).toContain('Stale: untouched for more than 30 days');
    const gh = matchGitHub(ref('f'), [pr(7, 'f', { isDraft: true, ci: 'failure' })], []);
    expect(githubTooltipLines(gh)).toEqual(['PR #7 (draft): PR 7 → main · CI failed']);
    expect(validateBranchNameInput('', new Set())).toBe('Enter a branch name.');
    expect(validateBranchNameInput('main', new Set(['main']))).toBe('A branch named "main" already exists.');
    expect(validateBranchNameInput('a b', new Set())).toContain('Invalid branch name');
  });

  it('Explorer rozetleri: tekil/çoğul, rozet metni aynı', () => {
    setLang('en');
    expect(heatBadge(2, 1)).toEqual({ badge: '●●', tooltip: 'GitAtlas-RevRev: changes very often · 1 commit' });
    expect(heatBadge(1, 4).tooltip).toBe('GitAtlas-RevRev: changes often · 4 commits');
    const b = computeBadges([file('a', 3), file('b', 1)], 'all', new Map([['a', 2]]));
    expect(b.get('a')).toMatchObject({ kind: 'pr', badge: '2', tooltip: 'GitAtlas-RevRev: 2 open PRs touch this file (conflict risk)' });
    expect(b.get('b')?.tooltip).toMatch(/^GitAtlas-RevRev: heat \d\/5 · 1 commit$/);
  });

  it('durum çubuğu', () => {
    setLang('en');
    const t = panelText();
    expect(t.scanning(42)).toBe('GitAtlas-RevRev: scanning 42%');
    expect(t.ready(true)).toBe('GitAtlas-RevRev: scan complete · cache up to date');
    expect(t.readyTooltip(1)).toBe('GitAtlas-RevRev: 1 file · click to open the map');
    const data: GitHubData = {
      branchCi: [],
      pullRequests: [pr(1, 'x')],
      status: { state: 'connected', repo: 'o/r', fetchedAt: NOW - 60_000, intervalMin: 4, baseIntervalMin: 2 },
    };
    const gh = githubStatusText(data, NOW);
    expect(gh?.suffix).toBe('GitHub: 1 PR');
    expect(gh?.detail).toBe('GitHub: o/r · 1 open PR · updated 1 min ago · rate limit low, refreshing every 4 min');
    const stale = githubStatusText({ ...data, status: { state: 'stale', repo: 'o/r', fetchedAt: NOW - 3 * 3600_000, reason: 'offline' } }, NOW);
    expect(stale).toEqual({ suffix: 'GitHub: stale data', detail: "Can't reach GitHub. Showing PR and CI data for o/r as fetched 3 hours ago." });
  });

  it('hata kısa metinleri', () => {
    setLang('en');
    expect(mapError(new Error('x'))).toEqual({ code: 'unknown', message: 'x', short: 'scan failed' });
  });
});

describe('panel metinleri: Türkçe varsayılan korunur', () => {
  it('mevcut Türkçe metinler', () => {
    expect(heatBadge(2, 7).tooltip).toBe('GitAtlas-RevRev: çok sık değişiyor · 7 commit');
    expect(panelText().scanning(42)).toBe('GitAtlas-RevRev: taranıyor %42');
    expect(branchDescription(ref('old', { date: NOW - 40 * DAY }), NOW)).toBe('bayat · 5 hafta önce');
  });
});
