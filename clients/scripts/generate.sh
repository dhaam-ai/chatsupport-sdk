#!/usr/bin/env bash
#
# Regenerate the Python and Go backend clients from openapi/chat-api.yaml.
#
#   clients/scripts/generate.sh            regenerate + rewrite generated.lock
#   clients/scripts/generate.sh --into DIR generate into DIR instead (drift check)
#
# Prerequisites: Go and Python 3. No Java, no Docker.
#
# The generated trees are committed. See clients/README.md for why, and
# check-drift.sh for what stops them drifting from the spec.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
clients_dir="$(dirname "$here")"
repo_root="$(dirname "$clients_dir")"
spec="$repo_root/openapi/chat-api.yaml"

# shellcheck source=versions.env
source "$here/versions.env"

dest="$clients_dir"
if [[ "${1:-}" == "--into" ]]; then
  dest="${2:?--into needs a directory}"
  mkdir -p "$dest"
fi

[[ -f "$spec" ]] || { echo "error: spec not found at $spec" >&2; exit 1; }

go_pkg_dir="$dest/go/chatapi"
py_pkg_dir="$dest/python/dhaam_ccrm_chat"

# ---------------------------------------------------------------------------
# Python codegen toolchain: a throwaway venv, pinned exactly.
#
# It is cached under clients/.codegen-venv (gitignored) and rebuilt whenever
# versions.env changes, so a stale venv cannot silently produce output that
# does not match the pins.
# ---------------------------------------------------------------------------
venv="$clients_dir/.codegen-venv"
stamp="$venv/.pins"
want_pins="opc=$OPENAPI_PYTHON_CLIENT_VERSION ruff=$RUFF_VERSION"

if [[ ! -f "$stamp" || "$(cat "$stamp")" != "$want_pins" ]]; then
  echo "==> building codegen venv ($want_pins)"
  rm -rf "$venv"
  python3 -m venv "$venv"
  "$venv/bin/pip" install --quiet --disable-pip-version-check \
    "openapi-python-client==$OPENAPI_PYTHON_CLIENT_VERSION" \
    "ruff==$RUFF_VERSION"
  printf '%s' "$want_pins" > "$stamp"
fi

# openapi-python-client finds ruff on PATH, not via its own venv.
export PATH="$venv/bin:$PATH"

installed_ruff="$("$venv/bin/ruff" --version | awk '{print $2}')"
if [[ "$installed_ruff" != "$RUFF_VERSION" ]]; then
  echo "error: ruff $installed_ruff installed, versions.env pins $RUFF_VERSION" >&2
  exit 1
fi

# ---------------------------------------------------------------------------
# Python client.
#
# --meta none emits only the package: no pyproject.toml, no README, no
# .gitignore. Those are ours (clients/python/pyproject.toml) and should not
# churn every time the generator's project template does.
#
# The package directory is removed first. openapi-python-client overwrites
# what it emits but does not delete files it no longer emits, so without this
# a schema deleted from the spec would leave a stale model behind forever.
# ---------------------------------------------------------------------------
echo "==> python: openapi-python-client $OPENAPI_PYTHON_CLIENT_VERSION"
rm -rf "$py_pkg_dir"
mkdir -p "$(dirname "$py_pkg_dir")"
"$venv/bin/openapi-python-client" generate \
  --path "$spec" \
  --meta none \
  --output-path "$py_pkg_dir" \
  --overwrite \
  --config "$clients_dir/python/openapi-python-client.yml"

# --meta none skips the PEP 561 marker; the package is fully annotated and
# ships type information, so put it back.
touch "$py_pkg_dir/py.typed"
rm -rf "$py_pkg_dir/.ruff_cache"

# ---------------------------------------------------------------------------
# Go client.
#
# `go run <pkg>@<version>` pins the generator without adding it to the client
# module's dependency graph -- a consumer running `go get` on this module must
# not end up compiling a code generator.
#
# ogen's own --clean only removes files it recognises as its own, so the
# package directory is cleared here for the same stale-file reason as Python.
# ---------------------------------------------------------------------------
echo "==> go: ogen $OGEN_VERSION"
rm -rf "$go_pkg_dir"
mkdir -p "$go_pkg_dir"
GOFLAGS=-mod=mod go run "github.com/ogen-go/ogen/cmd/ogen@$OGEN_VERSION" \
  --config "$clients_dir/go/ogen.yml" \
  --target "$go_pkg_dir" \
  --package chatapi \
  --clean \
  "$spec"

# ---------------------------------------------------------------------------
# The base path, derived from the spec's `servers` block. See the script's
# docstring for why this is not left to a README.
# ---------------------------------------------------------------------------
echo "==> base path"
"$venv/bin/python" "$here/emit_base_path.py" \
  "$spec" \
  "$go_pkg_dir/base_path.go" \
  "$py_pkg_dir/base_path.py"

# go.mod/go.sum live outside the generated package and are resolved, not
# generated; tidy them so a fresh dependency introduced by a generator bump
# lands in the same commit as the code that needs it.
if [[ -f "$dest/go/go.mod" ]]; then
  (cd "$dest/go" && go mod tidy >/dev/null 2>&1 || true)
fi

# ---------------------------------------------------------------------------
# Lockfile. `--into` runs are throwaway comparison trees and must not claim to
# be the checked-in state.
# ---------------------------------------------------------------------------
if [[ "$dest" == "$clients_dir" ]]; then
  echo "==> generated.lock"
  "$here/write-lock.sh"
fi

echo "done"
