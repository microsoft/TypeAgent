# Surfaces

TypeAgent's personal agent is hosted by several **client surfaces** — different
front ends that all talk to the same
[dispatcher](../architecture/core/dispatcher.md) and registered agents. Pick the
one that fits your workflow.

> Cross-surface usage reference: the [Command reference](./command-reference.md)
> — the `@`-commands the dispatcher understands.

## Desktop & console

### TypeAgent Shell

The Electron desktop GUI — the primary way to explore TypeAgent — with voice
input, conversational memory, and the action cache.

- Run: `pnpm run shell` (on Ubuntu 24.04, use `pnpm run shell:nosandbox`).
- Reference: [Shell](../packages/shell/overview.md).

### TypeAgent CLI

A console front end with additional commands for exploring TypeAgent internals.

- Run: `pnpm run cli` to list commands, or `pnpm run cli -- connect` for the
  interactive prompt (connecting to the agent server over WebSocket RPC).
- Reference: [CLI](../packages/cli/overview.md).

## VS Code

### TypeAgent in the VS Code Chat view

Registers TypeAgent as a third-party agent in VS Code's native Chat view, so you
can invoke the personal agent from the editor's chat.

- Reference: [vscode-chat](../packages/vscode-chat/overview.md).

### Embedded Shell

Embeds the TypeAgent Shell chat directly inside VS Code.

- Reference: [vscode-shell](../packages/vscode-shell/overview.md).

### CODA — voice-operated coding

"Coda Operated Assistance for Coding with Voice" — a VS Code extension for
driving coding tasks by voice.

- Deploy locally: `cd ts/packages/coda` then `pnpm run deploy:local`.
- Reference: [coda](../packages/coda/overview.md).

### TypeAgent Studio

A VS Code extension that provides the **developer experience** for authoring,
tuning, and validating agents — compare-and-replay, schema/grammar tuning, and
trace investigation. (This is a tool for building TypeAgent, rather than an
end-user surface.)

- Reference: [typeagent-studio](../packages/typeagent-studio/overview.md).

## Browser

### Chrome browser extension

The [browser agent](../agents/browser/overview.md) ships a Chrome extension that
drives the browser from natural language and lets web sites register actions
through a JavaScript interface — the way TypeAgent applies the actions/memory/
plans model to the web.

- Reference: [browser agent](../agents/browser/overview.md).

## Mobile

### Android

The Android mobile dispatcher agent brings the personal agent to Android
devices.

- Reference: [androidMobile](../agents/androidMobile/overview.md).

## Programmatic

### Web API

A programmatic HTTP surface for TypeAgent, for integrating the dispatcher into
other applications.

- Reference: [api](../packages/api/overview.md).
