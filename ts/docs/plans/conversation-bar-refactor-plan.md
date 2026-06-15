# Shared Conversation Bar Refactor Plan

Refactor the VS Code shell's existing session bar into a host-neutral `ConversationBar` component in the shared `chat-ui` package, then replace the VS Code webview's inline session-bar DOM logic with that component and add a thin Electron shell adapter that uses the existing `ClientAPI` conversation methods. This keeps the reusable UI aligned with the agent-server conversation model while preserving host-specific transport, lifecycle, and theme behavior in each shell.

## Goals

- Reuse the conversation-switching UI from `vscode-shell` in the TypeAgent Electron shell.
- Keep the UI reusable and host-neutral.
- Preserve the richer existing VS Code shell behavior before adding the Electron integration.
- Keep transport and lifecycle concerns in host-specific adapters.
- Avoid moving chat history replay, queue state, cancellation dedupe, or dispatcher lifecycle into the conversation bar.

## Non-Goals

- Refactoring `ChatPanel` internals beyond the layout changes needed to mount the shared conversation bar.
- Changing dispatcher queue chip behavior, history replay, command completion, or reconnect transport.
- Replacing the existing DOM-first `chat-ui` component pattern with a framework.

## Current Implementation Summary

The VS Code shell's current conversation UI is implemented as a session bar and lives across three areas:

- `ts/packages/vscode-shell/src/chatViewProvider.ts` contains the webview HTML markup for the bar.
- `ts/packages/vscode-shell/src/webview/main.ts` owns DOM references, state, event handlers, rendering, validation, and bridge messaging.
- `ts/packages/vscode-shell/media/chat.css` contains the session bar styles, mostly using VS Code theme variables.

The TypeAgent Electron shell already has conversation infrastructure:

- `ts/packages/shell/src/preload/electronTypes.ts` exposes `ClientAPI` methods for list/create/switch/rename/delete/current conversation operations.
- `ts/packages/shell/src/preload/chatView.ts` wires those methods to IPC handlers and forwards `conversation-changed` events to the renderer client.
- `ts/packages/shell/src/main/conversationManager.ts` implements local and remote conversation backends.
- `ts/packages/shell/src/renderer/src/main.ts` is the renderer entry point that mounts the chat panel.
- `ts/packages/shell/src/renderer/src/chatPanelBridge.ts` owns chat replay, queue mirroring, and the existing `conversationChanged` handling.

## Plan

### 1. Inventory and Freeze Current Behavior

Capture the current VS Code shell session-bar behaviors from `ts/packages/vscode-shell/src/chatViewProvider.ts`, `ts/packages/vscode-shell/src/webview/main.ts`, and `ts/packages/vscode-shell/media/chat.css`. Treat this as inventory of the existing implementation, not as naming guidance for the shared component.

Behavior to preserve:

- Current conversation display.
- Connected, disconnected, reconnecting, creating, and switching status display.
- Client count display.
- Search and filter conversation list.
- Create conversation flow.
- Rename current conversation flow.
- Inline rename from search results.
- Delete current conversation and listed conversation flows.
- Duplicate-name validation for create and rename.
- Escape and click-outside dismissal for popovers.
- Disabled controls while disconnected, switching, or otherwise unavailable.
- `activateNewSessionInput` support.

### 2. Design the Shared `ConversationBar` API

Create `ts/packages/chat-ui/src/conversationBar.ts` with public types that align with agent-server conversation terminology.

Likely types:

```ts
export type ConversationBarConversation = {
    conversationId: string;
    name: string;
    clientCount?: number;
};

export type ConversationBarStatus = {
    connected: boolean;
    switching?: boolean;
    statusLabel?: "Creating" | "Connecting" | "Switching";
    errorText?: string;
    reconnectText?: string;
    demoSuffix?: string;
};

export type ConversationBarController = {
    requestConversations(): void | Promise<void>;
    createConversation(name: string): void | Promise<void>;
    switchConversation(conversationId: string): void | Promise<void>;
    renameConversation(conversationId: string, name: string): void | Promise<void>;
    deleteConversation(conversationId: string): void | Promise<void>;
};
```

Likely public methods:

