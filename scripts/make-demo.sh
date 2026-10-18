#!/usr/bin/env bash
# GitAtlas-Rev demo reposu: Marketplace/README görselleri için geçici klasörde İngilizce commit'li,
# beş hayali yazarlı, ~60 dosyalı bir "web shop" reposu kurar ve stdout'a YALNIZCA repo yolunu basar.
# Sayılar fixture gibi sabitlenmez; yalnızca görüntü içindir (RANDOM sabit tohumla belirlenimci).
#
# Görseller: npm run preview -- <repo-yolu> --name demo --lang en
set -euo pipefail

NOW=$(date +%s)
REPO=$(mktemp -d "${TMPDIR:-/tmp}/gitatlas-rev-demo.XXXXXX")/web-shop
mkdir "$REPO"
cd "$REPO"
RANDOM=42

git init -q -b main
git config core.autocrlf false
git config core.safecrlf false
git config commit.gpgsign false
git config user.name "Demo"
git config user.email "demo@example.com"

AUTHORS=("Alex Morgan:alex@example.com" "Priya Shah:priya@example.com" "Sam Lee:sam@example.com" "Jordan Diaz:jordan@example.com" "Taylor Kim:taylor@example.com")

author() {
  local a=${AUTHORS[$1]}
  export GIT_AUTHOR_NAME="${a%%:*}" GIT_AUTHOR_EMAIL="${a##*:}"
  export GIT_COMMITTER_NAME="$GIT_AUTHOR_NAME" GIT_COMMITTER_EMAIL="$GIT_AUTHOR_EMAIL"
}

at() {
  local ts=$((NOW - $1 * 3600))
  export GIT_AUTHOR_DATE="@$ts +0000" GIT_COMMITTER_DATE="@$ts +0000"
}

# commit <yazar no> <kaç saat önce> <mesaj>
commit() {
  author "$1"
  at "$2"
  git add -A
  git commit -q -m "$3"
}

