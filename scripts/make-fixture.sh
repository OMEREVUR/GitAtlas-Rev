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
#   İzlenen dosya sayısı .......... 15 (binary dahil; lineCounts'ta 14)
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
commit A $((90 * D)) "chore: ilk commit"

line src/git/runner.ts "export const runner = 1;"
line src/git/runner.ts "export const other = 2;"
commit B $((88 * D)) "feat: git runner"

line src/model/model.ts "export interface Model {}"
line src/model/model.ts "export const empty = {};"
line src/model/model.ts "export const version = 1;"
commit C $((85 * D)) "feat: model"

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
commit C $((70 * D)) "test: model"

line src/model/model.ts "export const a = 'a';"
commit A $((68 * D)) "feat: model a"

line src/webview/style.css "body { margin: 0; }"
commit B $((65 * D)) "feat: stil"

line src/model/model.ts "export const b = 'b';"
commit C $((60 * D)) "feat: model b"

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

line package-lock.json '{ "lockfileVersion": 3, "packages": {} }'
line node_modules/leftpad/index.js "// v2"
commit C $((35 * D)) "chore: bağımlılık güncellemesi"

# --- 30..8 gün önce --------------------------------------------------------
line src/model/repoModel.ts "export const d = 'd';"
commit A $((28 * D)) "feat: repoModel d"

line src/webview/main.ts "console.log('ikinci');"
commit B $((25 * D)) "feat: webview düzen"

line test/model.test.ts "test('ikinci', () => {});"
commit C $((20 * D)) "test: ikinci"

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

if command -v cygpath >/dev/null 2>&1; then
  cygpath -m "$REPO"
else
  printf '%s\n' "$REPO"
fi
