# GitAtlas-Rev — Proje Tanıtımı

GitAtlas-Rev, bir git reposunu **tek bakışta okunur hâle getiren** bir VS Code eklentisi. Reponu bir harita olarak çizer, geçmişini gösterir ve git işlemlerini komut yazmadan, butonlarla yapmanı sağlar.

- **Marketplace ID:** `Omer-Cayir.gitatlas-rev`
- **Sürüm:** 0.2.0 (Türkçe + İngilizce arayüz)
- **Gereken:** VS Code 1.90+, bilgisayarda kurulu `git`

---

## Hangi sorunu çözüyor?

Yeni bir projeye girdiğinde ya da büyük bir repoda çalışırken şu sorular hep sorulur:

- Bu projede hangi dosyalar büyük, hangileri sürekli değişiyor?
- Son bir haftada ne oldu, kim neye dokundu?
- Benim değiştirdiğim dosyaya başka açık PR'lar da dokunuyor mu? (çakışma riski)
- Bu modülü en iyi kim biliyor?
- Commit/push/pull yaparken terminalde komut ezberlemem gerekiyor mu?

GitAtlas-Rev bunların hepsini VS Code'un yan panelinden, görsel olarak cevaplar.

---

## Ne yapıyor? (sekme sekme)

### 1. Harita
Repo bir **treemap** olarak çizilir:
- Her kutu bir dosya; **kutunun boyutu = satır sayısı**.
- **Kutunun rengi = ne sık değiştiği** (seçili zaman aralığında kaç commit'te değiştiği). Koyu turuncu, sık değişen dosya demek.
- Klasörlere tıklayıp içine inilir; zaman aralığı 7 gün / 30 gün / tümü.
- Bir dosyaya tıklayınca **dosya kartı** açılır: satır sayısı, commit sayısı, yazarlar, son commit'ler ve her commit için diff.
- Yandaki **son commit'ler** akışında bir commit seçilince o commit'in dokunduğu dosyalar haritada yanar.
- VS Code'un dosya gezgininde (Explorer) sık değişen dosyaların yanında **●● / ●** rozeti görünür.

### 2. Graph
- Commit geçmişi renkli şeritler hâlinde: branch'ler, merge'ler, etiketler.
- Branch, yazar, tarih ve metin (mesaj, dosya adı, hash) ile filtreleme.
- Bir commit ya da branch seçince değişen dosyalar listelenir ve haritada gösterilir.
- Yan çubukta **Branch'ler** paneli: lokal/remote branch'ler, ileride/geride commit sayısı, 30 günden uzun süredir dokunulmayan "bayat" branch'ler.

### 3. Zaman (zaman makinesi)
- Kaydırıcıyla ya da ▶ oynat düğmesiyle reponun **geçmiş bir tarihteki hâlini** görürsün.
- Isı, o tarihten önceki 7 günün değişimini gösterir; o tarihte henüz var olmayan dosyalar kesik çerçeveli çizilir.
- Dönüm noktaları (ilk commit, etiketler/sürümler) ve commit yoğunluğu grafiği.

### 4. Katkı
- **Modül sahipliği:** her klasörü kimin ne oranda yazdığı. Bir modülün %80'den fazlası tek kişideyse **"tek kişiye bağlı"** uyarısı.
- **Haftalık ritim:** hangi gün, hangi hafta ne kadar commit atılmış.
- **"Bu dosyayı en iyi kim bilir?"** listesi ve yazar kartları.
- Aynı kişinin farklı e-postaları `.mailmap` ile birleştirilir.

### 5. Değişiklikler (git komutu yazmadan)
- Değişen dosyalar onay kutularıyla listelenir: **tek tek ya da hepsini seçip** commit'e ekle/çıkar, diff'e bak, değişikliği geri al.
- **Commit kutusu:** tür seçici (feat, fix, docs…), özet uzunluğu sayacı, "Commit ve gönder", son commit'e ekleme (amend), son commit'i geri alma. Çalışacak git komutu altında gösterilir.
- **Saklananlar (stash):** sakla, uygula, sil.
- Çakışma (conflict) olduğunda: **Çözüldü / Devam et / İptal et** düğmeleri.

### Her sekmede: eşitleme çubuğu
- **Getir (fetch), Çek (pull), Gönder (push)**; yeni branch'te "Yayınla".
- Pull önce güvenli yolu (fast-forward) dener, olmazsa merge mi rebase mi diye sorar.
- Branch adına tıklayıp branch değiştirme ya da **yeni branch** oluşturma.
- Branch'ler panelinde sağ tık: geç, birleştir, yeniden adlandır, sil.

---

## GitHub katmanı

GitHub hesabını bağlayınca (token gerekmez, VS Code'un kendi GitHub girişi kullanılır):

- **PR çakışma uyarısı:** aynı dosyaya 2 veya daha fazla açık PR dokunuyorsa o dosyanın kutusu haritada **mor kesikli çerçeveyle** işaretlenir. Merge'den önce çakışma riskini görürsün.
- PR ve CI (test) durumu graph'ta ve Branch'ler panelinde görünür.
- **Pull request işlemleri** (Değişiklikler sekmesinde):
  - Bu branch'ten PR açma (gerekirse önce push eder)
  - PR'ı birleştirme (merge / squash / rebase, uzak branch'i silme seçeneğiyle)
  - Review ve check durumlarını görme
  - "Benim PR'larım" ve "Review bekleyenler" listeleri
  - Bir PR'ın branch'ine tek tıkla geçme

---

## Güvenlik ve gizlilik

- Eklentinin **kendi sunucusu yok**; hiçbir veri dışarı gönderilmez.
- Git verisi yalnızca senin bilgisayarında, yerel `git` ile okunur. Sonuçlar yerelde önbelleğe alınır.
- GitHub istekleri doğrudan `api.github.com`'a gider; token eklenti tarafından saklanmaz ve loglanmaz.
- Riskli her işlem **önce onay ister**: değişikliği geri alma, branch silme, zorla gönderme, gönderilmiş commit'i değiştirme, stash silme, PR birleştirme.
- Aynı anda yalnızca bir git işlemi çalışır. Git hiçbir zaman terminalde şifre ya da editör beklemez. Pre-commit hook'ların çalışmaya devam eder.
- Çalışan bütün git komutları ve çıktıları "GitAtlas-Rev Git" çıktı kanalında görünür.

---

## Dil desteği

- Arayüz **Türkçe** ve **İngilizce**.
- Varsayılan olarak VS Code'un diline uyar (VS Code Türkçeyse Türkçe, değilse İngilizce).
- Ayarlardan `GitAtlas-Rev › Language` ile elle seçilebilir (auto / en / tr).

---

## Ayarlar

| Ayar | Ne işe yarar |
| --- | --- |
| `language` | Arayüz dili (auto / en / tr) |
| `ignore` | Haritadan hariç tutulacak dosya desenleri (`node_modules`, `dist` vb. zaten hariç) |
| `defaultRange` | Panel açıldığında seçili zaman aralığı (7 gün / 30 gün / tümü) |
| `graph.initialCommits` | Graph'ta ilk yüklenecek commit sayısı |
| `explorer.badges` | Dosya gezginindeki rozetler (sıcaklar / hepsi / kapalı) |
| `github.enabled` | GitHub katmanını aç/kapat |
| `github.refreshInterval` | GitHub verisinin yenilenme aralığı (dakika) |
| `git.pullStrategy` | Pull fast-forward olmazsa: sor / merge / rebase |
| `git.path` | Kullanılacak git programının yolu |

(Hepsi `gitatlas-revrev.` önekiyle başlar.)

---

## Teknik özet

- **Dil:** TypeScript (strict)
- **Paketleme:** esbuild; iki parça: eklenti (Node) ve webview (tarayıcı)
- **Arayüz:** React gibi bir kütüphane yok; düz TypeScript + DOM. Treemap için `d3-hierarchy`, çizimler SVG.
- **Görünüm:** Renkler yalnızca VS Code tema değişkenlerinden gelir. Açık, koyu ve yüksek kontrast temalarda okunur.
- **Git erişimi:** Doğrudan `git` komutları; ek git kütüphanesi kullanılmıyor.
- **GitHub erişimi:** GraphQL (veri okuma) + REST (PR açma/birleştirme)
- **Testler:** vitest ile 377 birim testi; git işlemleri gerçek git repolarına karşı test edilir.

---

## Sürüm geçmişi

| Sürüm | Ne geldi |
| --- | --- |
| v1 | Harita, dosya kartı, commit akışı, Explorer rozetleri |
| v2 | Commit graph, Branch'ler paneli |
| v3 | GitHub katmanı: PR çakışma uyarısı, CI rozetleri |
| v4 | Zaman makinesi, katkı paneli |
| v5 | Değişiklikler sekmesi: komutsuz add/commit/push/pull, stash, branch işlemleri, pull request'ler |
| 0.1.0 | İlk Marketplace sürümü (Türkçe) |
| 0.2.0 | İngilizce arayüz, dil ayarı |
