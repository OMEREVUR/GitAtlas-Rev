import { afterEach, describe, expect, it } from 'vitest';
import { defineText, getLang, locale, parseLang, plural, resolveLang, setLang } from '../src/i18n';
import { mainText } from '../src/i18n/main';
import { formatNumber, formatRelative, rangeLong, rangeShort } from '../src/webview/format';

afterEach(() => setLang('tr'));

describe('i18n çekirdeği', () => {
  it('varsayılan dil tr', () => {
    expect(getLang()).toBe('tr');
    expect(locale()).toBe('tr-TR');
  });

  it('resolveLang: ayar önce, sonra VS Code dili', () => {
    expect(resolveLang('auto', 'tr')).toBe('tr');
    expect(resolveLang('auto', 'tr-TR')).toBe('tr');
    expect(resolveLang('auto', 'en-US')).toBe('en');
    expect(resolveLang('auto', 'de')).toBe('en');
    expect(resolveLang(undefined, 'tr')).toBe('tr');
    expect(resolveLang('en', 'tr')).toBe('en');
    expect(resolveLang('tr', 'en')).toBe('tr');
  });

  it('parseLang yalnızca tr/en kabul eder', () => {
    expect(parseLang('en')).toBe('en');
    expect(parseLang('EN')).toBeUndefined();
    expect(parseLang(null)).toBeUndefined();
  });

  it('defineText etkin dilin tablosunu döner', () => {
    const t = defineText({ tr: { hi: 'Merhaba', n: (k: number) => `${k} dosya` }, en: { hi: 'Hello', n: (k: number) => plural(k, 'file') } });
    expect(t().hi).toBe('Merhaba');
    setLang('en');
    expect(t().hi).toBe('Hello');
    expect(t().n(1)).toBe('1 file');
    expect(t().n(2)).toBe('2 files');
  });

  it('biçimleyiciler dile uyar', () => {
    const now = Date.UTC(2026, 9, 17);
    expect(formatNumber(12345)).toBe('12.345');
    expect(formatRelative(now - 3 * 3600e3, now)).toBe('3 saat önce');
    expect(rangeShort('7d')).toBe('7g');
    setLang('en');
    expect(formatNumber(12345)).toBe('12,345');
    expect(formatRelative(now - 3600e3, now)).toBe('1 hour ago');
    expect(formatRelative(now - 3 * 864e5, now)).toBe('3 days ago');
    expect(formatRelative(now - 10e3, now)).toBe('just now');
    expect(rangeShort('7d')).toBe('7d');
    expect(rangeLong('all')).toBe('All');
  });

  it('ana metinler', () => {
    expect(mainText().tabChangesCount(3)).toBe('Değişiklikler (3)');
    setLang('en');
    expect(mainText().tabContrib).toBe('Contributors');
    expect(mainText().selBranch('main', 1)).toBe('Branch main selected · 1 commit');
    expect(mainText().commitTitle(2)).toBe('Create commit (2 files)');
  });
});
