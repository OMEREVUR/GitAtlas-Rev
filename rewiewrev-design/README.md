# RewiewRev — tasarım referansı

Bu klasör, RewiewRev VS Code eklentisinin arayüz tasarımlarıdır. Kodlayan kişi ya da agent, eklentinin webview arayüzünü bu ekranlara bakarak kurar.

**Önizleme:** `index.html` dosyasını tarayıcıda aç. Sunucu gerekmez. Tema için adrese `?theme=light` ya da `?theme=hc` ekle.

## Dosyalar

| Dosya | Sürüm | Ekran |
| --- | --- | --- |
| `Main.dc.html` | v1 | Ana panel: Explorer rozetleri, treemap, zaman filtresi, dosya kartı, durum çubuğu |
| `Drill.dc.html` | v1 | Bir klasörün içine inilmiş harita (`src › git`) ve kutu üstü tooltip |
| `States.dc.html` | v1 | İlk tarama, git reposu değil, commit yok, git bulunamadı |
| `Badges.dc.html` | v1 | Explorer rozeti kuralları (`FileDecorationProvider`) |
| `Settings.dc.html` | v1 | `contributes.configuration` ile gelecek ayarlar |
| `Graph.dc.html` | v2 | Commit graph, branch paneli, seçimin dokunduğu dosyaları gösteren mini harita |
| `GitHub.dc.html` | v3 | GitHub'a bağlanma, oturum düştü, GitHub dışı remote, istek limiti |
| `TimeMachine.dc.html` | v4 | Zaman kaydırıcısıyla geçmiş harita |
| `Contributors.dc.html` | v4 | Modül sahipliği, haftalık ritim, dosya uzmanı |
| `Tokens.dc.html` | — | Renk kuralları: hangi parça hangi `--vscode-*` değişkeni |
| `Light/HighContrast/GraphLight/GraphHC.dc.html` | — | Aynı ekranların diğer temalarda hâli (önizleme kolaylığı) |
| `canvas.json` | — | Tasarım tuvalindeki yerleşim; kodlamada gerekmez |
| `support.js` | — | Sadece önizleme çalıştırıcısı. **Eklentiye taşınmaz.** |

## Dosya biçimi

Her `.dc.html` normal HTML'dir:

- Görünüm `<x-dc>` içindeki işaretlemededir. Stiller inline yazılmıştır; ölçüler, boşluklar ve yazı boyutları buradan okunur.
- `{{ ad }}` bir değerdir. `<sc-for list as>` tekrar, `<sc-if value>` koşuldur.
- Veri ve davranış en alttaki `<script type="text/x-dc">` içinde, `renderVals()` fonksiyonundadır. Buradaki dosya adları, commit'ler, yazarlar (@deniz, @mert, @ayse) ve sayılar **örnek veridir**. Gerçek veri `RepoModel`'den gelecek.

## Uygulama kuralları

1. **Sabit renk yok.** Her renk bir VS Code tema değişkeni: `var(--vscode-editor-background)`, `var(--vscode-foreground)`, `var(--vscode-focusBorder)` vb. Webview içinde VS Code bu değişkenleri kendisi verir. Tasarım dosyalarındaki `THEMES` / `rrTheme()` haritası sadece önizleme içindir; eklentiye **kopyalanmaz**.
2. **Türetilmiş değişkenler (`--rr-*`)** eklentinin kendi CSS'inde tanımlanır:
   - Churn skalası: `--rr-c1 … --rr-c5 = color-mix(in srgb, var(--vscode-charts-orange) X%, var(--vscode-editor-background))`. Oranlar: 14, 30, 46, 78, 96.
   - `--rr-onhot`: ısı 4–5 kutulardaki yazı rengi. Koyu temada `--vscode-editor-background`, açık temada `--vscode-editor-foreground`, yüksek kontrastta `#000`.
   - `--rr-box-border`: kutular arası çizgi. Normalde `--vscode-editor-background`, yüksek kontrastta `--vscode-contrastBorder`.
   - Tema türü `body.vscode-dark`, `body.vscode-light`, `body.vscode-high-contrast` sınıflarından okunur.
3. **Her bilgi tek görsel kanalda:**
   - kutu boyutu = satır sayısı
   - dolgu rengi = churn
   - kesik mor çerçeve (`--vscode-charts-purple`) = aynı dosyada 2+ açık PR
   - düz mavi iç çerçeve (`--vscode-focusBorder`) = seçim
   - nokta = CI (yeşil geçti / kırmızı başarısız, yanında her zaman metin)
4. **Graph şerit renkleri** `--vscode-scmGraph-foreground1…5` değişkenlerinden gelir. Merge commit'i içi boş nokta olarak çizilir.
5. **İkonlar:** tasarımlardaki inline SVG'ler yer tutucudur. Eklentide `@vscode/codicons` kullanılır (`git-branch`, `git-pull-request`, `refresh`, `close`, `search`, `warning`, `info`, `history`, `organization`).
6. **Yazı:** `var(--vscode-font-family)` ve `var(--vscode-font-size)`; kod için `var(--vscode-editor-font-family)`.
7. **Ölçüler:** VS Code yoğunluğu korunur. Liste satırı 22px, buton 28px, sekme 35px, durum çubuğu 22px.
8. **Erişilebilirlik:** Tıklanan her şey gerçek `<button>` ya da `<a>`. Treemap kutularında `aria-label` (ad, satır, commit, PR). Seçimler `aria-pressed` ile işaretlenir. Renk tek başına bilgi taşımaz.
9. **Treemap yerleşimi:** tasarımdaki yüzdeler elle verilmiştir. Gerçekte `d3-hierarchy` ile `treemapSquarify` hesaplanır. Klasör başlığı 20px'tir. Kutu yeterince büyükse "satır · commit" ikinci satırda görünür.
10. **GitHub izin diyaloğu** VS Code'a aittir (`vscode.authentication.getSession`). Tasarımdaki hâli sadece akışı göstermek içindir; ayrıca çizilmez.

## Önerilen sıra

v1'den başla: `Main` → `Drill` → `States` → `Badges` → `Settings`. Graph (v2) ve GitHub katmanı (v3), `RepoModel` hazır olduktan sonra gelir.
