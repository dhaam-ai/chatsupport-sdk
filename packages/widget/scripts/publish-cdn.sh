#!/usr/bin/env bash
#
# Publishes dist/{widget,form,form-embed}.js to the CDN for one environment.
#
#   ./scripts/publish-cdn.sh dev
#   ./scripts/publish-cdn.sh staging
#   ./scripts/publish-cdn.sh prod
#
# ── The layout, and why ──────────────────────────────────────────────────────
#
# Each build is uploaded TWICE:
#
#   /v<version>/form.js      immutable, cached a year, never overwritten
#   /form.js                 the alias every existing embed points at, cached
#                            5 minutes and invalidated on every publish
#
# The versioned copy is what makes a rollback a one-line alias change instead of
# a rebuild, and it is safe to cache forever because that path's bytes never
# change. The alias exists because `FORM_SDK_URL_DEFAULT` in the console
# (`chatsupport_react/app/lib/hosted-form/hosted-form.ts`) and every snippet a
# merchant has already pasted name the unversioned path.
#
# ⚠ form.js and form-embed.js MUST land in the SAME directory. The console does
# not store the embed URL; it DERIVES it by swapping the filename in the script
# URL -- `formEmbedScriptUrl()` in `app/lib/settings/webform-install.ts`. A
# prefix is preserved by that function (`.../v0.1.0/form.js` ->
# `.../v0.1.0/form-embed.js`), so versioned directories work; splitting the two
# files across prefixes does not.
#
# ── Cache headers are the whole game ─────────────────────────────────────────
# Getting these wrong is the failure mode that looks like "the deploy did not
# take": CloudFront happily serves a year-old form.js from an edge POP while the
# bucket holds the new one. The alias therefore gets a SHORT max-age *and* an
# explicit invalidation; the versioned path gets neither because it never moves.
#
set -euo pipefail

ENVIRONMENT="${1:-}"
case "$ENVIRONMENT" in
  dev|staging|prod) ;;
  *) echo "usage: $0 <dev|staging|prod>" >&2; exit 2 ;;
esac

# Per-environment targets. Fill these in once; they are the only thing that
# differs between the three environments.
#
# Discover the ids you already have with:
#   aws cloudfront list-distributions \
#     --query "DistributionList.Items[].{id:Id,domain:DomainName,aliases:Aliases.Items,origin:Origins.Items[0].DomainName}" \
#     --output table
case "$ENVIRONMENT" in
  dev) BUCKET="${CDN_BUCKET:-nexus-dhaam}"; DISTRIBUTION="${CDN_DISTRIBUTION:-E2IPZVBF2VJMP}" ;;
  staging) BUCKET="${CDN_BUCKET:-nexus-dhaam}"; DISTRIBUTION="${CDN_DISTRIBUTION:-E2IPZVBF2VJMP}" ;;
  prod) BUCKET="${CDN_BUCKET:-nexus-dhaam}"; DISTRIBUTION="${CDN_DISTRIBUTION:-E2IPZVBF2VJMP}" ;;
esac

if [ -z "$DISTRIBUTION" ]; then
  echo "error: set CDN_DISTRIBUTION (CloudFront distribution id) for $ENVIRONMENT" >&2
  echo "       or hard-code it in the case block above once it is created." >&2
  exit 2
fi

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$HERE"

VERSION="$(node -p "require('./package.json').version")"
FILES=(widget.js form.js form-embed.js)

# ── 1. Build from a clean tree ───────────────────────────────────────────────
# Never publish dist/ as found. `pnpm build` runs tsup then scripts/bundle.mjs,
# and bundle.mjs sets `process.exitCode = 1` when a gzip budget is blown -- with
# `set -e` that stops the publish, which is the point of the budgets.
echo "==> building @dhaam-ccrm/widget $VERSION"
pnpm build

for f in "${FILES[@]}"; do
  [ -f "dist/$f" ] || { echo "error: dist/$f missing after build" >&2; exit 1; }
done

