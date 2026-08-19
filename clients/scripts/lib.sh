# Shared helpers for the clients/ scripts. Source, do not execute.
#
# Deliberately free of Go, Python, jq and node: check-drift.sh's fast mode has
# to run in any CI job, including one that installs nothing.

_sha256() {
  if command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$@"
  elif command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$@"
  else
    echo "error: neither shasum nor sha256sum is available" >&2
    return 1
  fi
}

# sha256_file <path> -> bare hex digest
sha256_file() {
  _sha256 "$1" | awk '{print $1}'
}

# tree_sha256 <root> <dir-relative-to-root> -> bare hex digest
#
# Hashes both the contents and the layout: the digest covers a sorted manifest
# of "<file digest>  <path relative to root>", so adding, deleting or renaming
# a file changes the result even when no file's contents change.
#
# LC_ALL=C keeps the sort byte-ordered, so the digest does not depend on the
# locale of whoever ran it.
tree_sha256() {
  local root="$1" rel="$2"
  # Not `xargs _sha256`: _sha256 is a shell function, and xargs would fail to
  # exec it, hand the digest an empty stream, and produce the same "valid"
  # hash for every tree. That is a gate that can never fail, so the manifest
  # is built in-shell instead.
  ( cd "$root" && find "$rel" -type f ! -name '.DS_Store' -print \
      | LC_ALL=C sort \
      | while IFS= read -r f; do
          printf '%s  %s\n' "$(sha256_file "$f")" "$f"
        done \
      | _sha256 - \
      | awk '{print $1}' )
}
