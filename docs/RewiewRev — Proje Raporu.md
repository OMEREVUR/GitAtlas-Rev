# GitAtlas-Rev — Proje Raporu

İlk sürüm: Oct 16, 2026 · Güncelleme: Oct 17, 2026 (0.2.0) · @Ömer

Not: Proje "RewiewRev" adıyla başladı, Marketplace'te görünen adı **GitAtlas-Rev** oldu (paket `gitatlas-rev`, Marketplace ID'si `Omer-Cayir.gitatlas-rev`). Bu dosya ve `rewiewrev-design/` klasörü eski adı taşır; komut, ayar ve görünüm kimlikleri `gitatlas-revrev.*` olarak kaldı.

## Özet

GitAtlas-Rev, VS Code içinde bir repoyu tek ekranda takip etmeyi sağlayan bir eklenti: dosyalar bir ısı haritası (treemap) olarak çizilir, üstüne GitHub verisi katman olarak eklenir. Lokal git "nerede ne değişiyor" sorusunu, GitHub katmanı "şu an kim neye dokunuyor" sorusunu cevaplar.

Commit graph'ı ve branch paneli de eklentinin içinde, ama ayrı bir ekran gibi değil, haritaya bağlı çalışır: graph'ta bir commit ya da branch seçildiğinde dokunduğu dosyalar haritada yanar.

Planlanan dört sürümün hepsi (harita, graph, GitHub katmanı, zaman makinesi ve katkı paneli) tamamlandı. Plana ek olarak iki sürüm daha geldi: **v5** ile eklenti repoya da yazar (komut yazmadan add/commit/push/pull, branch işlemleri, stash, çakışma, pull request'ler), **v6 / 0.2.0** ile arayüz Türkçe + İngilizce oldu. 0.1.0 Marketplace'e yüklendi; 0.2.0 güncellemesi hazır.

## Problem ve hedef kullanıcı

Bir repoyu takip etmek bugün dağınık bir iş: geçmiş terminalde ya da commit listesinde, PR'lar GitHub sekmesinde, CI sonucu başka bir sayfada. Hiçbiri "projenin hangi kısmı riskli, hangi değişiklikler çarpışacak" sorusunu bir bakışta cevaplamıyor.

Somut dertler:

- **Riskli dosyaları bilmemek:** Sık değişen dosyalar hata kaynağıdır ama bunu görmek için `git log` çıktısını elle okumak gerekir.
- **Çakışmaları geç fark etmek:** İki kişi aynı dosyaya PR açtığında bu ancak merge sırasında conflict olarak ortaya çıkar.
- **Lokal ve remote arasındaki kopukluk:** Push'lanmamış commit'ler, geride kalan branch'ler, kırmızı CI ayrı ayrı yerlerde görünür.
- **Git komutlarını ezberlemek:** Commit, push, pull, branch ve PR işlemleri için terminale ya da başka bir araca geçmek gerekir (v5 ile eklendi).

Hedef kullanıcılar:

1. **Küçük ekipler (2–10 geliştirici):** Aynı repoda paralel çalışan, PR çakışmasını yaşayan ekipler. Asıl değer burada.
2. **Tek başına geliştiriciler:** Kendi projesinin sıcak noktalarını ve geçmişini görmek isteyenler. MVP bu kullanıcıyı tek başına tatmin etmeli.
3. **Projeye yeni katılanlar:** Bir kod tabanını tanımaya çalışan, "nereden başlasam" diyen kişiler.

## Rakipler ve konumlanma

Commit grafiği ve PR listesi alanları dolu; boş olan, git geçmişi ile GitHub durumunu aynı haritada birleştirmek. Bu yüzden commit graph'ı tek başına bir ürün olarak değil, haritaya ve PR katmanına bağlı bir görünüm olarak yapıldı.

| Araç | Ne yapıyor | Eksik kaldığı yer |
| --- | --- | --- |
| Git Graph | Branch'leri ve commit'leri ağaç olarak çizer | Sadece geçmiş; risk ya da GitHub durumu yok |
| GitLens | Blame, dosya geçmişi, satır bazlı ısı, commit grafiği | Dosya ve satır odaklı; repo geneline tek bakış yok, bazı özellikler ücretli |
| GitHub Pull Requests | PR ve issue'ları VS Code içinde listeler, review yaptırır | PR'lar liste hâlinde; dosya haritasıyla ve çakışmayla ilişki kurmaz |
| Gource | Repo geçmişini animasyon olarak oynatır | VS Code dışında, sadece izlemelik; etkileşim yok |
| CodeScene | Churn ve karmaşıklığa göre "hotspot" analizi | Ağır, kurumsal bir araç; editörde hafif bir panel değil |

**Konumlanma:** "Repoyu tek bakışta okutan harita." GitLens'in yerine geçmeye çalışmıyoruz, onunla birlikte kurulacak bir eklenti oluyoruz. Fark yaratan üç şey: repo genelini gösteren treemap, haritaya bağlı commit graph'ı ve PR çakışma uyarısı. v5'teki git işlemleri bu farkın yerine geçmez; haritadan ayrılmadan işi bitirmeyi sağlar.

Not: Rakip bilgileri genel bilgiye dayanıyor. Marketplace'teki güncel hâlleri henüz kontrol edilmedi (sonraki adımlarda).

## Ürün konsepti

Eklentinin merkezinde tek bir görünüm var: repo treemap'i. Her kutu bir dosya; kutunun boyutu satır sayısını, rengi "churn"ü (seçili aralıkta kaç commit'te değiştiğini) gösterir. Klasörler iç içe kutular olarak durur.

