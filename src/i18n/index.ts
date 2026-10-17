// Dil desteği (Türkçe + İngilizce). Saf modül: vscode'a ve DOM'a bağlı değil; eklenti de webview de kullanır.
// Her alan kendi sözlüğünü `defineText({ tr, en })` ile tanımlar; `en`, `tr` ile aynı anahtarları ve
// aynı imzaları taşımak zorundadır (tip denetimi eksik/fazla anahtarı yakalar).

export type Lang = 'tr' | 'en';

let current: Lang = 'tr';

/** Etkin dil. Varsayılan 'tr' (testler ve eski davranış); eklenti açılışta, webview ilk render'dan önce ayarlar. */
export function getLang(): Lang {
  return current;
}

export function setLang(lang: Lang): void {
  current = lang;
}

/** Intl için yerel ayar. */
export function locale(): string {
  return current === 'tr' ? 'tr-TR' : 'en-US';
}

/** 'tr', 'en' ya da undefined (tanınmayan değer). */
export function parseLang(value: string | null | undefined): Lang | undefined {
  return value === 'tr' || value === 'en' ? value : undefined;
}

/**
 * Ayar + VS Code arayüz dili → etkin dil. Ayar 'auto' (ya da tanınmayan) ise VS Code dili
 * 'tr' ile başlıyorsa Türkçe, aksi hâlde İngilizce.
 */
export function resolveLang(setting: string | undefined, uiLanguage: string): Lang {
  return parseLang(setting) ?? (uiLanguage.toLowerCase().startsWith('tr') ? 'tr' : 'en');
}

/** Sözlüğün değer tipleri: düz metin ya da parametreli metin üreten fonksiyon. */
export type TextValue = string | ((...args: never[]) => string);
export type TextTable = Record<string, TextValue>;

/** Sözlük tanımı: `const T = defineText({ tr: {...}, en: {...} }); T().save`. */
export function defineText<T extends TextTable>(tables: { tr: T; en: NoInfer<T> }): () => T {
  return () => tables[current];
}

/** İngilizce tekil/çoğul: plural(1, 'commit') → "1 commit", plural(3, 'commit') → "3 commits". */
export function plural(n: number, one: string, many = `${one}s`, num: (n: number) => string = String): string {
  return `${num(n)} ${n === 1 ? one : many}`;
}
