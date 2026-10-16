// Küçük glob → RegExp çevirici. Desteklenen: "**", "*", "?".
// "/" içermeyen desen (ör. "*.lock") herhangi bir derinlikteki dosya ADINA uyar.

function escapeRegex(ch: string): string {
  return /[.+^${}()|[\]\\]/.test(ch) ? `\\${ch}` : ch;
}

function normalize(p: string): string {
  return p.replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '');
}

function globToRegex(glob: string): RegExp {
  let pattern = normalize(glob.trim());
  if (!pattern.includes('/')) pattern = `**/${pattern}`;

  let out = '';
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];
    if (ch === '*') {
      if (pattern[i + 1] === '*') {
        i++;
        if (pattern[i + 1] === '/') {
          // "**/" sıfır veya daha fazla dizin.
          i++;
          out += '(?:.*/)?';
        } else {
          out += '.*';
        }
      } else {
        out += '[^/]*';
      }
    } else if (ch === '?') {
      out += '[^/]';
    } else {
      out += escapeRegex(ch);
    }
  }
  return new RegExp(`^${out}$`);
}

export function compileGlobs(globs: string[]): (path: string) => boolean {
  const regexes = globs.filter((g) => g.trim() !== '').map(globToRegex);
  if (regexes.length === 0) return () => false;
  return (path: string) => {
    const p = normalize(path);
    return regexes.some((re) => re.test(p));
  };
}
