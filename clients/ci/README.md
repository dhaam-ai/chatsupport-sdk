# `clients/ci/` — the CI job, not yet wired in

[`clients.yml`](clients.yml) is a complete GitHub Actions workflow. It is
**not active**: workflows only run from `.github/workflows/`, and that
directory was outside the ownership of the change that added `clients/`.

To activate:

```bash
cp clients/ci/clients.yml .github/workflows/clients.yml
```

Then, if the repo uses branch protection, add **`generated clients match the
spec`** to the required checks.

## Until that happens

The drift gates run only when someone runs them by hand. A generated client
that has silently drifted from the spec is worse than no client — it is wrong
with the authority of something that looks machine-checked — so this is the
one loose end in `clients/` worth closing first.

The cheapest partial mitigation, if adding a workflow file is not on the
table, is four lines in the existing `verify` job of
`.github/workflows/ci.yml`. It needs no Go, no Python and no network:

```yaml
      - name: Generated clients match the spec
        run: clients/scripts/check-drift.sh
```

That catches a spec edit with no regeneration, and a hand-edit of generated
code. It does not catch a hand-edit whose author also reran
`clients/scripts/write-lock.sh` — only `--full` does, and that is what the
workflow here is for.