- `setStatus(status: ConversationBarStatus): void`
- `setCurrentConversation(conversationId: string | undefined, name?: string, clientCount?: number): void`
- `setConversations(conversations: ConversationBarConversation[], currentConversationId?: string): void`
- `setError(message: string | undefined): void`
- `activateCreateInput(): void`
- `dispose(): void`

Keep all transport out of this component. `ConversationBar` should call callbacks supplied by the host and expose update methods for host events.

### 3. Move Markup Construction into `ConversationBar`

Replace the hard-coded session bar markup in `ts/packages/vscode-shell/src/chatViewProvider.ts` with either:

- A simple mount container, such as `#session-bar-root`, or
- Renderer-created insertion of the bar before `#chat-root`.

Move these responsibilities into `ConversationBar`:

- DOM construction.
- Event listener registration and disposal.
- Popover show/hide state.
- Search filtering.
- Current-session rename state.
- Inline search-result rename state.
- Create and rename duplicate-name validation.
- Control enablement and disabled states.
- Escape and click-outside behavior.

Follow the existing class-based DOM component style used by `ChatPanel` and `FeedbackWidget`.

### 4. Move Shared Styling into `chat-ui`

Add conversation-bar styles to `ts/packages/chat-ui/styles/chat.css`, or to a new style file if the package style organization changes during implementation.

Convert VS Code-specific variables into host-neutral CSS variables, for example:

- `--chat-conversation-background`
- `--chat-conversation-border`
- `--chat-conversation-foreground`
- `--chat-conversation-muted-foreground`
- `--chat-conversation-button-background`
- `--chat-conversation-button-hover-background`
- `--chat-conversation-input-background`
- `--chat-conversation-input-border`
- `--chat-conversation-focus-border`
- `--chat-conversation-error-foreground`
- `--chat-conversation-success-foreground`
- `--chat-conversation-warning-foreground`
- `--chat-conversation-popover-shadow`

Leave host token mapping in host-specific styles:

- VS Code shell maps shared tokens to `--vscode-*` variables in `ts/packages/vscode-shell/src/webview/vscode-theme.css` or `ts/packages/vscode-shell/media/chat.css`.
- Electron shell maps shared tokens in `ts/packages/shell/src/renderer/assets/styles.less`, including `.dark-mode` overrides.

### 5. Export the Shared Component

Update `ts/packages/chat-ui/src/index.ts` to export:

- `ConversationBar`
- `ConversationBarConversation`
- `ConversationBarStatus`
- `ConversationBarController`
- Any other public options/types added during implementation.

The existing `chat-ui` package exports should remain sufficient because consumers already import from `chat-ui` and `chat-ui/styles`.

### 6. Replace the VS Code Shell Implementation

In `ts/packages/vscode-shell/src/webview/main.ts`, instantiate `ConversationBar` before or alongside `ChatPanel`.

Wire adapter callbacks to existing bridge messages from `ts/packages/vscode-shell/src/bridge/messages.ts`:

- `requestSessions`
- `createSession`
- `switchSession`
- `renameCurrentSession`
- `deleteCurrentSession`
- `renameSession`
- `deleteSession`

Route existing bridge-to-webview messages into component methods:

- `status`
- `switching`
- `activateNewSessionInput`
- `sessionChanged`
- `sessionList`
- `sessionError`
- `reconnectStatus`

Keep current chat reset behavior in the VS Code webview's `sessionChanged` handler:

- Clear `ChatPanel`.
- Reset queue mirror state.
- Clear cancellation dedupe sets.
- Clear pending queue chip state.
- Request the session list.

`ConversationBar` should not own queue, history, or chat state.

### 7. Integrate the Bar into TypeAgent Shell

In `ts/packages/shell/src/renderer/src/main.ts`, create a layout container so the conversation bar sits above the existing chat panel without breaking `CameraView` overlay placement.

Instantiate `ConversationBar` with callbacks backed by existing `ClientAPI` methods:

- `conversationList`
- `conversationCreate`
- `conversationSwitch`
- `conversationRename`
- `conversationDelete`
- `conversationGetCurrent`

Use the existing `Client.conversationChanged` callback path from `ts/packages/shell/src/preload/chatView.ts` and `ShellWindow.sendConversationChanged` in `ts/packages/shell/src/main/shellWindow.ts` to update the current session and refresh the list after switches.

