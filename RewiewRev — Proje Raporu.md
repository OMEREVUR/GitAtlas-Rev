# RewiewRev — Proje Raporu

Oct 16, 2026 · @Ömer

## Özet

RewiewRev, VS Code içinde bir repoyu tek ekranda takip etmeyi sağlayan bir eklenti: dosyalar bir ısı haritası (treemap) olarak çizilir, üstüne GitHub verisi katman olarak eklenir. Lokal git "nerede ne değişiyor" sorusunu, GitHub katmanı "şu an kim neye dokunuyor" sorusunu cevaplar.

Commit graph'ı ve branch paneli de eklentinin içinde, ama ayrı bir ekran gibi değil, haritaya bağlı çalışır: graph'ta bir commit ya da branch seçildiğinde dokunduğu dosyalar haritada yanar.

İlk sürüm sadece lokal git ile çalışır. GitHub, graph görünümünden sonra opsiyonel katman olarak gelir ve ilk özelliği **PR çakışma uyarısı** olur: aynı dosyaya dokunan açık PR'ları merge'den önce gösterir. Bu, mevcut eklentilerin hiçbirinin tek ekranda yapmadığı şey.

## Problem ve hedef kullanıcı

Bir repoyu takip etmek bugün dağınık bir iş: geçmiş terminalde ya da commit listesinde, PR'lar GitHub sekmesinde, CI sonucu başka bir sayfada. Hiçbiri "projenin hangi kısmı riskli, hangi değişiklikler çarpışacak" sorusunu bir bakışta cevaplamıyor.

Somut dertler:

- **Riskli dosyaları bilmemek:** Sık değişen dosyalar hata kaynağıdır ama bunu görmek için `git log` çıktısını elle okumak gerekir.
- **Çakışmaları geç fark etmek:** İki kişi aynı dosyaya PR açtığında bu ancak merge sırasında conflict olarak ortaya çıkar.
- **Lokal ve remote arasındaki kopukluk:** Push'lanmamış commit'ler, geride kalan branch'ler, kırmızı CI ayrı ayrı yerlerde görünür.

Hedef kullanıcılar:

1. **Küçük ekipler (2–10 geliştirici):** Aynı repoda paralel çalışan, PR çakışmasını yaşayan ekipler. Asıl değer burada.
2. **Tek başına geliştiriciler:** Kendi projesinin sıcak noktalarını ve geçmişini görmek isteyenler. MVP bu kullanıcıyı tek başına tatmin etmeli.
3. **Projeye yeni katılanlar:** Bir kod tabanını tanımaya çalışan, "nereden başlasam" diyen kişiler.

## Rakipler ve konumlanma

Commit grafiği ve PR listesi alanları dolu; boş olan, git geçmişi ile GitHub durumunu aynı haritada birleştirmek. Bu yüzden commit graph'ı tek başına bir ürün olarak değil, haritaya ve PR katmanına bağlı bir görünüm olarak yapıyoruz.

| Araç | Ne yapıyor | Eksik kaldığı yer |
| --- | --- | --- |
| Git Graph | Branch'leri ve commit'leri ağaç olarak çizer | Sadece geçmiş; risk ya da GitHub durumu yok |
| GitLens | Blame, dosya geçmişi, satır bazlı ısı, commit grafiği | Dosya ve satır odaklı; repo geneline tek bakış yok, bazı özellikler ücretli |
| GitHub Pull Requests | PR ve issue'ları VS Code içinde listeler, review yaptırır | PR'lar liste hâlinde; dosya haritasıyla ve çakışmayla ilişki kurmaz |
| Gource | Repo geçmişini animasyon olarak oynatır | VS Code dışında, sadece izlemelik; etkileşim yok |
| CodeScene | Churn ve karmaşıklığa göre "hotspot" analizi | Ağır, kurumsal bir araç; editörde hafif bir panel değil |

**Konumlanma:** "Repoyu tek bakışta okutan harita." GitLens'in yerine geçmeye çalışmıyoruz, onunla birlikte kurulacak bir eklenti oluyoruz. Fark yaratan üç şey: repo genelini gösteren treemap, haritaya bağlı commit graph'ı ve PR çakışma uyarısı.

