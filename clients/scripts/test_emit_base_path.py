"""Tests for the servers-block -> source step.

Run with the codegen venv, which already has ruamel.yaml:

    .codegen-venv/bin/pip install pytest
    .codegen-venv/bin/python -m pytest scripts/test_emit_base_path.py -q

Or from clients/python's test venv after `pip install ruamel.yaml`.

This is the step that decides what path every generated request goes to, and
it is the step with no generator behind it, so it gets its own tests.
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest
from ruamel.yaml import YAML

sys.path.insert(0, str(Path(__file__).parent))

from emit_base_path import SpecError, base_path_from_spec  # noqa: E402

REPO_ROOT = Path(__file__).resolve().parents[2]
SPEC = REPO_ROOT / "openapi" / "chat-api.yaml"


def test_derives_the_real_spec_base_path() -> None:
    """The value the whole thing exists for.

    /chat-services/api/v1 is what chat-service actually mounts every route
    under. This spec once said {apiUrl}/v1, which no route serves.
    """
    spec = YAML(typ="safe").load(SPEC.read_text(encoding="utf-8"))
    assert base_path_from_spec(spec) == "/chat-services/api/v1"


def test_rejects_multiple_servers() -> None:
    spec = {
        "servers": [
            {"url": "{apiUrl}/a", "variables": {"apiUrl": {}}},
            {"url": "{apiUrl}/b", "variables": {"apiUrl": {}}},
        ]
    }
    with pytest.raises(SpecError, match="exactly one entry"):
        base_path_from_spec(spec)


def test_rejects_a_url_that_is_not_origin_plus_path() -> None:
    """A hardcoded host would silently ignore the caller's apiUrl."""
    spec = {"servers": [{"url": "https://api.example.com/v1"}]}
    with pytest.raises(SpecError, match=r"must start with"):
        base_path_from_spec(spec)


def test_rejects_an_undeclared_server_variable() -> None:
    spec = {"servers": [{"url": "{apiUrl}/v1"}]}
    with pytest.raises(SpecError, match="declares no"):
        base_path_from_spec(spec)


def test_rejects_a_templated_path() -> None:
    """Both clients join a plain string. A second variable would be emitted
    verbatim into the URL as `{region}` and fail at request time, not here."""
    spec = {
        "servers": [
            {
                "url": "{apiUrl}/{region}/v1",
                "variables": {"apiUrl": {}, "region": {}},
            }
        ]
    }
    with pytest.raises(SpecError, match="server variable"):
        base_path_from_spec(spec)


def test_rejects_a_trailing_slash() -> None:
    """ResolveBaseURL("origin/") + "/path/" would produce a double slash on
    every request; some routers 404 on it and some do not, which is worse."""
    spec = {"servers": [{"url": "{apiUrl}/v1/", "variables": {"apiUrl": {}}}]}
    with pytest.raises(SpecError, match="must not end with"):
        base_path_from_spec(spec)


def test_rejects_a_bare_origin() -> None:
    """An empty base path is a plausible future edit and would silently send
    every request to the origin root."""
    spec = {"servers": [{"url": "{apiUrl}", "variables": {"apiUrl": {}}}]}
    with pytest.raises(SpecError, match=r"must start with '/'"):
        base_path_from_spec(spec)
