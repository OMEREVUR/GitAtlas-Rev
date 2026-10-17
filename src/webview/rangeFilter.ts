// Zaman aralığı segment kontrolü (7 gün / 30 gün / Tümü). Tasarım: Main.dc.html.
import './treemap.css';
import type { TimeRange } from '../types';
import { rangeLong } from './format';
import { text } from '../i18n/map';

const RANGES: readonly TimeRange[] = ['7d', '30d', 'all'];

export function renderRangeFilter(el: HTMLElement, current: TimeRange, onChange: (r: TimeRange) => void): void {
  const group = document.createElement('div');
  group.className = 'rr-tm-range';
  group.setAttribute('role', 'group');
  group.setAttribute('aria-label', text().rangeAria);
  for (const r of RANGES) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'rr-tm-range-btn';
    b.textContent = rangeLong(r);
    b.setAttribute('aria-pressed', r === current ? 'true' : 'false');
    b.onclick = () => {
      if (r !== current) onChange(r);
    };
    group.append(b);
  }
  el.replaceChildren(group);
}
