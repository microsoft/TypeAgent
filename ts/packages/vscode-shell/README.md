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

### Cancelling a running request

While a request is being processed the send arrow morphs into a **stop
button (`■`)**. There are three ways to interrupt:

| Gesture                            | Effect                                                                                                             |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Click **■** (or press `Esc`)       | Cancels the **current** in-flight request. The bubble gets a `⚠ Cancelled` affordance and the send arrow returns. |
| `Esc` twice within 1 second        | Cancels the in-flight request **and** every queued entry on this session.                                          |
| Click the **`×`** on a queued chip | Drops just that queued entry (local or peer/CLI-originated) without affecting other requests.                      |

While multiple requests are stacking up, each user bubble carries an
inline status chip:

- A **yellow `queued ×`** pill — request is waiting in the dispatcher
  queue. Click the `×` to drop just this one.
- A **blue `running`** pill — request is currently being processed.

Chips appear on both local and peer-originated bubbles (e.g. when
another VS Code chat tab or the CLI is joined to the same
conversation), so all participants see the queue evolve in real time.

Notes:

- `Esc` works whether the chat input is focused or not — the webview
  installs a document-level listener that fires as long as no other
  control has consumed the key (e.g. an open completion popup or menu).
- Cancellations originated from a peer (another VS Code chat tab,
  the Electron shell, or the CLI joined to the same conversation)
  appear on the local bubble too, via the dispatcher's
  `requestCancelled` push event. Late `setDisplay` / `appendDisplay`
  fragments that arrive after the cancel are dropped so the `⚠ Cancelled`
  marker is the final state of the bubble.
- The `⚠ Cancelled` affordance is anchored to the **corresponding user
  bubble** rather than appended at the bottom of the chat, so when a
  batch of queued requests is cancelled each "Cancelled" line shows up
  directly below the user message it belongs to (matching the Electron
  shell). For requests that already had agent output when cancelled,
  the affordance is appended to the existing agent bubble.
- Both the bridge and the webview deduplicate the multiple events that
  can fire for a single cancel (`requestCancelled` + `commandComplete`
  with `result.cancelled === true`), so each cancel paints **exactly
  one** `⚠ Cancelled` affordance per bubble.

The `code` agent's `code-vscode-shell` sub-schema implements a
`vscode-shell-action` client action that this extension handles. It is
**not** enabled by default (other hosts of the `code` agent — e.g. the
Electron shell — don't implement that client action and would otherwise
silently no-op the request). Enable it once per session in the chat:

```
@config schema code.code-vscode-shell
```

Note: this is the **full canonical** sub-schema name (`<parent>.<sub-key>`).
The schema appears as just `code-vscode-shell` in the `@config schema` table —
the parent prefix is hidden in the display but **required** when toggling.

To later disable it again, use `@config schema --off code.code-vscode-shell`.

The setting is persisted in your TypeAgent user settings, so you only
need to do this on first use. After it's on, you can drive the
extension's conversation tabs from chat:

- "**new conversation**" / "**new conversation named X**"
- "**rename this conversation to X**"
- "**switch to conversation X**"

You may need to prefix with `@code` if the dispatcher doesn't auto-route,
e.g. `@code rename this conversation to Brainstorm`.

### Keybindings (defaults)

| Action                 | Windows / Linux        | macOS                  |
| ---------------------- | ---------------------- | ---------------------- |
| New Chat in Editor     | `Ctrl+K Ctrl+T`        | `Cmd+K Cmd+T`          |
| New Conversation       | `Ctrl+K Ctrl+N`        | `Cmd+K Cmd+N`          |
| Switch Conversation    | `Ctrl+K Ctrl+S`        | `Cmd+K Cmd+S`          |
| Rename Conversation    | `Ctrl+K Ctrl+R`        | `Cmd+K Cmd+R`          |
| Clear Chat View        | `Ctrl+K Ctrl+L`        | `Cmd+K Cmd+L`          |
| Cancel current request | `Esc`                  | `Esc`                  |
| Cancel queue + current | `Esc Esc` (within 1 s) | `Esc Esc` (within 1 s) |

These chord bindings are gated on the chat being focused (a `when` clause
on the `vscode-shell.chatFocused` context key).

## Settings

| Setting                | Default               | Description                                           |
| ---------------------- | --------------------- | ----------------------------------------------------- |
| `typeagent.serverUrl`  | `ws://localhost:8999` | WebSocket URL of the TypeAgent agent server           |
| `typeagent.autoStart`  | `false`               | (Reserved) Auto-start the agent server if not running |
| `typeagent.serverPort` | `8999`                | (Reserved) Port to use when auto-starting the server  |

## Multiple chat panels

Side-panel and editor-tab chats are independent webviews on the same
agent-server connection. You can:

- Run several conversations side-by-side in editor tabs.
- Have two tabs joined to the **same** conversation; messages typed in one
  appear in the other in real time.

## Development

| Script                 | Description                                                  |
| ---------------------- | ------------------------------------------------------------ |
| `npm run compile`      | One-shot esbuild bundle for both extension host and webview. |
| `npm run watch`        | esbuild in watch mode.                                       |
| `npm run package`      | Produce `dist-pub/vscode-shell.vsix`.                        |
| `npm run deploy:local` | Package and install the VSIX into the local `code` CLI.      |
| `npm run clean`        | Remove `dist`, `dist-pub`, and stray `.vsix` files.          |

The extension host code lives in `src/`; the webview UI in `src/webview/`.
The host owns the WebSocket connection to the agent server; the webview
talks to the host via `postMessage`.

## License

MIT — see the [TypeAgent repository LICENSE](../../../LICENSE).

## Trademarks

This project may contain trademarks or logos for projects, products, or services. Authorized use of Microsoft
trademarks or logos is subject to and must follow
[Microsoft's Trademark & Brand Guidelines](https://www.microsoft.com/en-us/legal/intellectualproperty/trademarks/usage/general).
Use of Microsoft trademarks or logos in modified versions of this project must not cause confusion or imply Microsoft sponsorship.
Any use of third-party trademarks or logos are subject to those third-party's policies.