Not: Rakip bilgileri genel bilgiye dayanıyor. Yayın öncesi VS Code Marketplace'teki güncel hâlleri kontrol edilmeli.

## Ürün konsepti

Eklentinin merkezinde tek bir görünüm var: repo treemap'i. Her kutu bir dosya; kutunun boyutu satır sayısını, rengi "churn"ü (ne sık değiştiğini) gösterir. Klasörler iç içe kutular olarak durur.

Bu haritanın üstüne iki katman biner:

- **Git katmanı (her zaman açık):** Değişiklik sıklığı, eklenen/silinen satır, son dokunma tarihi, dosyaya dokunan yazarlar. Kaynak lokal repo, internet gerekmez.
- **GitHub katmanı (opsiyonel):** Açık PR'ların dokunduğu dosyalar, aynı dosyada birden fazla PR olması, branch başına CI sonucu, push'lanmamış ve geride kalan commit'ler. Kullanıcı GitHub'a bağlanınca açılır.

Haritanın yanında üç görünüm daha var, üçü de haritayla konuşur:

- **Son commit'ler akışı (v1):** Grafiksiz, sade bir commit listesi. Bir commit'e tıklayınca dokunduğu dosyalar haritada yanar. Graph geldiğinde onun sade modu olarak kalır.
- **Commit graph (v2):** Branch'ler renkli şeritler, merge'ler birleşme noktaları olarak çizilir. Yazar, tarih, dosya ve branch'e göre filtrelenir. Seçilen commit ya da branch'in dokunduğu dosyalar haritada vurgulanır.
- **Branch paneli (v2):** Lokal ve remote branch'ler tek listede. Her satırda son commit, ahead/behind ve son dokunma tarihi var; uzun süredir dokunulmamış branch'ler soluk görünür. GitHub bağlıysa (v3) açık PR ve CI sonucu da aynı satıra eklenir.

Kullanıcı bir kutuya tıkladığında yan tarafta dosyanın kartı açılır: son commit'ler, ona dokunan açık PR'lar, "dosyayı aç" ve "diff'i gör" butonları. Explorer'daki dosya adlarının yanında da küçük bir sıcaklık rozeti görünür; panel kapalıyken bile harita bilgisi kaybolmaz.

## Özellikler

Ürün dört sürümde büyür; her sürüm bir öncekinin verisini kullanır, bu yüzden hiçbiri sıfırdan yazılmaz.

| Sürüm | Özellik | Ne işe yarar | Gerekli veri |
| --- | --- | --- | --- |
| v1 (MVP) | Repo treemap'i | Riskli dosyaları tek bakışta gösterir | `git log --numstat` |
| v1 (MVP) | Zaman filtresi (7 gün / 30 gün / tümü) | Eski ve yeni sıcak noktaları ayırır | Aynı veri, tarihe göre süzülür |
| v1 (MVP) | Dosya kartı | Son 5 commit, dosyayı aç, diff'i gör | `git log -- <dosya>` |
| v1 (MVP) | Son commit'ler akışı | Commit'e tıklayınca dokunduğu dosyalar haritada yanar | `git log --name-only` |
| v1 (MVP) | Explorer rozeti | Panel kapalıyken de sıcaklığı gösterir | Treemap'in cache'i |
| v2 | Commit graph | Branch'leri şerit, merge'leri birleşme noktası olarak çizer; yazar, tarih, dosya filtresi | `git log --all --topo-order --parents` + ref'ler |
| v2 | Branch paneli | Lokal ve remote branch'ler: son commit, ahead/behind, bayat olanlar soluk | `git for-each-ref` + `git rev-list --count` |
| v2 | Graph ↔ harita bağı | Seçilen commit ya da branch'in dokunduğu dosyaları haritada gösterir | v1 ve v2 verisi birlikte |
| v3 | GitHub'a bağlanma | Tek tıkla giriş, token yok | VS Code GitHub oturumu |
| v3 | PR çakışma uyarısı | Aynı dosyaya dokunan açık PR'ları işaretler | Açık PR'lar + değişen dosyaları |
| v3 | PR ve CI rozetleri | Graph'ta ve branch panelinde açık PR'lar ile son Actions sonucu | GitHub PR'ları + check'ler |
| v4 | Zaman makinesi | Kaydırıcıyla repoyu geçmiş bir tarihte görür | v1 verisi, tarih ekseniyle |
| v4 | Katkı paneli | Kim hangi modülü biliyor, ritim nasıl | v1 verisi, yazara göre gruplanır |

