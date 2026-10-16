#!/usr/bin/env bash
# RewiewRev fixture reposu: geçici klasörde belirlenimci bir git reposu kurar ve
# stdout'a YALNIZCA repo yolunu basar (Windows'ta "C:/..." biçiminde).
#
# Tarihler betiğin çalıştığı andan (NOW) geriye saat cinsinden sabit ofsetlerle verilir.
#
# BEKLENEN SAYILAR
#   Toplam commit ................. 34 (1 merge commit'i dahil; merge 7.5 gün önce)
#   Son 7 gün içindeki commit ..... 6
#   Son 30 gün içindeki commit .... 16 (merge dahil; feature dalındaki 2 commit dahil)
#   Yazarlar ...................... 3: Ayse Yilmaz, Mehmet Demir, Zeynep Kaya
#   Yeniden adlandırma ............ src/model/model.ts -> src/model/repoModel.ts (55 gün önce, git mv)
#     Bu dosyaya toplam değişiklik  8 (tümü) / 3 (30g) / 1 (7g)
#     (adlandırmadan önce 3 değişiklik + adlandırma commit'i + sonra 4 değişiklik)
#   Binary dosya .................. assets/logo.bin (2 commit: oluşturma + 1 değişiklik)
#   Ignore denemesi ............... node_modules/leftpad/index.js, package-lock.json (2'şer commit)
#   Silinen dosya ................. docs/old-notes.md (oluşturulup sonra silinir; lineCounts'ta yok)
#   İzlenen dosya sayısı .......... 16 (binary ve .mailmap dahil; lineCounts'ta 15)
#   .mailmap ...................... ilk commit'te; Zeynep'in 3 commit'i (85g, 70g, 20g) eski e-postayla
#                                   "Zeynep K. <zkaya@eski.example.com>" atılır, %aN/%aE ile Zeynep Kaya'ya birleşir
#                                   (mailmap'siz %an ile 4 yazar adı görünür).
#   (Yukarıdakiler HEAD = lokal main içindir; v2 eklemeleri main'i değiştirmez.)
#
# v2 BEKLENEN DEĞERLER (graph + branch paneli)
#   HEAD .......................... main (upstream origin/main): ahead 2, behind 0
#   Lokal branch'ler (4) .......... main, feature/graph, fix/parser, spike/canvas
#     feature/graph ............... 3 commit (4g, 2.5g, 18sa önce); main'e göre ahead 3, behind 5
#     fix/parser .................. 2 commit (20g, 18g önce); main'e göre ahead 2, behind 17
#     spike/canvas (bayat) ........ 2 commit (62g, 50g önce); main'e göre ahead 2, behind 25
#   Remote branch'ler (2) ......... origin/main (= main~2; main'e göre behind 2),
#                                   origin/experiment/canvas (yalnızca remote; 47g, 44g önce;
#                                   lokal karşılığı yok → main'e göre ahead 2, behind 22)
#   Etiket ........................ v0.1.0 (annotated) → "feat: repoModel d" (28 gün önce)
#   Graph'taki toplam commit ...... 43 (main 34 + 3 + 2 + 2 + 2); merge commit 1
#   origin bare reposu ............ <repo>/.git/fixture-origin.git
set -euo pipefail

NOW=$(date +%s)
REPO=$(mktemp -d "${TMPDIR:-/tmp}/rewiewrev-fixture.XXXXXX")
cd "$REPO"

git init -q -b main
git config core.autocrlf false
git config core.safecrlf false
git config commit.gpgsign false
git config user.name "Fixture"
git config user.email "fixture@example.com"

author() {
  case "$1" in
    A) export GIT_AUTHOR_NAME="Ayse Yilmaz" GIT_AUTHOR_EMAIL="ayse@example.com" ;;
    B) export GIT_AUTHOR_NAME="Mehmet Demir" GIT_AUTHOR_EMAIL="mehmet@example.com" ;;
    C) export GIT_AUTHOR_NAME="Zeynep Kaya" GIT_AUTHOR_EMAIL="zeynep@example.com" ;;
    # Zeynep'in eski e-postası; .mailmap bunu "Zeynep Kaya <zeynep@example.com>" ile birleştirir.
    Z) export GIT_AUTHOR_NAME="Zeynep K." GIT_AUTHOR_EMAIL="zkaya@eski.example.com" ;;
  esac
  export GIT_COMMITTER_NAME="$GIT_AUTHOR_NAME" GIT_COMMITTER_EMAIL="$GIT_AUTHOR_EMAIL"
}

