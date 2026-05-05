# chat-ui

Shared DOM-based chat rendering for TypeAgent surfaces.

`ChatPanel` is a hand-rolled, framework-free chat UI used by the
[VS Code shell extension](../vscode-shell/) and the [browser
extension](../agents/browser/) chat panel. It exposes a host-driven API
for rendering user/agent bubbles, streaming display updates, dynamic
status, history replay, command completions, and metrics tooltips.

## Usage

```ts
import { ChatPanel } from "chat-ui";
import "chat-ui/styles";

const panel = new ChatPanel(rootElement, {
  onSubmit: (text) => host.send(text),
  onCompletion: (prefix) => host.requestCompletions(prefix),
});

// Stream agent updates
panel.addAgentMessage(content, source, sourceIcon, "block", requestId);
panel.setDisplayInfo(source, sourceIcon, action, requestId);

// Replay persisted history
panel.replayHistory(entries);
```

## Notes

- The package ships TypeScript sources and CSS. Hosts must bundle
  `chat-ui/styles` alongside their own stylesheets.
- Avatars come from a built-in `DEFAULT_AVATAR_MAP` (one emoji per known
  agent). Hosts may override via `setAvatarMap`.
- HTML in `DisplayContent` is sanitized with DOMPurify before insertion.

## Trademarks

This project may contain trademarks or logos for projects, products, or services. Authorized use of Microsoft
trademarks or logos is subject to and must follow
[Microsoft's Trademark & Brand Guidelines](https://www.microsoft.com/en-us/legal/intellectualproperty/trademarks/usage/general).
Use of Microsoft trademarks or logos in modified versions of this project must not cause confusion or imply Microsoft sponsorship.
Any use of third-party trademarks or logos are subject to those third-party's policies.