v1 ve v2 GitHub olmadan, tamamen lokal git ile çalışır. v3'ün ilk ve en önemli özelliği PR çakışma uyarısı; diğer GitHub özellikleri onun üzerine eklenir.

## Teknik mimari

Eklenti üç katmandan oluşur: veri kaynakları, bunları tek modelde birleştiren çekirdek ve bu modeli okuyan arayüz. Arayüz hiçbir zaman git'e ya da GitHub'a doğrudan gitmez.

&#91;embedded content: mimari · veri soldan sağa akar, RepoModel merkezde\]

Git ve GitHub katmanları veriyi RepoModel'de birleştirir; webview ve Explorer rozeti yalnızca bu modeli okur, cache ise yeniden açılışları hızlandırır.

**Teknoloji seçimleri:**

- **Dil ve iskelet:** TypeScript, `yo code` ile oluşturulan standart eklenti yapısı.
- **Git erişimi:** `child_process` ile doğrudan `git` komutları ya da `simple-git`. VS Code'un yerleşik Git API'si branch ve remote bilgisi için yeterli, ama `--numstat` gibi detaylı geçmiş için komut satırı gerekir.
- **Arayüz:** Webview içinde React ya da düz HTML; treemap için `d3-hierarchy`. Eklenti ile webview `postMessage` üzerinden JSON alışverişi yapar.
- **Cache:** `context.globalStorageUri` altında repo başına bir JSON dosyası; son işlenen commit hash'i saklanır, sonraki açılışta sadece ondan sonrakiler işlenir.

**Graph çizimi.** Commit'ler `git log --all --topo-order --parents` ile alınır. Şerit (lane) yerleşimi eklentide hesaplanır, webview sadece hazır koordinatları çizer. İlk sürümde son 500 commit yüklenir, kaydırdıkça daha eskileri gelir; çizim SVG ile başlar, yavaşlarsa Canvas'a geçer.

**Provider soyutlaması.** GitHub'a özel kod tek bir sınıfta kalır. İleride GitLab eklemek, aynı arayüzü uygulayan yeni bir sınıf yazmak demektir:

```ts
interface RemoteProvider {
  isAvailable(): Promise<boolean>;
  getOpenPullRequests(): Promise<PullRequest[]>;
  getBranchStatus(branch: string): Promise<CiStatus>;
}
```

## GitHub entegrasyonu

GitHub katmanı token istemeden, tek sorguyla ve cache'li çalışacak şekilde tasarlanır.

**Kimlik doğrulama.** VS Code'un yerleşik GitHub girişi kullanılır; kullanıcı ayrı bir token oluşturmaz:

```ts
const session = await vscode.authentication.getSession(
  'github', ['repo'], { createIfNone: true }
);
```

**Repo eşleştirme.** Lokal repodaki `origin` adresinden `owner/repo` çıkarılır. Remote GitHub değilse katman sessizce kapalı kalır, eklenti git katmanıyla çalışmaya devam eder.

**Veri çekme.** GraphQL API kullanılır. Açık PR'lar, her PR'ın değiştirdiği dosyalar, head branch'i ve son check durumu tek sorguda gelir; REST ile aynı veri PR başına ayrı istek ister.

**Rate limit ve tazelik.**

- Sonuçlar `globalStorage` altında repo başına cache'lenir.
- Yenileme sadece panel açıkken yapılır; aralık ayarlanabilir, varsayılan 2 dakika.
- Kullanıcı "Yenile" butonuyla elle de tetikleyebilir.
- Kalan limit düşükse yenileme aralığı otomatik uzar ve panelde küçük bir uyarı görünür.

