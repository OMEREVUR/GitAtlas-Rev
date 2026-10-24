// 0.3.0: haritanın renk ölçeği seçicisi (Sıklık / Tazelik). Aralık seçicisiyle aynı segment görünümü.
import './treemap.css';
import type { ColorMode } from '../types';
import { text } from '../i18n/map';

const MODES: readonly ColorMode[] = ['churn', 'recency'];

export function renderColorMode(el: HTMLElement, current: ColorMode, onChange: (m: ColorMode) => void): void {
  const t = text();
  const group = document.createElement('div');
  group.className = 'rr-tm-range';
  group.setAttribute('role', 'group');
  group.setAttribute('aria-label', t.colorModeAria);
  for (const m of MODES) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'rr-tm-range-btn';
    b.textContent = m === 'churn' ? t.colorChurn : t.colorRecency;
    b.title = m === 'churn' ? t.colorChurnTitle : t.colorRecencyTitle;
    b.setAttribute('aria-pressed', m === current ? 'true' : 'false');
    b.onclick = () => {
      if (m !== current) onChange(m);
    };
    group.append(b);
  }
  el.replaceChildren(group);
}
