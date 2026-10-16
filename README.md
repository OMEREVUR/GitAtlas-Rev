# RewiewRev

Repoyu tek bakışta okutan harita. RewiewRev, VS Code'un yan panelinde reponu bir **treemap** olarak çizer: her kutu bir dosya, kutunun boyutu satır sayısı, rengi ne sık değiştiği (churn). Üstüne commit graph'ı, branch'ler, GitHub'daki açık PR'lar, zaman makinesi ve katkı paneli biner.

## Özellikler

**Harita (v1)**
- Repo treemap'i: klasörler iç içe kutular; klasör başlığına tıklayıp içine inilir, Backspace ile çıkılır.
- Zaman filtresi: 7 gün / 30 gün / tümü.
- Dosya kartı: son commit'ler, "Dosyayı aç", her commit için "Diff".
- Son commit'ler akışı: bir commit'e tıklayınca dokunduğu dosyalar haritada yanar.
- Explorer rozeti: sık değişen dosyaların yanında ●● / ●; panel kapalıyken de görünür.
- Harita düzenleyici alanında sekme olarak da açılabilir: **RewiewRev: Haritayı düzenleyicide aç**.

**Graph ve branch'ler (v2)**
- Commit graph: branch'ler renkli şeritler, merge'ler içi boş noktalar. Branch, yazar, tarih ve metin (mesaj, dosya, hash) filtresi; kaydırdıkça daha eski commit'ler yüklenir.
- Branch'ler paneli: lokal ve remote branch'ler, ahead/behind, son dokunma; 30 günden uzun süredir dokunulmayanlar "bayat".
- Graph'ta ya da Branch'ler panelinde seçilen commit/branch'in dosyaları haritada yanar.

**GitHub katmanı (v3)**
- **PR çakışma uyarısı:** aynı dosyaya 2+ açık PR dokunuyorsa kutu mor kesikli çerçeveyle işaretlenir; dosya kartında PR'lar listelenir; Explorer'da PR sayısı rozeti görünür.
- PR ve CI rozetleri graph'ta ve Branch'ler panelinde.
- Token gerekmez: VS Code'un yerleşik GitHub oturumu kullanılır (**RewiewRev: GitHub ile bağlan**). origin GitHub değilse katman sessizce kapalı kalır.

**Zaman makinesi ve katkı paneli (v4)**
- Zaman makinesi: kaydırıcıyla ya da oynat düğmesiyle repoyu geçmiş bir tarihte gör; ısı o tarihten önceki 7 günün değişimi, o tarihte henüz olmayan dosyalar kesik çerçeveli.
- Katkı paneli: modül sahipliği ("tek kişiye bağlı" uyarısıyla), haftalık ritim, "bu dosyayı en iyi kim bilir", yazarlar. Aynı kişinin farklı e-postaları `.mailmap` ile birleşir.

## Ayarlar

| Ayar | Varsayılan | Açıklama |
| --- | --- | --- |
| `rewiewrev.ignore` | `[]` | Haritadan ve rozetlerden hariç tutulacak ek glob desenleri. `node_modules`, `dist`, `out`, `build`, `*.lock`, `package-lock.json`, `*.min.js` zaten hariç. |
| `rewiewrev.defaultRange` | `30d` | Panel açıldığında seçili zaman aralığı. |
| `rewiewrev.graph.initialCommits` | `500` | Graph'ta ilk yüklenecek commit sayısı. |
| `rewiewrev.explorer.badges` | `hot` | Explorer rozetleri: `hot` (●● / ●), `all` (1–5 ısı), `off`. |
| `rewiewrev.github.enabled` | `true` | GitHub katmanı. |
| `rewiewrev.github.refreshInterval` | `2` | GitHub yenileme aralığı (dakika); yalnızca panel açıkken, limit azalınca otomatik uzar. |
| `rewiewrev.git.path` | `""` | Git yolu; boşsa VS Code'un `git.path` ayarı ya da PATH'teki `git`. |

## Gizlilik

- RewiewRev'in **kendi sunucusu yoktur**; hiçbir veri dışarı gönderilmez.
- Git verisi yalnızca senin makinende, yerel `git` komutlarıyla okunur; sonuçlar VS Code'un eklenti depolama alanında (globalStorage) repo başına bir dosyada cache'lenir.
- GitHub katmanı yalnızca sen bağlandığında çalışır. İstekler doğrudan `api.github.com`'a, VS Code'un GitHub oturumuyla gider; token RewiewRev tarafından saklanmaz. Çekilen PR/CI özeti yine yalnızca yerelde cache'lenir.

## Geliştirme

```
npm install
npm run build        # dist/extension.js + dist/webview.js
npm test             # vitest
npm run typecheck
```

VS Code'da **F5** ile Extension Development Host açılır. Ayrıntılar ve diğer komutlar için `CLAUDE.md`'ye bak.
