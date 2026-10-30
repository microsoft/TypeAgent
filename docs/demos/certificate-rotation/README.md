# Synthetic certificate rotation demo

This isolated Node.js demo does not change TypeAgent product behavior. It uses
only `127.0.0.1:43187`, built-in Node modules, and public synthetic values.
The HTTP header models a certificate identity: **there is no TLS, actual
certificate, private key, or real security incident**. Do not use this as an
authentication implementation.

## Baseline

From the repository root in PowerShell, run each command on its own line:

```powershell
node .\docs\demos\certificate-rotation\setup.mjs
node .\docs\demos\certificate-rotation\service.mjs
```

In another terminal:

```powershell
node .\docs\demos\certificate-rotation\client.mjs
node --test .\docs\demos\certificate-rotation\service.spec.mjs
```

Setup creates an ignored developer-local configuration. The service reads its
committed configuration at startup; restart it after changing that configuration.
Stop the server with Ctrl+C in its terminal. The client optionally accepts a
configuration file path as its sole argument.

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
