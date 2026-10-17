import { describe, expect, it } from 'vitest';
import { contrast, parseCssColor, pickHeatColor } from '../src/webview/heatColor';

describe('heatColor', () => {
  it('hesaplanmış renk biçimlerini okur', () => {
    expect(parseCssColor('rgb(209, 134, 22)')).toEqual([209, 134, 22, 1]);
    expect(parseCssColor('rgba(209, 134, 22, 0.5)')).toEqual([209, 134, 22, 0.5]);
    expect(parseCssColor('color(srgb 1 0.5 0)')).toEqual([255, 127.5, 0, 1]);
    expect(parseCssColor('color(srgb 1 0.5 0 / 50%)')).toEqual([255, 127.5, 0, 0.5]);
    expect(parseCssColor('transparent')).toBeUndefined();
  });

  it('koyu temada koyu turuncuyu atlayıp okunur ilk adayı seçer', () => {
    const bg: [number, number, number, number] = [31, 31, 31, 1];
    const darkOrange: [number, number, number, number] = [92, 46, 16, 1];
    const warning: [number, number, number, number] = [204, 167, 0, 1];
    expect(contrast(darkOrange, bg)).toBeLessThan(3);
    expect(pickHeatColor(bg, [darkOrange, warning, undefined])).toBe(1);
    // Varsayılan Dark Modern turuncusu yeterli → ilk aday.
    expect(pickHeatColor(bg, [[209, 134, 22, 1], warning])).toBe(0);
  });

  it('açık temada her zaman turuncu', () => {
    expect(pickHeatColor([255, 255, 255, 1], [[209, 134, 22, 1]])).toBe(0);
  });

  it('yarı saydam aday arka plana düşürülerek değerlendirilir', () => {
    const bg: [number, number, number, number] = [31, 31, 31, 1];
    expect(pickHeatColor(bg, [[209, 134, 22, 0.2], [209, 134, 22, 1]])).toBe(1);
  });
});