at() {
  local ts=$((NOW - $1 * 3600))
  export GIT_AUTHOR_DATE="@$ts +0300" GIT_COMMITTER_DATE="@$ts +0300"
}

# commit <yazar> <kaç saat önce> <mesaj>
commit() {
  author "$1"
  at "$2"
  git add -A
  git commit -q -m "$3"
}

# line <dosya> <metin>: dosyaya satır ekler (gerekirse klasörü açar)
line() {
  mkdir -p "$(dirname "$1")"
  printf '%s\n' "$2" >>"$1"
}

D=24 # saat/gün

# --- 90..31 gün önce -------------------------------------------------------
line README.md "# Fixture"
line README.md "RewiewRev deneme reposu."
line src/extension.ts "export function activate() {}"
line package.json '{ "name": "fixture" }'
line .mailmap "Zeynep Kaya <zeynep@example.com> <zkaya@eski.example.com>"
commit A $((90 * D)) "chore: ilk commit"

line src/git/runner.ts "export const runner = 1;"
line src/git/runner.ts "export const other = 2;"
commit B $((88 * D)) "feat: git runner"

line src/model/model.ts "export interface Model {}"
line src/model/model.ts "export const empty = {};"
line src/model/model.ts "export const version = 1;"
commit Z $((85 * D)) "feat: model"

line docs/guide.md "# Rehber"
line docs/old-notes.md "eski notlar"
commit A $((82 * D)) "docs: rehber"

line package-lock.json '{ "lockfileVersion": 3 }'
line node_modules/leftpad/index.js "module.exports = (s) => s;"
commit B $((80 * D)) "chore: bağımlılıklar"

line src/webview/main.ts "console.log('main');"
commit C $((78 * D)) "feat: webview"

line src/git/runner.ts "export const third = 3;"
commit A $((75 * D)) "fix: runner"

mkdir -p assets
printf 'BIN\000\001\002v1' >assets/logo.bin
commit B $((72 * D)) "feat: logo"

line test/model.test.ts "test('model', () => {});"
commit Z $((70 * D)) "test: model"
FORK_SPIKE=$(git rev-parse HEAD)

line src/model/model.ts "export const a = 'a';"
commit A $((68 * D)) "feat: model a"

line src/webview/style.css "body { margin: 0; }"
commit B $((65 * D)) "feat: stil"

line src/model/model.ts "export const b = 'b';"
commit C $((60 * D)) "feat: model b"
FORK_EXPERIMENT=$(git rev-parse HEAD)

git mv src/model/model.ts src/model/repoModel.ts
commit A $((55 * D)) "refactor: model.ts -> repoModel.ts"

line src/model/repoModel.ts "export const c = 'c';"
commit B $((50 * D)) "feat: repoModel c"

printf 'BIN\000\001\002v2' >assets/logo.bin
commit C $((45 * D)) "chore: logo güncellendi"

line docs/guide.md "Ek bölüm."
git rm -q docs/old-notes.md
commit A $((42 * D)) "docs: rehber güncellendi, eski notlar silindi"

line src/git/log.ts "export const log = [];"
commit B $((40 * D)) "feat: log"
FORK_FIX=$(git rev-parse HEAD)

line package-lock.json '{ "lockfileVersion": 3, "packages": {} }'
line node_modules/leftpad/index.js "// v2"
commit C $((35 * D)) "chore: bağımlılık güncellemesi"

# --- 30..8 gün önce --------------------------------------------------------
line src/model/repoModel.ts "export const d = 'd';"
commit A $((28 * D)) "feat: repoModel d"
TAG_TARGET=$(git rev-parse HEAD)

line src/webview/main.ts "console.log('ikinci');"
commit B $((25 * D)) "feat: webview düzen"

line test/model.test.ts "test('ikinci', () => {});"
commit Z $((20 * D)) "test: ikinci"

