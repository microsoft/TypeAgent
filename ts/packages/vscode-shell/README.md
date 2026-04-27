# TypeAgent VS Code Shell

Embeds the [TypeAgent](https://github.com/microsoft/TypeAgent) shell chat
directly into VS Code as a side panel and editor tabs. Each chat panel is
backed by a TypeAgent conversation hosted by the running TypeAgent agent
server.

## Prerequisites

- VS Code 1.90 or newer
- A running TypeAgent **agent server** reachable on `ws://localhost:8999`
  (the default). Start it from the TypeAgent monorepo:

  ```sh
  cd ts/packages/agentServer/server
  pnpm run start
  ```

  The agent server depends on the rest of the TypeAgent stack being built.
  See the top-level [TypeAgent README](../../../README.md) for setup.

## Installation

### Build & install locally (recommended for development)

From this directory:

```sh
npm install
npm run deploy:local
```

`deploy:local` packages the extension and installs it into your active
`code` CLI in one step. Reload the VS Code window after the first install.

To uninstall a previous version (e.g. the legacy `typeagent-shell` package):

```sh
code --uninstall-extension typeagent.typeagent-shell
```

### Install a prebuilt VSIX

```sh
npm run package
code --install-extension dist-pub/vscode-shell.vsix --force
```

## Usage

### Opening chats

- **Activity bar icon** (robot) → opens the persistent **Chat** side panel.
- **`Ctrl+K Ctrl+T`** (`Cmd+K Cmd+T` on macOS) → opens a **new chat tab**
  in the editor area. You can have several editor-tab chats open at once;
  each is its own conversation.
- Command palette commands (under **TypeAgent**):
  - `Open Chat in Editor`
  - `New Chat (Side Panel)`
  - `Focus Chat`
  - `New Conversation`
  - `Switch Conversation`
  - `Rename Conversation`
  - `Delete Conversation`
  - `Clear Chat View`

### Chatting

- Type a message and hit `Enter` to send. `Shift+Enter` inserts a newline.
- The connection state is shown at the top of the panel
  (`Connected` / `Disconnected`).
- IntelliSense:
  - **Inline ghost text** suggests command/agent completions as you type.
    Press `Tab` to accept.
  - Click the small `▼` toggle on the right of the input to switch to a
    **dropdown** menu instead. Use `↑`/`↓` to navigate, `Enter`/`Tab` to
    accept, `Esc` to dismiss.

### Conversation management (chat-driven)

When the `code` agent's `code-vscode-shell` sub-schema is loaded by the
agent server, you can drive the extension's conversation tabs from chat:

- "**new conversation**" / "**new conversation named X**"
- "**rename this conversation to X**"
- "**switch to conversation X**"

You may need to prefix with `@code` if the dispatcher doesn't auto-route,
e.g. `@code rename this conversation to Brainstorm`.

### Keybindings (defaults)

| Action | Windows / Linux | macOS |
| --- | --- | --- |
| New Chat (Side Panel) | `Ctrl+K Ctrl+T` | `Cmd+K Cmd+T` |
| New Conversation | `Ctrl+K Ctrl+N` | `Cmd+K Cmd+N` |
| Switch Conversation | `Ctrl+K Ctrl+S` | `Cmd+K Cmd+S` |
| Rename Conversation | `Ctrl+K Ctrl+R` | `Cmd+K Cmd+R` |
| Clear Chat View | `Ctrl+K Ctrl+L` | `Cmd+K Cmd+L` |

These chord bindings are gated on the chat being focused (a `when` clause
on the `vscode-shell.chatFocused` context key).

## Settings

| Setting | Default | Description |
| --- | --- | --- |
| `typeagent.serverUrl` | `ws://localhost:8999` | WebSocket URL of the TypeAgent agent server |
| `typeagent.autoStart` | `false` | (Reserved) Auto-start the agent server if not running |
| `typeagent.serverPort` | `8999` | (Reserved) Port to use when auto-starting the server |

## Multiple chat panels

Side-panel and editor-tab chats are independent webviews on the same
agent-server connection. You can:

- Run several conversations side-by-side in editor tabs.
- Have two tabs joined to the **same** conversation; messages typed in one
  appear in the other in real time.

## Development

| Script | Description |
| --- | --- |
| `npm run compile` | One-shot esbuild bundle for both extension host and webview. |
| `npm run watch` | esbuild in watch mode. |
| `npm run package` | Produce `dist-pub/vscode-shell.vsix`. |
| `npm run deploy:local` | Package and install the VSIX into the local `code` CLI. |
| `npm run clean` | Remove `dist`, `dist-pub`, and stray `.vsix` files. |

The extension host code lives in `src/`; the webview UI in `src/webview/`.
The host owns the WebSocket connection to the agent server; the webview
talks to the host via `postMessage`.

## License

MIT — see the [TypeAgent repository LICENSE](../../../LICENSE).
