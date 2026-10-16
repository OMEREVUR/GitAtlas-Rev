# RewiewRev — Claude için proje notları

## Proje
- RewiewRev, bir git reposunu VS Code yan panelinde treemap olarak gösteren bir eklenti. Kutu boyutu = satır sayısı, renk = churn (seçili aralıkta kaç commit'te değiştiği). Commit akışında bir commit seçilince dokunduğu dosyalar haritada yanar; Explorer'da sıcaklık rozeti görünür.
- Ürünün tek doğru kaynağı: `RewiewRev — Proje Raporu.md`. Bu dosya değiştirilmez, silinmez, taşınmaz.
- Arayüz tasarımı: `rewiewrev-design/` (salt okunur referans). Önce `rewiewrev-design/README.md`, sonra ilgili `.dc.html` okunur. `support.js` ve tasarımlardaki `THEMES`/`rrTheme()` haritası eklentiye taşınmaz.
- Ad yazımı "RewiewRev", paket adı "rewiewrev". Düzeltilmez, değiştirilmez.

## Sürüm durumu
- Şu an **v1 (MVP)**: yan panel + düzenleyici sekmesi (komut "RewiewRev: Haritayı düzenleyicide aç"; ikisi aynı provider'dan beslenir), treemap (klasöre inme ile), zaman filtresi 7g/30g/tümü, dosya kartı, son commit'ler akışı, Explorer rozeti, globalStorage cache, ignore ayarı, durum ekranları, durum çubuğu.
- v2: commit graph + branch paneli. v3: GitHub katmanı (PR çakışma uyarısı). v4: zaman makinesi + katkı paneli.
- Kapsam dışı iş yapılmaz. Tipler ileriye uygun tutulur (ör. commit'lerde `parents`).

## Teknoloji kararları (tartışmaya kapalı)
- TypeScript strict, npm.
- esbuild ile iki bundle: `dist/extension.js` (node, cjs, `vscode` external) ve `dist/webview.js` (browser, iife). Webview CSS'i `main.ts`'ten import edilir ve `dist/webview.css` olur. Codicon'lar `dist/codicons/`'a kopyalanır.
- Webview: düz TypeScript + DOM, React yok. Treemap için yalnızca `d3-hierarchy`, çizim SVG. İkonlar `@vscode/codicons`.
- Webview renkleri yalnızca `--vscode-*` değişkenleri ve onlardan türetilmiş `--rr-*` tokenları (`src/webview/base.css`). CSP + nonce'lu script.
- Git'e erişim: `child_process` ile doğrudan `git` (simple-git yok).
- Birim testleri: vitest.

## Komutlar
- Kurulum: `npm install`
- Build: `npm run build` (`--production` ile minify: `npm run vscode:prepublish`)
- Dev sayfalarıyla build: `npm run build:dev` (`dev/*.entry.ts` → `dev/out/*.js`)
- İzleme: `npm run watch`
- Tip kontrolü: `npm run typecheck` (= `npx tsc --noEmit`)
- Test: `npm test` (= `npx vitest run`)
- Fixture reposu: `npm run fixture` (= `bash scripts/make-fixture.sh`; repo yolunu stdout'a basar)
- Fixture'da uçtan uca deneme (loadSnapshot + computeFileStats; 7g/30g/tümü, rename, binary, ignore, cache süresi): `npm run try-fixture -- <repo-yolu>`
- Webview önizlemesi (gerçek model + headless Chrome ekran görüntüleri): `npm run preview -- <repo-yolu> [--name ad] [--no-shots]` → `dev/out/preview-model.js`, `dev/preview.html` (`?theme=dark|light`, `?autoselect=1`, `?width=360`, `?range=7d|30d|all`), görüntüler `dev/screenshots/<ad>-*.png`
- Bileşen önizlemeleri (sahte veri): `npm run build:dev`, sonra tarayıcıda `dev/treemap.html` ve `dev/panel.html` (`?theme=…`, `?state=…`, `?root=…`, `?highlight=1`)
- Bir TS scriptini çalıştırma: `node scripts/run-ts.mjs <dosya.ts>` (esbuild ile bundle eder, `vscode` modülünü taklit eder)
- Extension Development Host: VS Code'da F5 (`.vscode/launch.json`, önce `npm: build` çalışır).

## Klasör yapısı
- `src/types.ts`, `src/protocol.ts` — sözleşme.
- `src/git/` — git komutları, `git log --numstat` ayrıştırma, satır sayımı.
- `src/model/` — snapshot'tan `FileStat` üretme, glob eşleme, cache, `loadSnapshot` servisi.
- `src/panel/` — `WebviewViewProvider`, HTML/CSP, mesaj işleme, diff içerik sağlayıcı, durum çubuğu.
- `src/decorations/` — Explorer rozeti (`FileDecorationProvider`).
- `src/config.ts` — ayarlar (`rewiewrev.ignore` + varsayılan hariçler).
- `src/webview/` — webview: `main.ts` (düzen + durum), `layout.css`, `treemap.ts`, `rangeFilter.ts`, `fileCard.ts`, `commitFeed.ts`, `states.ts`, `heat.ts` (ortak ısı seviyesi), `format.ts` (Türkçe biçimleyiciler), `base.css` (`--rr-*` tokenları).
- `test/` — vitest testleri. `scripts/` — fixture, deneme ve önizleme scriptleri. `dev/` — önizleme sayfaları (`themes.css` sahte `--vscode-*` değişkenleri; eklentiye girmez). `dev/out/`, `dev/screenshots/` git'e girmez.

## Sözleşme kuralı
- `src/types.ts` ve `src/protocol.ts` sözleşmedir. Değişiklik ancak bilinçli bir kararla ve tüm kullanan yerler aynı anda güncellenerek yapılır.

## Kod kuralları
- strict; `any` yok (gerekirse `unknown` + daraltma).
- Yeni bağımlılık eklemeden önce sor.
- Webview'da yalnızca `--vscode-*` renkleri (ve onlardan türeyen `--rr-*`); sabit hex yok. Açık, koyu ve yüksek kontrast temada okunur olmalı.
- Kullanıcıya görünen metinler Türkçe.
- Tıklanan her şey gerçek `<button>`/`<a>`; renk tek başına bilgi taşımaz.

## Doğrulama kuralı
- "Derleniyor" yetmez. Gerekenler: testler + fixture reposunda gerçek çalıştırma + webview'ın ekran görüntüsüne bakmak (açık ve koyu tema).

## Commit mesajları
- Conventional commits: `feat:`, `fix:`, `chore:`, `test:`, `docs:`.
