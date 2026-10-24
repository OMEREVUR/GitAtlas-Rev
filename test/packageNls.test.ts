import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as {
  contributes: {
    commands: { command: string }[];
    views: Record<string, { id: string }[]>;
    walkthroughs?: { id: string; steps: { id: string; description: string; media: { image: string } }[] }[];
  };
};
const en = JSON.parse(readFileSync('package.nls.json', 'utf8')) as Record<string, string>;
const tr = JSON.parse(readFileSync('package.nls.tr.json', 'utf8')) as Record<string, string>;

/** package.json'da geçen bütün %anahtar% yer tutucuları. */
function placeholders(): string[] {
  const keys = new Set<string>();
  for (const m of readFileSync('package.json', 'utf8').matchAll(/"%([^%"]+)%"/g)) keys.add(m[1] ?? '');
  return [...keys];
}

describe('package.nls', () => {
  it("package.json'daki her %anahtar% İngilizce ve Türkçe dosyada var", () => {
    const keys = placeholders();
    expect(keys.length).toBeGreaterThan(0);
    expect(keys.filter((k) => !(k in en))).toEqual([]);
    expect(keys.filter((k) => !(k in tr))).toEqual([]);
  });

  it('iki dil dosyası aynı anahtarları taşır', () => {
    expect(Object.keys(tr).sort()).toEqual(Object.keys(en).sort());
  });
});

describe('walkthrough', () => {
  const steps = pkg.contributes.walkthroughs?.flatMap((w) => w.steps) ?? [];
  const known = new Set([
    ...pkg.contributes.commands.map((c) => c.command),
    // VS Code her görünüm için "<id>.focus" komutunu kendisi üretir.
    ...Object.values(pkg.contributes.views).flat().map((v) => `${v.id}.focus`),
  ]);

  it('her adımın görseli pakette var', () => {
    expect(steps.length).toBeGreaterThan(0);
    for (const s of steps) expect(existsSync(s.media.image), s.media.image).toBe(true);
  });

  it('açıklamalardaki komut linkleri tanımlı komutlara gider (iki dilde de)', () => {
    for (const s of steps) {
      const key = s.description.replace(/^%|%$/g, '');
      for (const text of [en[key] ?? '', tr[key] ?? '']) {
        expect(text, key).not.toBe('');
        for (const m of text.matchAll(/\(command:([^)?\s]+)/g)) expect(known.has(m[1] ?? ''), `${key}: ${m[1]}`).toBe(true);
      }
    }
  });
});
