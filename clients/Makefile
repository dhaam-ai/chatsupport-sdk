# Generated backend clients. Everything here shells out to scripts/ so CI and
# a laptop run the identical commands.
#
# No target needs Java or Docker. `generate` and `check-full` need Go and
# Python 3; `check` needs neither.

.PHONY: help generate check check-full test test-go test-python test-scripts test-live clean

help:
	@echo "generate     regenerate both clients from openapi/chat-api.yaml"
	@echo "check        fast drift check (hashes only, no toolchain)"
	@echo "check-full   regenerate into a temp dir and diff byte-for-byte"
	@echo "test         run the Go, Python and script tests"
	@echo "test-live    also mint a token against a real backend"
	@echo "             (needs CHAT_LIVE_API_URL and CHAT_LIVE_SECRET_KEY)"
	@echo "clean        remove the codegen venv and test venv"

generate:
	./scripts/generate.sh

check:
	./scripts/check-drift.sh

check-full:
	./scripts/check-drift.sh --full

test: test-go test-python test-scripts

test-go:
	cd go && go test ./...

# A venv rather than a bare `pip install`: the tests import the client, so it
# has to be installed somewhere, and it should not be the system Python.
python/.venv/bin/pytest:
	python3 -m venv python/.venv
	python/.venv/bin/pip install --quiet --disable-pip-version-check -e 'python[test]'

test-python: python/.venv/bin/pytest
	cd python && .venv/bin/python -m pytest tests -q

# Tests for emit_base_path.py, the one generation step with no generator
# behind it. Reuses the Python test venv rather than polluting the codegen
# venv, whose contents are pinned by versions.env.
test-scripts: python/.venv/bin/pytest
	python/.venv/bin/python -m pytest scripts/test_emit_base_path.py -q

# The live checks skip themselves unless the env vars are set, so this is the
# same command as `test` with a backend pointed at.
#
#   set -a; . ../examples/demo/.env; set +a
#   CHAT_LIVE_API_URL="$$CHAT_API_URL" CHAT_LIVE_SECRET_KEY="$$CHAT_SECRET_KEY" \
#     make test-live
test-live: test

clean:
	rm -rf .codegen-venv python/.venv python/.pytest_cache
	find python/dhaam_ccrm_chat -name __pycache__ -type d -exec rm -rf {} +
