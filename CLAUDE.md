# RewiewRev — Claude için proje notları

## Proje
- RewiewRev, bir git reposunu VS Code yan panelinde treemap olarak gösteren bir eklenti. Kutu boyutu = satır sayısı, renk = churn (seçili aralıkta kaç commit'te değiştiği). Commit akışında bir commit seçilince dokunduğu dosyalar haritada yanar; Explorer'da sıcaklık rozeti görünür.
- Ürünün tek doğru kaynağı: `RewiewRev — Proje Raporu.md`. Bu dosya değiştirilmez, silinmez, taşınmaz.
- Arayüz tasarımı: `rewiewrev-design/` (salt okunur referans). Önce `rewiewrev-design/README.md`, sonra ilgili `.dc.html` okunur. `support.js` ve tasarımlardaki `THEMES`/`rrTheme()` haritası eklentiye taşınmaz.
- Ad yazımı "RewiewRev", paket adı "rewiewrev". Düzeltilmez, değiştirilmez.

## Sürüm durumu
- Şu an **v1 (MVP)**: treemap (klasöre inme ile), zaman filtresi 7g/30g/tümü, dosya kartı, son commit'ler akışı, Explorer rozeti, globalStorage cache, ignore ayarı, durum ekranları, durum çubuğu.
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
- Fixture'da uçtan uca deneme (loadSnapshot + computeFileStats, cache süresi): `npx tsx scripts/try-fixture.ts <repo-yolu>` *(birleştirmede eklenecek)*
- Webview önizlemesi: `npm run preview -- <repo-yolu>` → `dev/preview.html` + ekran görüntüleri `dev/screenshots/` *(birleştirmede eklenecek)*
- Extension Development Host: VS Code'da F5 (`.vscode/launch.json`, önce `npm: build` çalışır).

## Klasör yapısı
- `src/types.ts`, `src/protocol.ts` — sözleşme.
- `src/git/` — git komutları, `git log --numstat` ayrıştırma, satır sayımı.
- `src/model/` — snapshot'tan `FileStat` üretme, glob eşleme, cache, `loadSnapshot` servisi.
- `src/panel/` — `WebviewViewProvider`, HTML/CSP, mesaj işleme, diff içerik sağlayıcı, durum çubuğu.
- `src/decorations/` — Explorer rozeti (`FileDecorationProvider`).
- `src/config.ts` — ayarlar (`rewiewrev.ignore` + varsayılan hariçler).
- `src/webview/` — webview: `main.ts` (düzen + durum), `treemap.ts`, `rangeFilter.ts`, `fileCard.ts`, `commitFeed.ts`, `states.ts`, `heat.ts`, CSS'ler.
- `test/` — vitest testleri. `scripts/` — fixture ve deneme scriptleri. `dev/` — sahte veriyle açılan önizleme sayfaları.

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
