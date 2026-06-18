# TypeAgent VS Code Chat

Registers **TypeAgent** as a third-party agent in VS Code's native Chat
view. Conversations created in TypeAgent (via this extension, the Electron
shell, the CLI, or `vscode-shell`) appear as session items in the Chat
sidebar; sending a prompt in a TypeAgent session routes through the running
agent server.

This extension uses VS Code's **proposed** `chatSessionsProvider` API. It
must be sideloaded into a VS Code build that runs proposed APIs (typically
Insiders, launched with `--enable-proposed-api typeagent.vscode-chat`). It
is **not** Marketplace-eligible while the API remains proposed.

If you want the stable, Marketplace-eligible TypeAgent chat surface, see
the sibling `vscode-shell` extension — that one uses a custom webview and
does not depend on proposed APIs.

## Prerequisites

- VS Code **1.95** or newer (Insiders recommended).
- A running TypeAgent **agent server** reachable on `ws://localhost:8999`
  (the default). Start it from the TypeAgent monorepo:

  ```sh
  cd ts/packages/agentServer/server
  pnpm run start
  ```

## Install

```sh
npm install
npm run deploy:local
```

`deploy:local` packages the extension and installs it into the active
`code` CLI. After install, launch VS Code with the proposed API enabled:

```sh
code-insiders --enable-proposed-api typeagent.vscode-chat
```

(or set the `enable-proposed-api` flag in your Insiders launch config.)

## Usage

1. Open VS Code's Chat view.
2. Click the agent selector. **TypeAgent** appears alongside Copilot.
3. Either click the existing TypeAgent sessions or start a new one (the
   `+` button creates a new conversation on the agent server).
4. Type a prompt. The dispatcher processes it; markdown/text output
   streams back into the chat panel.

Conversation switching is handled via VS Code's standard Chat sidebar
session list. Conversations created here are visible from the CLI and
Electron shell too.

## Settings

| Setting                   | Default               | Description                                 |
| ------------------------- | --------------------- | ------------------------------------------- |
| `typeagentChat.serverUrl` | `ws://localhost:8999` | WebSocket URL of the TypeAgent agent server |

## Development

| Script                 | Description                                         |
| ---------------------- | --------------------------------------------------- |
| `npm run compile`      | One-shot esbuild bundle of the extension host.      |
| `npm run watch`        | esbuild in watch mode.                              |
| `npm run package`      | Produce `dist-pub/vscode-chat.vsix`.                |
| `npm run deploy:local` | Package and install the VSIX into the local `code`. |
| `npm run clean`        | Remove `dist`, `dist-pub`, and stray `.vsix` files. |

### Regenerating the icon font

The participant icon is provided via a contributed icon font
(`media/typeagent-icons.woff`) generated from `media/icons/typeagent.svg`
using [fantasticon](https://www.npmjs.com/package/fantasticon). The
font is checked in, so you only need to regenerate it after editing the
SVG:

```sh
npx --yes fantasticon
```

The config lives in `.fantasticonrc.json`. After regenerating, bump the
extension `version` in `package.json` (or fully restart VS Code) before
reinstalling — VS Code caches the contributed WOFF by file path, so an
unchanged path will keep serving the stale font.

## License

MIT — see the [TypeAgent repository LICENSE](../../../LICENSE).

## Trademarks

This project may contain trademarks or logos for projects, products, or services. Authorized use of Microsoft
trademarks or logos is subject to and must follow
[Microsoft's Trademark & Brand Guidelines](https://www.microsoft.com/en-us/legal/intellectualproperty/trademarks/usage/general).
Use of Microsoft trademarks or logos in modified versions of this project must not cause confusion or imply Microsoft sponsorship.
Any use of third-party trademarks or logos are subject to those third-party's policies.
