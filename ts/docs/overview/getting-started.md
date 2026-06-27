# Getting started

This page summarizes how to build, configure, and run TypeAgent locally. The
authoritative, always-current instructions live in the repository:

- TypeScript workspace setup: [`ts/README.md`](https://github.com/microsoft/TypeAgent/blob/main/ts/README.md)
- Per-OS setup guides (public docs site): `docs/content/setup/`
  ([Windows](https://github.com/microsoft/TypeAgent/blob/main/docs/content/setup/setup-Windows.md),
  [WSL2](https://github.com/microsoft/TypeAgent/blob/main/docs/content/setup/setup-WSL2.md),
  [Linux](https://github.com/microsoft/TypeAgent/blob/main/docs/content/setup/setup-Linux.md),
  [macOS](https://github.com/microsoft/TypeAgent/blob/main/docs/content/setup/setup-macOS.md))

## Prerequisites

- **Node ≥ 22** (the documented minimum; some tooling notes mention Node 20+,
  but the monorepo targets Node 22+).
- **pnpm ≥ 10** (`npm i -g pnpm && pnpm setup`).
- On Linux/WSL, see the Shell package README for extra system requirements.

## Build

All commands run from the `ts/` directory.

```bash
pnpm i                  # install
pnpm run build          # build all packages via fluid-build
pnpm run build:shell    # build only the shell app and its dependencies
```

`pnpm run build <dir|regexp>` builds a single package (and its dependencies).

## Configure service keys

The scenarios require service keys. Configuration lives in a YAML file in the
`ts/` directory:

```bash
cp config.sample.yaml config.local.yaml   # then fill in keys
```

A minimal Azure OpenAI configuration looks like:

```yaml
azureOpenAI:
  defaultAuth: <service key, or "identity" for keyless>
  deployments:
    default:
      # endpoint + deployment details
```

> Legacy `.env` files are still supported but deprecated and will stop working
> after September 2026. Prefer `config.local.yaml`.

## Run

The primary way to explore TypeAgent is the **TypeAgent Shell**, an Electron
app that talks to the dispatcher and the registered agents. See
[`ts/packages/shell/README.md`](https://github.com/microsoft/TypeAgent/blob/main/ts/packages/shell/README.md).

## Test, lint, format

```bash
pnpm run test:local      # unit tests (*.spec.ts) across packages
pnpm run test:live       # integration tests (*.test.ts) — needs API keys
pnpm --filter <pkg> test # tests for one package
pnpm run prettier        # check formatting
pnpm run prettier:fix    # fix formatting
```

Tests run against compiled output in `dist/test/`, so build before testing.

## Where data and tracing live

- User data: `~/.typeagent/`
- Tracing: the `debug` package — enable with `DEBUG=typeagent:*`.