line src/git/log.ts "export const parse = () => [];"
commit A $((15 * D)) "feat: log parse"

line docs/api.md "# API"
commit B $((12 * D)) "docs: api"

line src/extension.ts "export function deactivate() {}"
commit C $((10 * D)) "feat: deactivate"

# feature dalı + merge
git checkout -q -b feature
line src/webview/treemap.ts "export function draw() {}"
commit B $((9 * D)) "feat: treemap"
line src/webview/treemap.ts "export function layout() {}"
commit B $((8 * D + 12)) "feat: treemap layout"
git checkout -q main

line src/model/repoModel.ts "export const e = 'e';"
commit A $((8 * D)) "feat: repoModel e"

author A
at $((7 * D + 12))
git merge -q --no-ff --no-edit -m "Merge branch 'feature'" feature >/dev/null
git branch -q -d feature

# --- son 7 gün ------------------------------------------------------------
line src/webview/main.ts "console.log('üçüncü');"
commit C $((6 * D)) "feat: webview üçüncü"
FORK_GRAPH=$(git rev-parse HEAD)

line src/model/repoModel.ts "export const f = 'f';"
commit A $((5 * D)) "feat: repoModel f"

line src/git/runner.ts "export const fourth = 4;"
commit B $((3 * D)) "fix: runner dört"

line README.md "Güncel."
commit C $((2 * D)) "docs: readme"

line src/extension.ts "// son"
commit A $((1 * D)) "chore: extension"

line test/model.test.ts "test('üçüncü', () => {});"
commit B 12 "test: üçüncü"

# --- v2: branch'ler, etiket ve origin (main geçmişi yukarıda biter, değişmez) ---

# Annotated etiket (tagger tarihi = GIT_COMMITTER_DATE)
author A
at $((28 * D))
git tag -a v0.1.0 -m "v0.1.0" "$TAG_TARGET"

# Son 7 günde 3 commit'li, merge edilmemiş branch
git checkout -q -b feature/graph "$FORK_GRAPH"
line src/webview/graph.ts "export function drawGraph() {}"
commit B $((4 * D)) "feat: graph iskeleti"
line src/webview/graph.ts "export const lanes = [];"
commit C $((2 * D + 12)) "feat: graph şeritleri"
line src/webview/graph.ts "export const edges = [];"
commit B 18 "feat: graph kenarları"

# main'in ortasından ayrılan, 2 commit'li branch
git checkout -q -b fix/parser "$FORK_FIX"
line src/git/log.ts "export const fixed = true;"
commit C $((20 * D)) "fix: parser boş satır"
line src/git/log.ts "export const fixed2 = true;"
commit C $((18 * D)) "fix: parser rename"

# Bayat branch: son commit'i 50 gün önce
git checkout -q -b spike/canvas "$FORK_SPIKE"
line src/webview/canvas.ts "export const canvas = 1;"
commit A $((62 * D)) "spike: canvas denemesi"
line src/webview/canvas.ts "export const canvas2 = 2;"
commit A $((50 * D)) "spike: canvas ikinci deneme"

# Yalnızca origin'de bulunacak branch (lokalde silinir)
git checkout -q -b experiment/canvas "$FORK_EXPERIMENT"
line docs/canvas.md "# Canvas deneyi"
commit B $((47 * D)) "docs: canvas deneyi"
line docs/canvas.md "Sonuç: SVG yeterli."
commit B $((44 * D)) "docs: canvas sonucu"

git checkout -q main

# Bare origin, repo'nun .git klasörü içinde (repo silinince o da silinir).
ORIGIN="$REPO/.git/fixture-origin.git"
git init -q --bare "$ORIGIN"
git remote add origin "$ORIGIN"
git push -q origin "main~2:refs/heads/main" 2>/dev/null
git push -q origin "experiment/canvas:refs/heads/experiment/canvas" 2>/dev/null
git branch -q -D experiment/canvas
git fetch -q origin 2>/dev/null
git branch -q --set-upstream-to=origin/main main

if command -v cygpath >/dev/null 2>&1; then
  cygpath -m "$REPO"
else
  printf '%s\n' "$REPO"
fi
