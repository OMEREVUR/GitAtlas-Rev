import { describe, expect, it } from 'vitest';
import { chooseRepo, repoForPath, rootKey, uniqueRepos } from '../src/model/repoSelect';

describe('rootKey', () => {
  it('ayraçları ve sondaki ayracı normalleştirir', () => {
    expect(rootKey('C:\\work\\api\\', true)).toBe('c:/work/api');
    expect(rootKey('/home/a/web/', false)).toBe('/home/a/web');
    expect(rootKey('/', false)).toBe('/');
  });
});

describe('uniqueRepos', () => {
  it('aynı kökü bir kez, ilk sırasında tutar ve klasör adını verir', () => {
    const repos = uniqueRepos(['C:\\work\\api', 'C:\\work\\web', 'c:\\Work\\API\\'], true);
    expect(repos).toEqual([
      { root: 'C:\\work\\api', name: 'api' },
      { root: 'C:\\work\\web', name: 'web' },
    ]);
  });

  it('büyük/küçük harf duyarlı sistemde farklı kökleri ayrı tutar', () => {
    expect(uniqueRepos(['/w/Api', '/w/api'], false)).toHaveLength(2);
  });
});

describe('chooseRepo', () => {
  const repos = uniqueRepos(['/w/api', '/w/web'], false);

  it('kayıtlı seçim listede ise onu döner', () => {
    expect(chooseRepo(repos, '/w/web', false)).toBe('/w/web');
    expect(chooseRepo(uniqueRepos(['C:\\w\\api', 'C:\\w\\web'], true), 'c:/W/WEB', true)).toBe('C:\\w\\web');
  });

  it('kayıtlı seçim yoksa ya da listeden çıktıysa ilk repoyu döner', () => {
    expect(chooseRepo(repos, undefined, false)).toBe('/w/api');
    expect(chooseRepo(repos, '/w/gone', false)).toBe('/w/api');
  });

  it('liste boşsa undefined', () => {
    expect(chooseRepo([], '/w/api', false)).toBeUndefined();
  });
});

describe('repoForPath', () => {
  const repos = uniqueRepos(['/w/api', '/w/api/vendor/lib', '/w/web'], false);

  it('dosyayı içeren repoyu bulur', () => {
    expect(repoForPath(repos, '/w/web/src/index.ts', false)).toBe('/w/web');
  });

  it('iç içe repolarda en derindekini seçer', () => {
    expect(repoForPath(repos, '/w/api/vendor/lib/a.ts', false)).toBe('/w/api/vendor/lib');
    expect(repoForPath(repos, '/w/api/vendor/other.ts', false)).toBe('/w/api');
  });

  it('adı yalnızca önek olarak eşleşen klasörü saymaz', () => {
    expect(repoForPath(repos, '/w/api-docs/readme.md', false)).toBeUndefined();
  });

  it('Windows yollarında harf duyarsız eşleşir', () => {
    const win = uniqueRepos(['C:\\Work\\Api'], true);
    expect(repoForPath(win, 'c:\\work\\api\\src\\x.ts', true)).toBe('C:\\Work\\Api');
  });

  it('hiçbir repoda olmayan dosyada undefined', () => {
    expect(repoForPath(repos, '/tmp/scratch.txt', false)).toBeUndefined();
  });
});
