import { describe, expect, it, vi } from 'vitest';

vi.mock('vscode', () => ({
  EventEmitter: class {
    event = (): void => undefined;
    fire(): void {}
    dispose(): void {}
  },
  workspace: { getConfiguration: () => ({ get: () => undefined }) },
}));

import { pickGitPath, sanitizeBadgeMode, sanitizeGraphPageSize, sanitizeRange } from '../src/config';
import { isGitHubUrl, parseWebviewMessage } from '../src/panel/panelProvider';

describe('ayar doğrulayıcıları', () => {
  it('aralık, sayfa boyutu, rozet modu', () => {
    expect(sanitizeRange('7d')).toBe('7d');
    expect(sanitizeRange('1y')).toBe('30d');
    expect(sanitizeGraphPageSize(50)).toBe(100);
    expect(sanitizeGraphPageSize(99999)).toBe(5000);
    expect(sanitizeGraphPageSize(750.4)).toBe(750);
    expect(sanitizeGraphPageSize('x')).toBe(500);
    expect(sanitizeGraphPageSize(Number.NaN)).toBe(500);
    expect(sanitizeBadgeMode('all')).toBe('all');
    expect(sanitizeBadgeMode('everything')).toBe('hot');
  });
  it('git yolu: kendi ayarı > VS Code git.path (string ya da dizi) > undefined', () => {
    expect(pickGitPath(' C:/git/bin/git.exe ', '/usr/bin/git')).toBe('C:/git/bin/git.exe');
    expect(pickGitPath('', '/usr/bin/git')).toBe('/usr/bin/git');
    expect(pickGitPath('', ['', '/opt/git', '/usr/bin/git'])).toBe('/opt/git');
    expect(pickGitPath(undefined, null)).toBeUndefined();
    expect(pickGitPath('  ', [])).toBeUndefined();
  });
});

describe('v3/v4 webview mesajları', () => {
  it('GitHub ve v4 mesajlarını kabul eder', () => {
    expect(parseWebviewMessage({ type: 'githubConnect' })).toEqual({ type: 'githubConnect' });
    expect(parseWebviewMessage({ type: 'githubDismiss' })).toEqual({ type: 'githubDismiss' });
    expect(parseWebviewMessage({ type: 'githubRefresh' })).toEqual({ type: 'githubRefresh' });
    expect(parseWebviewMessage({ type: 'loadTimeline' })).toEqual({ type: 'loadTimeline' });
    expect(parseWebviewMessage({ type: 'loadContrib', range: 'all' })).toEqual({ type: 'loadContrib', range: 'all' });
    expect(parseWebviewMessage({ type: 'loadContrib', range: '1y' })).toBeUndefined();
  });
  it('openUrl yalnızca https://github.com/…', () => {
    const ok = 'https://github.com/owner/repo/pull/41';
    expect(parseWebviewMessage({ type: 'openUrl', url: ok })).toEqual({ type: 'openUrl', url: ok });
    for (const bad of [
      'http://github.com/owner/repo',
      'javascript:alert(1)',
      'https://github.com.evil.com/x',
      'https://evil.com/https://github.com/',
      'https://gist.github.com/x',
      'https://user:pw@github.com/x',
      'https://github.com:8443/x',
      'file:///etc/passwd',
      42,
    ]) {
      expect(isGitHubUrl(bad)).toBe(false);
      expect(parseWebviewMessage({ type: 'openUrl', url: bad })).toBeUndefined();
    }
  });
});
