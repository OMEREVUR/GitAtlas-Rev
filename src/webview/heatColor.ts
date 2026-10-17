// Isı skalasının ana rengi (--rr-orange). Bazı temalarda --vscode-charts-orange koyu arka planda
// neredeyse görünmez (ör. #5C2E10 civarı); o zaman kontrastı yeterli olan ilk adaya geçilir.
// Adayların hepsi tema değişkenlerinden türetilir; sabit renk yok.

const CANDIDATES = [
  'var(--vscode-charts-orange)',
  'var(--vscode-editorWarning-foreground)',
  'var(--vscode-charts-yellow)',
  'color-mix(in srgb, var(--vscode-charts-orange) 55%, var(--vscode-foreground))',
];

/** Koyu temada aranan en düşük kontrast (WCAG oranı, arka plana karşı). */
const MIN_CONTRAST = 3;

type Rgba = [number, number, number, number];

/** "rgb(…)", "rgba(…)" ya da "color(srgb r g b / a)" biçimindeki hesaplanmış rengi okur. */
export function parseCssColor(text: string): Rgba | undefined {
  const t = text.trim();
  let m = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/.exec(t);
  if (m) return [Number(m[1]), Number(m[2]), Number(m[3]), alpha(m[4])];
  m = /^color\(srgb\s+([\d.e-]+)\s+([\d.e-]+)\s+([\d.e-]+)(?:\s*\/\s*([\d.]+%?))?\s*\)$/.exec(t);
  if (m) return [Number(m[1]) * 255, Number(m[2]) * 255, Number(m[3]) * 255, alpha(m[4])];
  return undefined;
}

function alpha(a: string | undefined): number {
  if (a === undefined) return 1;
  return a.endsWith('%') ? Number(a.slice(0, -1)) / 100 : Number(a);
}

function luminance([r, g, b]: Rgba): number {
  const lin = (c: number): number => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** Yarı saydam rengi arka plan üstüne düşürür. */
function over(fg: Rgba, bg: Rgba): Rgba {
  const a = fg[3];
  return [fg[0] * a + bg[0] * (1 - a), fg[1] * a + bg[1] * (1 - a), fg[2] * a + bg[2] * (1 - a), 1];
}

export function contrast(a: Rgba, b: Rgba): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** Saf seçim: koyu arka planda kontrastı yeterli ilk aday; açık temada ya da hiçbiri yetmezse en iyisi. */
export function pickHeatColor(bg: Rgba, candidates: (Rgba | undefined)[]): number {
  if (luminance(bg) >= 0.4) return 0;
  let best = 0;
  let bestContrast = -1;
  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i];
    if (!c) continue;
    const ratio = contrast(over(c, bg), bg);
    if (ratio >= MIN_CONTRAST) return i;
    if (ratio > bestContrast) {
      bestContrast = ratio;
      best = i;
    }
  }
  return best;
}

/** Tanımsız tema değişkenini ayırt etmek için işaret rengi (hiçbir temada kullanılmaz). */
const SENTINEL = 'rgb(1, 2, 3)';

/** "var(--x)" adayını "var(--x, işaret)" yapar; tanımsızsa işaret rengi döner. */
function withSentinel(css: string): string {
  return css.replace(/var\((--[\w-]+)\)/g, `var($1, ${SENTINEL})`);
}

function computed(probe: HTMLElement, css: string): Rgba | undefined {
  probe.style.setProperty('color', withSentinel(css));
  const c = parseCssColor(getComputedStyle(probe).color);
  // Tanımsız değişken (işaret rengi ya da onunla karışmış) → aday yok sayılır.
  if (!c || (Math.round(c[0]) === 1 && Math.round(c[1]) === 2 && Math.round(c[2]) === 3)) return undefined;
  return c;
}

/** --rr-orange'ı ayarlar; tema değişince (html style / body class) yeniden değerlendirir. */
export function installHeatColor(): void {
  const root = document.documentElement;
  const apply = (): void => {
    const probe = document.createElement('span');
    probe.style.setProperty('display', 'none');
    document.body.append(probe);
    const bg = computed(probe, 'var(--vscode-editor-background)');
    const values = CANDIDATES.map((c) => computed(probe, c));
    probe.remove();
    if (!bg) return;
    root.style.setProperty('--rr-orange', CANDIDATES[pickHeatColor(bg, values)] ?? CANDIDATES[0] ?? '');
  };
  apply();
  let frame = 0;
  const schedule = (): void => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(apply);
  };
  new MutationObserver(schedule).observe(root, { attributes: true, attributeFilter: ['style', 'class'] });
  new MutationObserver(schedule).observe(document.body, { attributes: true, attributeFilter: ['class'] });
}