**Gizlilik.** Veri sadece kullanıcının makinesinde tutulur, eklentinin kendi sunucusu yoktur. Bu, ilk sürümde de README'de açıkça yazılmalı.

## Yol haritası

MVP üç haftada Marketplace'e çıkar; graph görünümü beşinci, GitHub katmanı yedinci haftanın sonunda gelir. Süreler haftada yaklaşık 10–15 saatlik yan proje temposuna göre tahmin.

&#91;embedded content: yol haritası · 5 faz, 4 geçiş kapısı\]

Her faz bir kapıyla biter: kapı geçilmeden sonraki faza başlanmaz. Özellikle ikinci kapı önemli; gerçek kullanıcı geri bildirimi olmadan graph'a ve GitHub katmanına geçmek, kimsenin istemediği bir şeyi büyütme riski taşır.

## Riskler ve önlemler

En büyük risk teknik değil, kapsam: GitHub katmanı ve zaman makinesi MVP'ye sızarsa ilk sürüm hiç çıkmaz.

| Risk | Etki | Önlem |
| --- | --- | --- |
| Kapsamın büyümesi | MVP gecikir, motivasyon düşer | v1 sadece lokal git ve treemap; graph v2'de, GitHub v3'te bekler |
| Graph'ın beklenenden uzun sürmesi | Şerit yerleşimi ve birleşme noktaları zor bir algoritma, v2 uzar | İlk sürümde sadece son 500 commit; açık kaynak bir graph eklentisinin yaklaşımı incelenir |
| Graph'ın rakiplere benzemesi | "Git Graph'ın kopyası" algısı | Graph tek başına sunulmaz; haritayla bağlantısı ve PR rozetleri öne çıkarılır |
| Büyük repolarda yavaşlık | Panel saniyelerce boş kalır | Sonuç cache'lenir, sadece yeni commit'ler işlenir; ilk tarama arka planda ve ilerleme çubuğuyla |
| Treemap'te çok fazla dosya | Kutular okunmaz hâle gelir | Klasör seviyesinde başlayıp tıklayınca içine inmek; `node_modules`, `dist` gibi yolları varsayılan olarak hariç tutmak |
| Churn'ün yanlış okunması | Lock dosyaları, üretilen kodlar "en riskli" görünür | Hariç tutma listesi + kullanıcının ekleyebileceği `ignore` ayarı |
| GitHub rate limit | Katman güncellenmez | GraphQL, cache, uyarlanır yenileme aralığı |
| GitHub dışı remote'lar | GitLab kullanıcıları dışarıda kalır | Provider arayüzü baştan kurulur, GitLab sonradan eklenebilir |
| Webview performansı | Graph ve animasyonlar takılır | v1'de SVG; commit ya da kutu sayısı artarsa Canvas ve sanal kaydırma |

## Başarı ölçütleri ve sonraki adımlar

MVP başarılı sayılır, eğer gerçek bir repoda (örneğin bir SkyEngineX projesinde) açıldığında ekip üyeleri riskli dosyaları haritadan doğru gösterebiliyorsa.

Ölçütler:

- Orta boy bir repoda (birkaç bin commit) ilk tarama 10 saniyenin altında, sonraki açılışlar 1 saniyenin altında; graph aynı repoda takılmadan kayar.
- En az 3 kişi eklentiyi bir hafta boyunca kendi repolarında kullanır ve geri bildirim verir.
- v3 sonrası: PR çakışma uyarısı en az bir gerçek çakışmayı merge'den önce yakalar.
- Marketplace'te yayın ve README'de kısa bir demo GIF'i.

Sonraki adımlar:

- [ ] RewiewRev adının Marketplace'te ve GitHub'da müsait olduğunu kontrol et
- [ ] Panelin mockup'ını çiz (treemap + dosya kartı)
- [ ] `yo code` ile iskeleti kur, provider arayüzünü tanımla
- [ ] `git log --numstat` parser'ını yaz ve bir test reposunda dene
- [ ] İlk treemap'i webview'da çiz
