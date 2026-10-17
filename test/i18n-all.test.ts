import { afterEach, describe, expect, it } from 'vitest';
import { setLang, type TextTable } from '../src/i18n';
import { text as changes } from '../src/i18n/changes';
import { text as github } from '../src/i18n/github';
import { text as graph } from '../src/i18n/graph';
import { mainText } from '../src/i18n/main';
import { text as map } from '../src/i18n/map';
import { text as ops } from '../src/i18n/ops';
import { panelText } from '../src/i18n/panel';

const DICTS: Record<string, () => TextTable> = { changes, github, graph, main: mainText, map, ops, panel: panelText };
const TURKISH = /[çğıöşüÇĞİÖŞÜ]/;

/** Değeri metne çevirir; fonksiyonsa sayı ve kısa metin argümanlarıyla dener (beklenmedik tipte patlarsa atlanır). */
function samples(v: TextTable[string]): string[] {
  if (typeof v === 'string') return [v];
  const out: string[] = [];
  for (const arg of [1, 3, 'x']) {
    try {
      const args = Array.from({ length: Math.max(v.length, 1) }, () => arg) as never[];
      const s: unknown = v(...args);
      if (typeof s === 'string') out.push(s);
    } catch {
      // nesne bekleyen fonksiyonlar
    }
  }
  return out;
}

afterEach(() => setLang('tr'));

describe('tüm sözlükler', () => {
  for (const [name, dict] of Object.entries(DICTS)) {
    it(`${name}: iki dilde aynı anahtarlar, İngilizcede Türkçe harf yok`, () => {
      setLang('tr');
      const tr = dict();
      setLang('en');
      const en = dict();
      expect(Object.keys(en).sort()).toEqual(Object.keys(tr).sort());
      for (const [key, value] of Object.entries(en)) {
        for (const s of samples(value)) {
          expect(TURKISH.test(s), `${name}.${key}: ${s}`).toBe(false);
        }
      }
    });
  }
});
