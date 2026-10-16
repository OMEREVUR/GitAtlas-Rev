// Zaman aralığı segment kontrolü (7 gün / 30 gün / Tümü). Tasarım: Main.dc.html.
import './treemap.css';
import type { TimeRange } from '../types';
import { RANGE_LONG } from './format';

const RANGES: readonly TimeRange[] = ['7d', '30d', 'all'];

export function renderRangeFilter(el: HTMLElement, current: TimeRange, onChange: (r: TimeRange) => void): void {
  const group = document.createElement('div');
  group.className = 'rr-tm-range';
  group.setAttribute('role', 'group');
  group.setAttribute('aria-label', 'Zaman aralığı');
  for (const r of RANGES) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'rr-tm-range-btn';
    b.textContent = RANGE_LONG[r];
    b.setAttribute('aria-pressed', r === current ? 'true' : 'false');
    b.onclick = () => {
      if (r !== current) onChange(r);
    };
    group.append(b);
  }
  el.replaceChildren(group);
}
