# Development setup

Repo-contributor's entry point. The core setup (prereqs, build, run, test,
lint) is covered in the [Overview](../overview/index.md) section. This
page adds the pieces that only matter when you are changing the repo.

## Get a working checkout

Start with the overview pages, which cover everything a first-time
contributor needs before their first PR:

- [Getting started](../overview/getting-started.md) - prereqs, `pnpm i`,
  `pnpm run build`, `pnpm run shell` / `pnpm run cli`, and the
  "Test, lint, format" summary. Links out to the per-platform
  [Windows](../overview/setup-windows.md) / [WSL2](../overview/setup-wsl2.md)
  / [Linux](../overview/setup-linux.md) / [macOS](../overview/setup-macos.md)
  setup guides.
- [Service keys and configuration](../overview/service-keys.md):
  `ts/config.local.yaml`, keyless (identity-based) access, and Azure Key
  Vault management via `npm run getKeys`.

The rest of this page assumes a working local build.

## Running a single test

`pnpm run test:local` and `pnpm run test:live` (documented in
[Test, lint, format](../overview/getting-started.md#test-lint-format))
run everything. To iterate on one test file or test name, `cd` into the
package directory and use `jest-esm`, a wrapper around
`node --experimental-vm-modules jest`:

```bash
pnpm run jest-esm --testPathPattern="merge.spec.js"
pnpm run jest-esm --testNamePattern="your test name"
```

## Code style

Prettier uses defaults (no `.prettierrc`). TypeScript and JavaScript use
4-space indentation, JSON uses 2-space, line endings are LF, and every
source file starts with the Microsoft copyright header.

## Schema-change regeneration

If you touched a translator or explainer schema, the built-in construction
cache and test data need to be regenerated and evaluated for correctness.

Test data lives under
[`ts/packages/defaultAgentProvider/test/data`](https://github.com/microsoft/TypeAgent/tree/main/ts/packages/defaultAgentProvider/test/data),
one file per translator/explainer. Use `agent-cli data add` to add new
test cases.

To regenerate, from the repo root or the
[`ts/packages/cli`](https://github.com/microsoft/TypeAgent/tree/main/ts/packages/cli)
directory:

```bash
pnpm run regen:builtin       # regenerate the builtin construction store
pnpm run regen               # regenerate test data
```

To evaluate correctness:

- `agent-cli data diff <file>`: open a test-data diff in VS Code.
- Run `pnpm run test` to verify round-trip (also runs in CI).
- Compare stats: `pnpm run regen -- -- --none` prints per-file and total
  stats. Explanation failure counts and attempt/correction ratios should
  stay roughly the same or improve.

## Debugging and troubleshooting

- [Developer tips](../overview/developer-tips.md): common pitfalls
  (`pnpm i` after sync, `git clean -dfX` reset, `TYPEAGENT_EXECMODE=0` for
  in-proc agents, VS Code `@debug` attach, Jest Explorer fixes).
- `@debug` in the shell or CLI opens an inspector to attach VS Code to.
- Traces use the [`debug`](https://www.npmjs.com/package/debug) package.
  Set `DEBUG=typeagent:prompt` (or any `typeagent:*` namespace) in the
  environment, or issue `@trace <pattern>` inside the interactive shell.

## Submitting changes

- Sign the CLA on your first PR; the bot will prompt you. Details in
  [`CONTRIBUTIONS.md`](https://github.com/microsoft/TypeAgent/blob/main/CONTRIBUTIONS.md).
- Run `pnpm run prettier` and `pnpm run test:local` before pushing.
- Follow the
  [Code of Conduct](https://github.com/microsoft/TypeAgent/blob/main/CODE_OF_CONDUCT.md).
- Security issues go through
  [`SECURITY.md`](https://github.com/microsoft/TypeAgent/blob/main/SECURITY.md),
  not GitHub Issues.

If your change touches documentation, see the wiki pages linked from
[Contributing](./index.md); they cover adding pages, packages, agents,
and running the doc-autogen pipeline.

If you touched a translator or explainer schema, the built-in construction
cache and test data need to be regenerated and evaluated for correctness.

Test data lives under
[`ts/packages/defaultAgentProvider/test/data`](https://github.com/microsoft/TypeAgent/tree/main/ts/packages/defaultAgentProvider/test/data),
one file per translator/explainer. Use `agent-cli data add` to add new
test cases.

To regenerate, from the repo root or the
[`ts/packages/cli`](https://github.com/microsoft/TypeAgent/tree/main/ts/packages/cli)
directory:

```bash
pnpm run regen:builtin       # regenerate the builtin construction store
pnpm run regen               # regenerate test data
```

To evaluate correctness:

- `agent-cli data diff <file>`: open a test-data diff in VS Code.
- Run `pnpm run test` to verify round-trip (also runs in CI).
- Compare stats: `pnpm run regen -- -- --none` prints per-file and total
  stats. Explanation failure counts and attempt/correction ratios should
  stay roughly the same or improve.

## Debugging and troubleshooting

- [Developer tips](../overview/developer-tips.md): common pitfalls
  (`pnpm i` after sync, `git clean -dfX` reset, `TYPEAGENT_EXECMODE=0` for
  in-proc agents, VS Code `@debug` attach, Jest Explorer fixes).
- The CLI and Shell define VS Code launch tasks; use `@debug` to expose an
  inspector and then attach.
- Traces use the [`debug`](https://www.npmjs.com/package/debug) package.
  Set `DEBUG=typeagent:prompt` (or any `typeagent:*` namespace) in the
  environment, or issue `@trace <pattern>` inside the interactive shell.

## Submitting changes

- Sign the CLA on your first PR; the bot will prompt you. Details in
  [`CONTRIBUTIONS.md`](https://github.com/microsoft/TypeAgent/blob/main/CONTRIBUTIONS.md).
- Run `pnpm run prettier` and `pnpm run test:local` before pushing.
- Follow the
  [Code of Conduct](https://github.com/microsoft/TypeAgent/blob/main/CODE_OF_CONDUCT.md).
- Security issues go through
  [`SECURITY.md`](https://github.com/microsoft/TypeAgent/blob/main/SECURITY.md),
  not GitHub Issues.

If your change touches documentation, see the wiki pages linked from
[Contributing](./index.md); they cover adding pages, packages, agents,
and running the doc-autogen pipeline.
