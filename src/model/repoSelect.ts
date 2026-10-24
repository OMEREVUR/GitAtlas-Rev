// Çoklu klasörlü workspace'te repo listesi ve seçimi (saf; vscode'a bağlı değil).
import type { RepoInfo } from '../types';

/** Karşılaştırma anahtarı: ayraçlar '/', sonda ayraç yok; Windows'ta büyük/küçük harf duyarsız. */
export function rootKey(p: string, caseInsensitive: boolean): string {
  let k = p.replace(/\\/g, '/');
  while (k.length > 1 && k.endsWith('/')) k = k.slice(0, -1);
  return caseInsensitive ? k.toLowerCase() : k;
}

function baseName(p: string): string {
  const parts = p.replace(/\\/g, '/').split('/').filter((s) => s !== '');
  return parts[parts.length - 1] ?? p;
}

/** Bulunan repo köklerini (workspace klasör sırasıyla) tekilleştirir; aynı kök bir kez ve ilk görüldüğü sırada yer alır. */
export function uniqueRepos(roots: readonly string[], caseInsensitive: boolean): RepoInfo[] {
  const seen = new Set<string>();
  const out: RepoInfo[] = [];
  for (const root of roots) {
    const key = rootKey(root, caseInsensitive);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ root, name: baseName(root) });
  }
  return out;
}

/** Gösterilecek repo: kayıtlı seçim hâlâ listede ise o, değilse ilk repo; liste boşsa undefined. */
export function chooseRepo(repos: readonly RepoInfo[], saved: string | undefined, caseInsensitive: boolean): string | undefined {
  if (saved !== undefined) {
    const key = rootKey(saved, caseInsensitive);
    const hit = repos.find((r) => rootKey(r.root, caseInsensitive) === key);
    if (hit) return hit.root;
  }
  return repos[0]?.root;
}

/** Dosyayı içeren repo (iç içe repolarda en derindeki); hiçbiri değilse undefined. */
export function repoForPath(repos: readonly RepoInfo[], filePath: string, caseInsensitive: boolean): string | undefined {
  const file = rootKey(filePath, caseInsensitive);
  let best: RepoInfo | undefined;
  let bestLen = -1;
  for (const r of repos) {
    const key = rootKey(r.root, caseInsensitive);
    const inside = file === key || file.startsWith(key.endsWith('/') ? key : `${key}/`);
    if (inside && key.length > bestLen) {
      best = r;
      bestLen = key.length;
    }
  }
  return best?.root;
}