# grow <dosya> <satır>: dosyaya satır ekler (gerekirse klasörü açar)
grow() {
  mkdir -p "$(dirname "$1")"
  local i name=${1##*/}
  for ((i = 0; i < $2; i++)); do printf '// %s line %d.%d\n' "$name" "$RANDOM" "$i"; done >>"$1"
}

# dosya:başlangıç satırı
FILES=(
  src/app/App.tsx:120 src/app/routes.tsx:90 src/app/main.tsx:30
  src/components/Header.tsx:110 src/components/Footer.tsx:60 src/components/ProductCard.tsx:140
  src/components/ProductGrid.tsx:120 src/components/CartDrawer.tsx:210 src/components/Button.tsx:70
  src/components/Modal.tsx:95 src/components/SearchBar.tsx:130 src/components/Rating.tsx:45
  src/pages/Home.tsx:150 src/pages/Product.tsx:240 src/pages/Checkout.tsx:380 src/pages/Account.tsx:190
  src/pages/Orders.tsx:170 src/pages/NotFound.tsx:25
  src/hooks/useCart.ts:160 src/hooks/useAuth.ts:120 src/hooks/useDebounce.ts:30 src/hooks/useProducts.ts:90
  src/store/cartSlice.ts:180 src/store/userSlice.ts:110 src/store/index.ts:40
  src/api/client.ts:140 src/api/products.ts:80 src/api/orders.ts:95 src/api/payments.ts:150
  src/utils/money.ts:70 src/utils/date.ts:55 src/utils/validation.ts:130 src/utils/analytics.ts:85
  src/styles/theme.css:220 src/styles/global.css:160
  server/index.ts:90 server/routes/products.ts:150 server/routes/orders.ts:210 server/routes/auth.ts:170
  server/routes/payments.ts:260 server/db/schema.sql:180 server/db/migrations.ts:140 server/db/pool.ts:50
  server/services/pricing.ts:190 server/services/inventory.ts:160 server/services/email.ts:110
  test/cart.test.ts:150 test/checkout.test.ts:220 test/pricing.test.ts:130 test/api.test.ts:170
  test/validation.test.ts:90
  docs/architecture.md:120 docs/api.md:200 docs/deploy.md:70
  scripts/seed.ts:110 scripts/release.sh:45
  package.json:60 tsconfig.json:30 README.md:140 CHANGELOG.md:80 .github/workflows/ci.yml:50
)

D=24
# İlk dosyalar klasör gruplarına göre farklı yazarlarca eklenir (sahiplik paneli dengeli görünsün).
# grup: yazar no|saat|mesaj|önekler
SEEDS=(
  "0|$((152 * D))|chore: initial project scaffold|package.json tsconfig.json README.md CHANGELOG.md .github/ scripts/ src/app/"
  "1|$((151 * D))|feat: product pages and components|src/pages/ src/components/ src/styles/"
  "2|$((150 * D))|feat: cart store, hooks and utils|src/hooks/ src/store/ src/utils/ src/api/"
  "4|$((149 * D))|feat: server routes and services|server/index.ts server/routes/ server/services/"
  "3|$((149 * D - 5))|feat(db): schema, pool and migrations|server/db/"
  "2|$((148 * D))|test: unit and api tests|test/"
  "4|$((148 * D - 5))|docs: architecture, api and deploy notes|docs/"
)
for g in "${SEEDS[@]}"; do
  IFS='|' read -r ga gh gm gp <<<"$g"
  for f in "${FILES[@]}"; do
    p=${f%%:*}
    for pre in $gp; do if [[ $p == "$pre"* ]]; then grow "$p" "${f##*:}"; fi; done
  done
  commit "$ga" "$gh" "$gm"
done

# Sıcak noktalar daha sık değişir; server/db çoğunlukla tek kişinin (Jordan) elinde.
HOT=(src/pages/Checkout.tsx src/hooks/useCart.ts src/store/cartSlice.ts server/routes/payments.ts src/components/CartDrawer.tsx server/services/pricing.ts test/checkout.test.ts src/api/payments.ts)
WARM=(src/pages/Product.tsx src/components/ProductCard.tsx src/components/SearchBar.tsx src/api/client.ts server/routes/orders.ts src/utils/validation.ts test/cart.test.ts src/styles/theme.css src/hooks/useAuth.ts CHANGELOG.md)
DB=(server/db/schema.sql server/db/migrations.ts server/db/pool.ts)
TYPES=(feat feat fix fix refactor perf test chore docs)
TOPICS=("checkout flow" "cart totals" "payment retries" "product search" "price rounding" "order history" "session refresh" "inventory sync" "coupon codes" "shipping options" "dark theme" "form validation" "API errors" "image lazy loading" "email receipts" "rate limiting")
VERBS=("add" "handle" "improve" "simplify" "rework" "speed up" "clean up" "support")

# pick <dizi adı>: rastgele bir öğeyi PICK'e yazar (alt kabukta $RANDOM ilerlemediği için $(...) kullanılmaz).
pick() { local -n arr=$1; PICK=${arr[$((RANDOM % ${#arr[@]}))]}; }

h=$((148 * D))
n=0
while ((h > 6)); do
  # Son 30 günde tempo artar.
  if ((h < 30 * D)); then step=$((5 + RANDOM % 14)); else step=$((10 + RANDOM % 30)); fi
  h=$((h - step))
  ((h > 6)) || break
  a=$((RANDOM % 5))
  r=$((RANDOM % 10))
  if ((r < 1)); then
    a=3
    pick DB; grow "$PICK" $((3 + RANDOM % 15))
    pick VERBS; v=$PICK; pick TOPICS
    msg="feat(db): $v $PICK migration"
  else
    k=$((1 + RANDOM % 3))
    for ((j = 0; j < k; j++)); do
      if ((r < 6)); then pick HOT; f=$PICK; elif ((r < 9)); then pick WARM; f=$PICK; else f=${FILES[$((RANDOM % ${#FILES[@]}))]%%:*}; fi
      grow "$f" $((2 + RANDOM % 25))
    done
    pick TYPES; t=$PICK; pick VERBS; v=$PICK; pick TOPICS
    msg="$t: $v $PICK"
  fi
  commit "$a" "$h" "$msg"
  n=$((n + 1))
  if ((n == 40)); then git tag -a v1.0.0 -m "v1.0.0"; fi
done

# Branch'ler: aktif bir özellik dalı, merge edilmiş bir düzeltme, bayat bir deney.
git checkout -q -b fix/cart-rounding main~6
grow src/utils/rounding.ts 32; commit 2 $((9 * D)) "fix: round cart totals per line item"
grow test/rounding.test.ts 40; commit 2 $((8 * D)) "test: cover rounding edge cases"
git checkout -q main
author 1; at $((7 * D)); git merge -q --no-ff fix/cart-rounding -m "Merge branch 'fix/cart-rounding'"

git checkout -q -b feature/one-page-checkout main
grow src/pages/Checkout.tsx 40; commit 1 $((3 * D)) "feat: one-page checkout layout"
grow src/components/CartDrawer.tsx 18; commit 1 $((2 * D)) "feat: inline cart summary"
grow test/checkout.test.ts 25; commit 4 $((1 * D)) "test: one-page checkout happy path"

git checkout -q -b spike/graphql main~45
grow server/graphql/schema.graphql 80; commit 3 $((70 * D)) "chore: graphql schema spike"
grow server/graphql/resolvers.ts 120; commit 3 $((66 * D)) "chore: resolver experiments"
git checkout -q main

ORIGIN="$REPO/.git/demo-origin.git"
git init -q --bare -b main "$ORIGIN"
git remote add origin "$ORIGIN"
git push -q origin "main~1:refs/heads/main" 2>/dev/null
git push -q origin "feature/one-page-checkout" 2>/dev/null
git fetch -q origin 2>/dev/null
git branch -q --set-upstream-to=origin/main main

# Değişiklikler sekmesi ve haritadaki rozet için commit edilmemiş birkaç değişiklik.
grow src/pages/Checkout.tsx 6
grow src/api/payments.ts 4
git add src/api/payments.ts
grow src/components/PromoBanner.tsx 35

if command -v cygpath >/dev/null 2>&1; then
  cygpath -m "$REPO"
else
  printf '%s\n' "$REPO"
fi
