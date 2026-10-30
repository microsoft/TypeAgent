# Synthetic certificate rotation demo

This isolated Node.js demo does not change TypeAgent product behavior. It uses
only `127.0.0.1:43187`, built-in Node modules, and public synthetic values.
The HTTP header models a certificate identity: **there is no TLS, actual
certificate, private key, or real security incident**. Do not use this as an
authentication implementation.

## Start or reset the failing demo

From the repository root in PowerShell, run each command on its own line:

```powershell
node .\docs\demos\certificate-rotation\setup.mjs
node .\docs\demos\certificate-rotation\service.mjs
```

In another terminal:

```powershell
node .\docs\demos\certificate-rotation\client.mjs
node --test .\docs\demos\certificate-rotation\client.spec.mjs .\docs\demos\certificate-rotation\service.spec.mjs
```

The client reports `Authentication failed: HTTP 401`, identifies the configuration
file to update, and exits with code 1. This failure is intentional: setup recreates
the original synthetic identity, but the service now accepts only its replacement. Repeating the request
with the retired identity still fails. At the baseline commit the same client
and setup commands succeeded.

Setup creates an ignored developer-local configuration. The service reads its
committed configuration at startup; restart it after changing that configuration.
Stop the server with Ctrl+C in its terminal. The client optionally accepts a
configuration file path as its sole argument.

To reset the demo, rerun `setup.mjs`. It overwrites only the demo's ignored local
configuration with the original identity. Do not repair that file before filming.
To prove the replacement works without changing the stale local file:

```powershell
curl.exe --silent --show-error --write-out "HTTP %{http_code}\n" -H "x-demo-certificate-identity: synthetic-certificate-original" http://127.0.0.1:43187/report
curl.exe --silent --show-error --write-out "HTTP %{http_code}\n" -H "x-demo-certificate-identity: synthetic-certificate-replacement" http://127.0.0.1:43187/report
```

Expected results are 401 and 200 respectively. The tests explicitly reject the
original, unknown, and empty identities. All values here are nonsecret.

## Rotation constraint and live demo

The fictional security concern requires retiring the original identity. The
retired credential must **never** be accepted as a fallback. The assumption is
that retirement remains applicable even when a developer's ignored configuration
is stale. Retrying the same credential cannot resolve this policy mismatch.

The rotation changes the service policy, not `client.mjs` or `setup.mjs`.
The client explains a 401 without retrying or restoring the retired identity.
Update `certificateIdentity` in the selected local configuration to
`synthetic-certificate-replacement` to restore access. Configuration and connection
errors have separate guidance; other HTTP failures retain their status code.

Suggested prompts:

> Find out why this script is failing. It worked before rotation.

> Improve how the script handles this authentication failure.

Git Story's normal commit hook produces the portable story; generated
`GIT-STORY-ASSUMPTIONS.json` files are staged explicitly. Use `git story log HEAD
--json --max-count 1` for the published story and `git story insights read
--revision HEAD` for committed assumption versions. Locally captured raw events
and their model-generated publication summaries are different evidence surfaces;
an invocation by itself is not proof of success.

## Provenance

Demo commits use the fictional author and committer `Demo Teammate
<demo-teammate@example.invalid>` with the required Copilot attribution. This
models a teammate's work; it does not prove a separate human contributed.
Git Story conversation fixtures, if used, are explicitly synthetic reconstructions
of this setup, not authentic historical user turns or authorization. Observations
come from actual local runs. Original app transcripts are not modified.

Video-facing commit messages and conversation turns are scripted in character.
Their fictional provenance is recorded here and in the fixture metadata rather
than repeated in each turn. They are not historical statements by a real
teammate and must not be used as evidence of a real security incident.

Use the narration **"worked before rotation"**. Commits are made at their actual
creation time, not backdated to yesterday. The later live demo should investigate
the failure and improve its handling; that improvement is intentionally absent.