On successful create, switch, delete, or rename:

- Refresh the session list.
- Update the current session when appropriate.
- Surface errors through `ConversationBar`.
- Let existing `chatPanelBridge.ts` conversation-change handling remain responsible for clearing and replaying chat history.

### 8. Handle Local Conversation Mode

`createLocalConversationBackend` in `ts/packages/shell/src/main/conversationManager.ts` intentionally does not support multi-conversation operations.

Recommended local-mode behavior:

- Show the default conversation.
- Disable create, switch, rename, and delete controls.
- Surface a concise warning/error in the status area only if the user reaches an unsupported operation through a non-disabled path.

### 9. Normalize Host Naming

The agent server and Electron shell use conversation terminology: `ConversationInfo`, `conversationId`, `conversationList`, `conversationCreate`, `conversationSwitch`, `conversationRename`, `conversationDelete`, and `conversationGetCurrent`.

Use `ConversationBar`, `conversationId`, and conversation-oriented method names in the shared API and in all new shared types. Treat the VS Code shell's existing `sessionId` bridge messages and UI implementation details as legacy adapter names. Preserve user-facing copy as "Conversation" unless an existing shell command or menu surface specifically uses "Session".

### 10. Add Focused Tests

Add `chat-ui` jsdom/unit tests for the extracted component:

- Current-session rendering.
- Filtering.
- Create duplicate validation.
- Rename duplicate validation.
- Disabled state.
- Callback invocation.
- Escape dismissal.
- Click-outside dismissal.

Add or update VS Code shell coverage if a webview/unit test harness is available. If not, document a manual smoke path and rely on compile/type checks.

Add shell integration coverage in `ts/packages/shell/test/conversationBar.spec.ts` using the existing shell test helpers. Cover:

- Visible current/default conversation.
- Create, rename, switch, and delete when remote-capable test infrastructure is available.
- Disabled local-mode behavior when remote test infrastructure is unavailable.

## Verification

Run these checks after implementation:

1. `pnpm -C ts/packages/chat-ui build`
2. `pnpm -C ts/packages/chat-ui test:local`
3. `pnpm -C ts/packages/vscode-shell compile`
4. `pnpm -C ts/packages/shell typecheck`
5. `pnpm -C ts/packages/shell shell:test` or a targeted Playwright conversation-bar spec
6. `npm run build -- --vscode` from `ts`

Manual smoke checks:

- VS Code shell: connect, open create popover, create a conversation, switch conversations, rename current conversation, rename from a search row, delete a conversation, and verify reconnect/switching/error states.
- TypeAgent shell: start shell, verify bar layout, verify current conversation display, verify local-mode disabled behavior, and verify remote conversation operations with an agent server connected.

## Key Decisions

- Put the reusable UI in `chat-ui`, not in `vscode-shell` or `shell`, because both shells already consume `chat-ui` and it contains the existing shared DOM component pattern.
- Keep host-specific communication in adapters: VS Code uses existing `postMessage` bridge messages, while the shared component and Electron shell align with agent-server conversation naming.
- Use host-neutral CSS custom properties in shared styles, then map them to VS Code theme variables or Electron shell light/dark colors per host.
- Keep chat history, queue mirror, cancellation dedupe, and dispatcher lifecycle outside `ConversationBar`; conversation changes should notify the host, and each host remains responsible for clearing and replaying chat state.
- Preserve current VS Code behavior first, then add desktop shell support. This reduces regression risk because VS Code has the richer existing session-bar surface.

## Further Considerations

1. Icon strategy: the existing VS Code bar uses Codicons. Recommendation: make icon rendering injectable or use text/icon class hooks so VS Code can keep Codicons while Electron can use simple shared SVG/icon helpers without adding a new dependency.
2. Session-list refresh strategy: current Electron shell has `conversationChanged` but no separate list-changed push. Recommendation: refresh after every successful create, rename, delete, and switch, and on `conversationChanged`; add a push channel only if multi-client desktop shell freshness becomes a requirement.
3. Local-mode UX: recommendation is to show the default conversation and disable unsupported actions, because `createLocalConversationBackend` intentionally rejects multi-conversation operations.
