#!/usr/bin/env bash
#
# Fail if the committed clients no longer match openapi/chat-api.yaml.
#
#   clients/scripts/check-drift.sh          fast: hashes only, no toolchain
#   clients/scripts/check-drift.sh --full   re-runs both generators and diffs
#
# Two modes because they catch different things and cost different amounts.
#
# Fast mode needs nothing but a shell and shasum. It catches the two mistakes
# that actually happen: someone edits the spec and forgets to regenerate, and
# someone hand-patches a generated file instead of fixing the spec. It cannot
# catch someone editing generated.lock to match their edit.
#
# Full mode regenerates into a temp directory and compares byte-for-byte. It
# catches everything fast mode does plus that case, and it is the only mode
# that proves the committed tree is really what the pinned generators emit.
# It needs Go and Python (no Java, no Docker) and takes about a minute.
#
# Run full mode in CI whenever openapi/ or clients/ changed.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
clients_dir="$(dirname "$here")"
repo_root="$(dirname "$clients_dir")"
lock="$clients_dir/generated.lock"

# shellcheck source=lib.sh
source "$here/lib.sh"
# shellcheck source=versions.env
source "$here/versions.env"

fail() {
  echo
  echo "  $*" >&2
  echo
  echo "  Fix: edit openapi/chat-api.yaml if the API changed, then run" >&2
  echo "       clients/scripts/generate.sh and commit the result." >&2
  echo "       Never hand-edit generated code -- it is overwritten." >&2
  exit 1
}

[[ -f "$lock" ]] || fail "clients/generated.lock is missing."

# lock_value <kind> <name-or-path> -> the digest/version recorded for it
lock_value() {
  awk -v kind="$1" -v name="$2" -F'\t' \
    '$1 == kind && $NF == name { print $2; found = 1 } END { exit !found }' \
    "$lock"
}

echo "== fast check (hashes)"

spec_now="$(sha256_file "$repo_root/openapi/chat-api.yaml")"
spec_locked="$(lock_value spec openapi/chat-api.yaml)" \
  || fail "generated.lock records no spec digest."
[[ "$spec_now" == "$spec_locked" ]] || fail \
  "openapi/chat-api.yaml has changed since the clients were generated."

for pair in "ogen:$OGEN_VERSION" \
            "openapi-python-client:$OPENAPI_PYTHON_CLIENT_VERSION" \
            "ruff:$RUFF_VERSION"; do
  name="${pair%%:*}"
  want="${pair#*:}"
  got="$(lock_value generator "$name")" || got="(absent)"
  [[ "$got" == "$want" ]] || fail \
    "versions.env pins $name $want but generated.lock records $got."
done

for tree in go/chatapi python/dhaam_ccrm_chat; do
  [[ -d "$clients_dir/$tree" ]] || fail "clients/$tree is missing."
  now="$(tree_sha256 "$clients_dir" "$tree")"
  locked="$(lock_value tree "$tree")" \
    || fail "generated.lock records no digest for clients/$tree."
  [[ "$now" == "$locked" ]] || fail \
    "clients/$tree does not match generated.lock -- generated code was edited."
done

echo "   ok - spec, generator pins and both generated trees match generated.lock"

if [[ "${1:-}" != "--full" ]]; then
  echo "== full check skipped (pass --full to regenerate and diff)"
  exit 0
fi

echo "== full check (regenerate and diff)"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

"$here/generate.sh" --into "$tmp" >"$tmp/.generate.log" 2>&1 || {
  cat "$tmp/.generate.log" >&2
  fail "regeneration failed. The spec may use something the generators reject."
}

# Same exclusions as tree_sha256's prune list in lib.sh: running the tests
# leaves __pycache__ inside the generated package, and a freshly generated
# comparison tree never has one.
excludes=(-x '__pycache__' -x '*.py[cod]' -x '.ruff_cache' -x '.pytest_cache' -x '.DS_Store')

status=0
for tree in go/chatapi python/dhaam_ccrm_chat; do
  if ! diff -ru "${excludes[@]}" "$clients_dir/$tree" "$tmp/$tree" > "$tmp/.diff.$$" 2>&1; then
    echo
    echo "--- clients/$tree differs from what the pinned generators emit:" >&2
    head -100 "$tmp/.diff.$$" >&2
    status=1
  fi
done
[[ "$status" -eq 0 ]] || fail "committed clients are not what the generators emit."

echo "   ok - both clients are byte-identical to a fresh generation"
