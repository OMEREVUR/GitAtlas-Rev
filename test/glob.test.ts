import { describe, expect, it } from 'vitest';
import { compileGlobs } from '../src/model/glob';

const DEFAULTS = [
  '**/node_modules/**',
  '**/dist/**',
  '**/out/**',
  '**/build/**',
  '**/*.lock',
  '**/package-lock.json',
  '**/*.min.js',
];

describe('compileGlobs', () => {
  const match = compileGlobs(DEFAULTS);

  it('varsayılan desenler kök ve iç içe yollarda eşleşir', () => {
    for (const p of [
      'node_modules/a.js',
      'node_modules/x/y/z.js',
      'a/node_modules/b.js',
      'dist/extension.js',
      'packages/web/dist/app.js',
      'out/main.js',
      'build/index.html',
      'yarn.lock',
      'sub/Cargo.lock',
      'package-lock.json',
      'apps/web/package-lock.json',
      'vendor/jquery.min.js',
      'jquery.min.js',
    ]) {
      expect(match(p), p).toBe(true);
    }
  });

  it('benzer ama farklı yolları dışarıda bırakır', () => {
    for (const p of [
      'src/main.ts',
      'src/distance.ts',
      'output/x.ts',
      'src/builder/a.ts',
      'lock.ts',
      'package.json',
      'my-package-lock.json',
      'app.min.ts',
      'src/minjs.js',
    ]) {
      expect(match(p), p).toBe(false);
    }
  });

  it('"/" içermeyen desen her derinlikte dosya adına uyar', () => {
    const m = compileGlobs(['*.lock', 'package-lock.json']);
    expect(m('yarn.lock')).toBe(true);
    expect(m('a/b/c.lock')).toBe(true);
    expect(m('a/package-lock.json')).toBe(true);
    expect(m('a/lockfile')).toBe(false);
  });

  it('"/" içeren desen köke bağlıdır; * ve ? dizin ayracını geçmez', () => {
    const m = compileGlobs(['src/generated/**', 'docs/*.md', 'f?.ts']);
    expect(m('src/generated/a.ts')).toBe(true);
    expect(m('src/generated/x/y.ts')).toBe(true);
    expect(m('lib/src/generated/a.ts')).toBe(false);
    expect(m('docs/a.md')).toBe(true);
    expect(m('docs/sub/a.md')).toBe(false);
    expect(m('f1.ts')).toBe(true);
    expect(m('dir/f1.ts')).toBe(true);
    expect(m('f12.ts')).toBe(false);
  });

  it('regex özel karakterlerini kaçırır, ters bölü ve ./ önekini normalleştirir', () => {
    const m = compileGlobs(['a+b(1).txt', './tools/**']);
    expect(m('x/a+b(1).txt')).toBe(true);
    expect(m('aab(1).txt')).toBe(false);
    expect(m('tools\\run.js')).toBe(true);
  });

  it('boş liste hiçbir şeyle eşleşmez', () => {
    expect(compileGlobs([])('a.ts')).toBe(false);
    expect(compileGlobs(['', '  '])('a.ts')).toBe(false);
  });
});