# ── 2. Upload the immutable versioned copy first ─────────────────────────────
# Before the alias, deliberately: if the upload dies halfway, the alias still
# points at the previous good build rather than at a half-written prefix.
echo "==> s3://$BUCKET/v$VERSION/"
for f in "${FILES[@]}"; do
  aws s3 cp "dist/$f" "s3://$BUCKET/v$VERSION/$f" \
    --content-type "application/javascript; charset=utf-8" \
    --cache-control "public, max-age=31536000, immutable"
done

# ── 3. Move the alias — GUARDED ──────────────────────────────────────────────
# dev, staging and prod currently share ONE bucket and ONE distribution, so
# `/form.js` is a single object that every environment's console and every
# snippet a merchant has already pasted reads. A `dev` publish that moved it
# would be a production deploy wearing a dev argument.
#
# So only prod moves it. dev and staging stop after the immutable /v<version>/
# upload above -- new keys nothing is serving yet, which is enough to test a
# build from the edge without touching what live traffic reads. Point a
# non-prod console at the versioned URL instead:
#
#   NEXT_PUBLIC_FORM_SDK_URL=https://cdn.dhaamai.com/v<version>/form.js
#
# `PUBLISH_ALIAS=1` overrides. Once each environment has its own bucket and
# distribution in the case block above, this guard has nothing left to protect
# and can go.
PUBLISH_ALIAS="${PUBLISH_ALIAS:-$( [ "$ENVIRONMENT" = prod ] && echo 1 || echo 0 )}"

if [ "$PUBLISH_ALIAS" = 1 ]; then
  echo "==> s3://$BUCKET/ (alias)"
  for f in "${FILES[@]}"; do
    aws s3 cp "dist/$f" "s3://$BUCKET/$f" \
      --content-type "application/javascript; charset=utf-8" \
      --cache-control "public, max-age=300"
  done
else
  echo "==> alias NOT moved ($ENVIRONMENT shares a distribution with prod; PUBLISH_ALIAS=1 to override)"
fi

# ── 4. Invalidate ONLY the alias ─────────────────────────────────────────────
# The versioned paths are new keys no edge has ever cached, so invalidating them
# would cost money and buy nothing. A wildcard `/*` would also evict every other
# tenant asset on the distribution.
if [ "$PUBLISH_ALIAS" = 1 ]; then
  echo "==> invalidating alias paths"
  INVALIDATION=$(aws cloudfront create-invalidation \
    --distribution-id "$DISTRIBUTION" \
    --paths /widget.js /form.js /form-embed.js \
    --query 'Invalidation.Id' --output text)
  aws cloudfront wait invalidation-completed \
    --distribution-id "$DISTRIBUTION" --id "$INVALIDATION"
fi

# ── 5. Prove it from the edge, not from the bucket ───────────────────────────
# A bucket listing proves the object exists; it does not prove CloudFront can
# read it. The 403 AccessDenied that this repo's form page surfaced as "We
# couldn't load the contact form" was exactly that gap.
# One hostname, because there is one distribution. `cdn-dev.dhaamai.com` and
# `cdn-staging.dhaamai.com` DO NOT RESOLVE -- deriving them per environment made
# a successful dev upload abort here claiming the objects were unreadable, which
# is a false failure and the worst kind. Override with CDN_HOST once per-
# environment hostnames exist.
HOST="${CDN_HOST:-cdn.dhaamai.com}"
echo "==> verifying https://$HOST"
FAIL=0
for f in "${FILES[@]}"; do
  paths=("/v$VERSION/$f")
  [ "$PUBLISH_ALIAS" = 1 ] && paths+=("/$f")
  for path in "${paths[@]}"; do
    code=$(curl -s -o /dev/null -w '%{http_code}' "https://$HOST$path")
    printf '  %-28s %s\n' "$path" "$code"
    [ "$code" = 200 ] || FAIL=1
  done
done
[ "$FAIL" = 0 ] || { echo "error: not all objects are readable from the edge" >&2; exit 1; }

echo
echo "published $VERSION to $ENVIRONMENT"
echo "  point that environment's console at it with:"
if [ "$PUBLISH_ALIAS" = 1 ]; then
  echo "    NEXT_PUBLIC_FORM_SDK_URL=https://$HOST/form.js"
else
  echo "    NEXT_PUBLIC_FORM_SDK_URL=https://$HOST/v$VERSION/form.js"
fi