Bu haritanın üstüne iki katman biner:

- **Git katmanı (her zaman açık):** Değişiklik sıklığı, eklenen/silinen satır, son dokunma tarihi, dosyaya dokunan yazarlar, commit edilmemiş değişiklik rozeti. Kaynak lokal repo, internet gerekmez.
- **GitHub katmanı (opsiyonel):** Açık PR'ların dokunduğu dosyalar, aynı dosyada birden fazla PR olması, branch başına CI sonucu. Kullanıcı GitHub'a bağlanınca açılır.

Panel yan çubukta durur; aynı içerik "GitAtlas-Rev: Haritayı düzenleyicide aç" komutuyla bir düzenleyici sekmesi olarak da açılır. Webview'un üstünde beş sekme var, hepsi haritayla konuşur:

- **Harita:** Treemap, zaman filtresi (7 gün / 30 gün / tümü), dosya kartı ve son commit'ler akışı. Bir commit'e tıklayınca dokunduğu dosyalar haritada yanar.
- **Graph:** Branch'ler renkli şeritler, merge'ler birleşme noktaları olarak çizilir. Branch, yazar, tarih ve metne (mesaj, dosya, hash) göre filtrelenir; "Sade liste" modu var. Seçilen commit ya da branch'in ayrıntısı ve mini haritası yanda görünür.
- **Zaman:** Kaydırıcı ve oynat düğmesiyle repo geçmiş bir tarihte görülür. Yerleşim sabittir, ısı o tarihten önceki 7 günün değişimidir, henüz olmayan dosyalar kesik çerçevelidir.
- **Katkı:** Modül sahipliği ve "tek kişiye bağlı" uyarısı (≥%80), haftalık ritim, "bu dosyayı en iyi kim bilir?", yazar kartları.
- **Değişiklikler (v5):** Değişen dosyalar, commit kutusu, stash, çakışma bandı ve pull request'ler.

Her sekmenin üstünde eşitleme çubuğu (Getir / Çek / Gönder) var. Yan çubukta ayrıca yerel bir **Branch'ler** ağacı durur: lokal ve remote branch'ler, ahead/behind, son dokunma, 30 günden eski "bayat" branch'ler, GitHub bağlıysa PR ve CI; sağ tıkla branch işlemleri.

Kullanıcı bir kutuya tıkladığında dosyanın kartı açılır: satır, commit sayısı, yazarlar, son commit'ler, ona dokunan açık PR'lar, "Dosyayı aç" ve her commit için "Diff". Explorer'daki dosya adlarının yanında da sıcaklık rozeti (ve PR sayısı) görünür; panel kapalıyken bile harita bilgisi kaybolmaz.

## Özellikler

Ürün dört planlı sürümde büyüdü, sonra iki sürüm daha eklendi; her sürüm bir öncekinin verisini kullandı. Hepsi tamamlandı ve kullanıcı tarafından Extension Development Host'ta (F5) denendi.

