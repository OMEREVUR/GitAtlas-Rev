# GitAtlas-Rev

*[English](README.md)*

Repoyu tek bakışta okutan harita. GitAtlas-Rev, VS Code'un yan panelinde reponu bir **treemap** olarak çizer: her kutu bir dosya, kutunun boyutu satır sayısı, rengi ne sık değiştiği (churn). Üstüne commit graph'ı, branch'ler, GitHub'daki açık PR'lar, zaman makinesi ve katkı paneli biner.

Arayüz **Türkçe** ve **İngilizce**. Varsayılan olarak VS Code'un arayüz diline uyar; `gitatlas-revrev.language` ayarıyla değiştirilebilir.

## Özellikler

**Harita**
- Repo treemap'i: klasörler iç içe kutular; klasör başlığına tıklayıp içine inilir, Backspace ile çıkılır.
- Zaman filtresi: 7 gün / 30 gün / tümü.
- Dosya kartı: son commit'ler, "Dosyayı aç", her commit için "Diff".
- Son commit'ler akışı: bir commit'e tıklayınca dokunduğu dosyalar haritada yanar.
- Explorer rozeti: sık değişen dosyaların yanında ●● / ●; panel kapalıyken de görünür.
- Harita düzenleyici alanında sekme olarak da açılabilir: **GitAtlas-Rev: Haritayı düzenleyicide aç**.

**Graph ve branch'ler**
- Commit graph: branch'ler renkli şeritler, merge'ler içi boş noktalar. Branch, yazar, tarih ve metin (mesaj, dosya, hash) filtresi; kaydırdıkça daha eski commit'ler yüklenir.
- Branch'ler paneli: lokal ve remote branch'ler, ahead/behind, son dokunma; 30 günden uzun süredir dokunulmayanlar "bayat".
- Graph'ta ya da Branch'ler panelinde seçilen commit/branch'in dosyaları haritada yanar.

**GitHub katmanı**
- **PR çakışma uyarısı:** aynı dosyaya 2+ açık PR dokunuyorsa kutu mor kesikli çerçeveyle işaretlenir; dosya kartında PR'lar listelenir; Explorer'da PR sayısı rozeti görünür.
- PR ve CI rozetleri graph'ta ve Branch'ler panelinde.
- Token gerekmez: VS Code'un yerleşik GitHub oturumu kullanılır (**GitAtlas-Rev: GitHub ile bağlan**). origin GitHub değilse katman sessizce kapalı kalır.

**Zaman makinesi ve katkı paneli**
- Zaman makinesi: kaydırıcıyla ya da oynat düğmesiyle repoyu geçmiş bir tarihte gör; ısı o tarihten önceki 7 günün değişimi, o tarihte henüz olmayan dosyalar kesik çerçeveli.
- Katkı paneli: modül sahipliği ("tek kişiye bağlı" uyarısıyla), haftalık ritim, "bu dosyayı en iyi kim bilir", yazarlar. Aynı kişinin farklı e-postaları `.mailmap` ile birleşir.

**Değişiklikler: git komutu yazmadan**
- **Değişiklikler** sekmesi: değişen dosyaları onay kutularıyla tek tek ya da hepsini commit'e ekle/çıkar, diff'e bak, değişikliği geri al.
- Commit kutusu: tür seçici (feat, fix…), özet sayacı, "Commit ve gönder", son commit'e ekleme (amend), son commit'i geri alma; altında çalışacak git komutu görünür.
- Her sekmede eşitleme çubuğu: Getir, Çek, Gönder (yeni branch'te "Yayınla"). Pull önce fast-forward dener, olmazsa merge mi rebase mi diye sorar.
- Branch'ler panelinde sağ tık: geç, yeni branch, birleştir, yeniden adlandır, sil. Saklananlar (stash): sakla, uygula, sil. Çakışmada "Çözüldü / Devam et / İptal et".
- GitHub bağlıysa **Pull request'ler**: bu branch'ten PR aç (gerekirse önce gönderir), PR'ı birleştir (merge/squash/rebase), PR branch'ine geç; "Benim PR'larım" ve "Review bekleyenler".
- Riskli her işlem önce onay ister; komutlar ve çıktıları "GitAtlas-Rev Git" çıktı kanalında.

## Ayarlar

| Ayar | Varsayılan | Açıklama |
| --- | --- | --- |
| `gitatlas-revrev.language` | `auto` | Arayüz dili: `auto` (VS Code'a uyar), `en`, `tr`. |
| `gitatlas-revrev.ignore` | `[]` | Haritadan ve rozetlerden hariç tutulacak ek glob desenleri. `node_modules`, `dist`, `out`, `build`, `*.lock`, `package-lock.json`, `*.min.js` zaten hariç. |
| `gitatlas-revrev.defaultRange` | `30d` | Panel açıldığında seçili zaman aralığı. |
| `gitatlas-revrev.graph.initialCommits` | `500` | Graph'ta ilk yüklenecek commit sayısı. |
| `gitatlas-revrev.explorer.badges` | `hot` | Explorer rozetleri: `hot` (●● / ●), `all` (1–5 ısı), `off`. |
| `gitatlas-revrev.github.enabled` | `true` | GitHub katmanı. |
| `gitatlas-revrev.github.refreshInterval` | `2` | GitHub yenileme aralığı (dakika); yalnızca panel açıkken, limit azalınca otomatik uzar. |
| `gitatlas-revrev.git.pullStrategy` | `ask` | Pull fast-forward olmazsa: `ask` (sor), `merge`, `rebase`. |
| `gitatlas-revrev.git.path` | `""` | Git yolu; boşsa VS Code'un `git.path` ayarı ya da PATH'teki `git`. |

## Gizlilik

- GitAtlas-Rev'in **kendi sunucusu yoktur**; hiçbir veri dışarı gönderilmez.
- Git verisi yalnızca senin makinende, yerel `git` komutlarıyla okunur; Değişiklikler sekmesindeki işlemler de yerel `git` ile yapılır (pre-commit hook'ların çalışır); sonuçlar VS Code'un eklenti depolama alanında (globalStorage) repo başına bir dosyada cache'lenir.
- Push/pull için önce git'in kendi kimlik bilgileri kullanılır; başarısız olursa ve GitHub'a bağlıysan bir kez VS Code GitHub oturumuyla denenir (token diske yazılmaz, loglanmaz).
- GitHub katmanı yalnızca sen bağlandığında çalışır. İstekler doğrudan `api.github.com`'a, VS Code'un GitHub oturumuyla gider; token GitAtlas-Rev tarafından saklanmaz. Çekilen PR/CI özeti yine yalnızca yerelde cache'lenir.

## Geliştirme

```
npm install
npm run build        # dist/extension.js + dist/webview.js
npm test             # vitest
npm run typecheck
```

VS Code'da **F5** ile Extension Development Host açılır. Ayrıntılar ve diğer komutlar için `CLAUDE.md`'ye bak.