| Sürüm | Özellik | Ne işe yarar | Gerekli veri | Durum |
| --- | --- | --- | --- | --- |
| v1 (MVP) | Repo treemap'i | Riskli dosyaları tek bakışta gösterir; klasöre inme | `git log --numstat` | Tamam |
| v1 (MVP) | Zaman filtresi (7 gün / 30 gün / tümü) | Eski ve yeni sıcak noktaları ayırır | Aynı veri, tarihe göre süzülür | Tamam |
| v1 (MVP) | Dosya kartı | Son commit'ler, dosyayı aç, diff'i gör | `git log -- <dosya>` | Tamam |
| v1 (MVP) | Son commit'ler akışı | Commit'e tıklayınca dokunduğu dosyalar haritada yanar | `git log --name-only` | Tamam |
| v1 (MVP) | Explorer rozeti | Panel kapalıyken de sıcaklığı gösterir | Treemap'in cache'i | Tamam |
| v1 (MVP) | Düzenleyici sekmesi, durum çubuğu, ignore ayarı, durum ekranları | Haritayı büyük ekranda açmak, yükleme/boş/hata durumları | — | Tamam |
| v2 | Commit graph | Şerit yerleşimi, merge noktaları; branch, yazar, tarih, metin filtresi; 500'lük sayfalar | `git log --all --topo-order --parents` + ref'ler | Tamam |
| v2 | Branch paneli | Lokal ve remote branch'ler: son commit, ahead/behind, bayat olanlar | `git for-each-ref` + `git rev-list --count` | Tamam |
| v2 | Graph ↔ harita bağı | Seçilen commit ya da branch'in dosyalarını haritada gösterir, seçim çubuğu | v1 ve v2 verisi birlikte | Tamam |
| v3 | GitHub'a bağlanma | Tek tıkla giriş, token yok | VS Code GitHub oturumu | Tamam |
| v3 | PR çakışma uyarısı | 2+ açık PR'ın dokunduğu dosyada mor kesikli çerçeve; dosya kartında "Açık PR'lar" | Açık PR'lar + değişen dosyaları | Tamam |
| v3 | PR ve CI rozetleri | Graph'ta, Branch'ler ağacında ve Explorer'da | GitHub PR'ları + check'ler | Tamam |
| v4 | Zaman makinesi | Kaydırıcı + oynat, histogram, dönüm noktaları | v1 verisi, tarih ekseniyle | Tamam |
| v4 | Katkı paneli | Modül sahipliği, haftalık ritim, dosya uzmanı; `.mailmap` desteği | v1 verisi, yazara göre gruplanır | Tamam |
| v5 (plan dışı) | Değişiklikler sekmesi | Seçerek/tümünü add, diff, geri al; commit kutusu (tür çipleri, 50/72 sayacı, amend, commit ve gönder, son commit'i geri al) | `git status --porcelain=v2` | Tamam |
| v5 (plan dışı) | Eşitleme çubuğu | Getir / Çek / Gönder; pull önce `--ff-only`, olmazsa sorar; yeni branch'te `-u` | git | Tamam |
| v5 (plan dışı) | Branch işlemleri, stash, çakışma | Branch'ler ağacında sağ tık (geç, yeni, birleştir, yeniden adlandır, sil); stash; Çözüldü / Devam et / İptal et | git | Tamam |
| v5 (plan dışı) | Pull request'ler | Bu branch'ten PR aç, PR kartı (review, check'ler, birleştir: merge/squash/rebase), Benim PR'larım, Review bekleyenler, checkout | GitHub GraphQL + REST | Tamam |
| v6 / 0.2.0 | İngilizce arayüz | Dil ayarı `auto/en/tr`; menü, komut ve ayar adları yerelleştirildi; README İngilizce + Türkçe | — | Tamam |

v1 ve v2 GitHub olmadan, tamamen lokal git ile çalışır. v3'ün ilk ve en önemli özelliği PR çakışma uyarısı; diğer GitHub özellikleri onun üzerine eklendi.

**Ayarlar** (hepsi `gitatlas-revrev.` önekli): `language`, `ignore`, `defaultRange`, `graph.initialCommits`, `explorer.badges` (hot/all/off), `github.enabled`, `github.refreshInterval`, `git.pullStrategy` (ask/merge/rebase), `git.path`.

## Teknik mimari

Eklenti üç katmandan oluşur: veri kaynakları, bunları tek modelde birleştiren çekirdek ve bu modeli okuyan arayüz. Arayüz hiçbir zaman git'e ya da GitHub'a doğrudan gitmez.

```
 git (child_process)  ─┐
                       ├─►  model (snapshot, FileStat, graph, timeline, contrib)  ─►  webview (postMessage, JSON)
 GitHub (GraphQL/REST) ┘                         │                               └─►  Explorer rozeti, Branch'ler ağacı, durum çubuğu
                                                 └─►  cache (globalStorage, repo başına)
 yazma işlemleri:  webview / ağaç  ─►  OpQueue  ─►  git / GitHub
```

Git ve GitHub katmanları veriyi modelde birleştirir; webview, Explorer rozeti ve Branch'ler ağacı yalnızca bu modeli okur. Cache yeniden açılışları hızlandırır. v5'teki yazma işlemleri tek bir kuyruktan (OpQueue) geçer.

**Teknoloji kararları** (planda seçenek olarak duranlar netleşti):

- **Dil ve paketleme:** TypeScript strict, npm. `yo code` yerine elle kurulmuş iskelet; esbuild ile iki bundle: `dist/extension.js` (Node, cjs) ve `dist/webview.js` (tarayıcı, iife) + `dist/webview.css`.
- **Git erişimi:** `child_process` ile doğrudan `git` komutları; `simple-git` kullanılmadı.
- **Arayüz:** React yok; webview düz TypeScript + DOM. Treemap için yalnızca `d3-hierarchy`, çizim SVG. İkonlar `@vscode/codicons`. Renkler yalnızca VS Code tema değişkenlerinden (`--vscode-*` ve onlardan türeyen `--rr-*`); açık, koyu ve yüksek kontrast temada okunur. CSP + nonce'lu script.
- **Cache:** `context.globalStorageUri` altında repo başına bir JSON dosyası; son işlenen commit hash'i saklanır, sonraki açılışta yalnızca ondan sonraki commit'ler işlenir (HEAD geriye gittiyse tam tarama).
- **Dil desteği:** `src/i18n/` altında alan sözlükleri (tr + en), `package.nls.json` ve `package.nls.tr.json`.
- **Testler:** vitest; 32 test dosyasında 377 test. Git işlemleri gerçek git repolarına karşı test edilir; uçtan uca denemeler için bir fixture reposu üreten script ve headless Chrome ile webview ekran görüntüsü alan bir önizleme scripti var.

**Graph çizimi.** Commit'ler `git log --all --topo-order --parents` ile alınır. Şerit (lane) yerleşimi eklentide hesaplanır (`layoutGraph`), webview sadece hazır koordinatları SVG ile çizer. İlk 500 commit yüklenir (`graph.initialCommits`), kaydırdıkça daha eskileri gelir. Şimdiye kadar Canvas'a geçmek gerekmedi.

**Provider soyutlaması.** GitHub'a özel kod tek bir sınıfta (`GitHubProvider`) kalır. İleride GitLab eklemek, aynı arayüzü uygulayan yeni bir sınıf yazmak demektir:

```ts
interface RemoteProvider {
  isAvailable(): Promise<boolean>;
  getOpenPullRequests(): Promise<PullRequest[]>;
  getBranchStatus(branch: string): Promise<CiStatus>;
}
```

**Yazma işlemlerinin güvenlik kuralları (v5).**

- Riskli işlemler (değişikliği geri al, branch sil, zorla gönder, gönderilmiş commit'i değiştir, stash sil, işlemi iptal et, PR birleştir) modal onay ister.
- `--no-verify` yok; pre-commit hook'ları çalışır.
- Aynı anda tek yazma işlemi çalışır (OpQueue); GitHub işlemleri de aynı kuyruktadır.
- Git asla terminal ya da editör beklemez (`GIT_TERMINAL_PROMPT=0`, `GIT_EDITOR=true`).
- Push/pull'da kimlik doğrulama hatası olursa bir kez VS Code GitHub oturumuyla askpass üzerinden tekrar denenir; token log'a, komut metnine ya da ayrıntıya yazılmaz.
- Çalışan komutlar ve çıktıları "GitAtlas-Rev Git" çıktı kanalında görünür.

## GitHub entegrasyonu

GitHub katmanı token istemeden, tek sorguyla ve cache'li çalışır.

**Kimlik doğrulama.** VS Code'un yerleşik GitHub girişi kullanılır; kullanıcı ayrı bir token oluşturmaz:

```ts
const session = await vscode.authentication.getSession(
  'github', ['repo'], { createIfNone: true }
);
```

**Repo eşleştirme.** Lokal repodaki `origin` adresinden `owner/repo` çıkarılır. Remote GitHub değilse katman sessizce kapalı kalır, eklenti git katmanıyla çalışmaya devam eder.

**Veri çekme.** Okuma GraphQL ile yapılır: açık PR'lar, her PR'ın değiştirdiği dosyalar, head branch'i, check durumu, branch CI'ı ve rate limit tek sorguda gelir. PR açma, birleştirme ve uzak branch silme gibi yazma işlemleri REST ile yapılır.

**Rate limit ve tazelik.**

- Sonuçlar `globalStorage` altında repo başına cache'lenir.
- Yenileme sadece panel görünürken yapılır; aralık ayarlanabilir (`github.refreshInterval`), varsayılan 2 dakika.
- Kullanıcı "Yenile" ile elle de tetikleyebilir.
- Kalan limit düşükse yenileme aralığı otomatik uzar (×5) ve durum bandında uyarı görünür. Eski veride çakışma çerçevesi gri çizilir.
- Durum bandı: kapalı, bağlanıyor, bağlı, limit, eski veri, GitHub değil, hata.

**Gizlilik.** Veri sadece kullanıcının makinesinde tutulur, eklentinin kendi sunucusu yoktur. README.md ve README.tr.md'de gizlilik bölümü var.

## Yol haritası

Planda süreler haftada 10–15 saatlik yan proje temposuna göre tahmin edilmişti (MVP 3 hafta, graph 5. hafta, GitHub 7. hafta). Gerçekte iş birkaç Claude Code oturumuna bölünerek (bir şef, birkaç işçi) çok daha hızlı ilerledi: v1'den v6'ya kadar her şey 16–17 Ekim 2026'da yazıldı.

| Faz | Ne geldi | Kapı | Durum |
| --- | --- | --- | --- |
| v1 (MVP) | Harita, dosya kartı, commit akışı, Explorer rozeti, cache | Kullanıcı F5 ile denedi | Tamam |
| v2 | Commit graph, Branch'ler ağacı, graph ↔ harita bağı | Kullanıcı F5 ile denedi | Tamam |
| v3 | GitHub katmanı, PR çakışma uyarısı, PR/CI rozetleri | Gerçek kullanıcı geri bildirimi kapısı kullanıcının isteğiyle atlandı | Tamam |
| v4 | Zaman makinesi, katkı paneli | Kullanıcı F5 ile denedi | Tamam |
| v5 | Değişiklikler sekmesi, git ve PR işlemleri | Kullanıcı F5 ile denedi | Tamam |
| 0.1.0 | İlk Marketplace sürümü (Türkçe) | — | Yüklendi |
| v6 / 0.2.0 | İngilizce arayüz, dil ayarı | — | Hazır, Marketplace güncellemesi bekliyor |

Planın uyardığı risk gerçekleşti: v2'den sonraki "gerçek kullanıcı geri bildirimi" kapısı beklenmeden ilerlendi. İlk dış geri bildirim 0.2.0'dan sonra geldi (aşağıda).

## Riskler ve önlemler

En büyük risk teknik değil, kapsamdı. Kapsam planın çok ötesine geçti (v5 ve v6), ama sürümler sırayla ve her biri test edilerek ilerlediği için ilk sürüm gecikmedi.

| Risk | Etki | Önlem | Bugünkü durum |
| --- | --- | --- | --- |
| Kapsamın büyümesi | MVP gecikir, motivasyon düşer | v1 sadece lokal git ve treemap; graph v2'de, GitHub v3'te bekler | Sıra korundu; v5/v6 bilinçli eklendi |
| Graph'ın beklenenden uzun sürmesi | Şerit yerleşimi zor bir algoritma, v2 uzar | İlk sürümde sadece son 500 commit | Sorun olmadı; 500'lük sayfalarla çalışıyor |
| Graph'ın rakiplere benzemesi | "Git Graph'ın kopyası" algısı | Graph tek başına sunulmaz; haritayla bağı ve PR rozetleri öne çıkar | Uygulandı |
| Büyük repolarda yavaşlık | Panel saniyelerce boş kalır | Cache, sadece yeni commit'leri işlemek, ilerleme göstergesi | Uygulandı; büyük repoda ölçülmedi |
| Treemap'te çok fazla dosya | Kutular okunmaz hâle gelir | Klasöre inme; `node_modules`, `dist` vb. varsayılan hariç | Uygulandı |
| Churn'ün yanlış okunması | Lock dosyaları, üretilen kodlar "en riskli" görünür | Hariç tutma listesi + `ignore` ayarı | Uygulandı |
| Genç repoda renklerin ayırt etmemesi | Kısa aralıkta her dosya aynı renkte | — | İlk geri bildirimle ortaya çıktı; 0.3.0'da renk modu planlandı |
| Repoya yazma işlemleri | Kullanıcının işi kaybolabilir | Modal onay, tek işlem kuyruğu, hook'lar çalışır, git hiç beklemez | Uygulandı, gerçek git'e karşı testli |
| GitHub rate limit | Katman güncellenmez | GraphQL, cache, uyarlanır yenileme aralığı | Uygulandı |
| GitHub dışı remote'lar | GitLab kullanıcıları dışarıda kalır | Provider arayüzü baştan kurulur | Arayüz hazır, GitLab yok |
| Webview performansı | Graph ve animasyonlar takılır | SVG; gerekirse Canvas ve sanal kaydırma | Şimdilik SVG yetiyor |

## Başarı ölçütleri ve sonraki adımlar

MVP başarılı sayılır, eğer gerçek bir repoda (örneğin bir SkyEngineX projesinde) açıldığında ekip üyeleri riskli dosyaları haritadan doğru gösterebiliyorsa.

| Ölçüt | Durum |
| --- | --- |
| Orta boy bir repoda (birkaç bin commit) ilk tarama 10 saniyenin altında, sonraki açılışlar 1 saniyenin altında; graph takılmadan kayar | Ölçülmedi |
| En az 3 kişi eklentiyi bir hafta boyunca kendi repolarında kullanır ve geri bildirim verir | 1 kişiden ilk geri bildirim geldi |
| v3 sonrası: PR çakışma uyarısı en az bir gerçek çakışmayı merge'den önce yakalar | Henüz gerçek bir vaka yok |
| Marketplace'te yayın ve README'de kısa bir demo GIF'i | Yayın tamam (0.1.0); GIF yok |

**İlk kullanıcı geri bildirimi (Ekim 2026)** — 0.3.0'da yalnızca bunlar yapılacak, yeni özellik eklenmeyecek:

1. Paneli bulmak zor: başlangıç turu (walkthrough) ve ilk açılışta bir kez "Haritayı aç" bildirimi.
2. Çoklu klasörlü workspace'te repo değiştirme: repo seçici, açık dosyanın reposunu takip etme.
3. Renk son değişikliğe göre de gösterilebilsin: renk modu (değişim sıklığı / tazelik) ve "commit'e tıkla, dosyalar yansın" ipucu.
4. Merge conflict'te ne olacağı belli olsun: çakışan dosyalar haritada ve listede, "merge editöründe aç / benimkini al / onlarınkini al", çözülen dosya sayacı.
5. Git bisect sekmesi (`git bisect run` hariç).
6. Cherry-pick: graph'tan commit alma, çakışmada devam et / atla / iptal et.

Sonraki adımlar:

- [x] Adın Marketplace'te müsait olduğunu kontrol et (GitAtlas-Rev)
- [x] Panelin tasarımını çiz (`rewiewrev-design/`)
- [x] İskeleti kur, provider arayüzünü tanımla
- [x] `git log --numstat` parser'ını yaz ve bir test reposunda dene
- [x] İlk treemap'i webview'da çiz
- [x] 0.1.0'ı Marketplace'e yükle
- [ ] 0.2.0 güncellemesini Marketplace'e yükle
- [ ] İlk geri bildirimdeki 6 maddeyi yap (0.3.0)
- [ ] README'ye ekran görüntüsü ve demo GIF'i ekle
- [ ] Rakiplerin Marketplace'teki güncel hâlini kontrol et
- [ ] Orta boy bir repoda tarama süresini ölç
- [ ] En az 3 kişiden bir haftalık kullanım geri bildirimi topla
