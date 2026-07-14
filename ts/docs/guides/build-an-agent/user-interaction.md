# User interaction (`ActionIO` and display)

An agent's `executeAction` (and `executeCommand`) handler receives an
`ActionContext<T>`. The context exposes an `actionIO` object that is the
agent's channel for sending output back to the user - text, Markdown,
HTML, tables, status updates, progress. This page covers the display model,
the append modes, the message kinds, and the helper functions.

For the low-level type definitions, see
[`packages/agentSdk/src/display.ts`](https://github.com/microsoft/TypeAgent/blob/main/ts/packages/agentSdk/src/display.ts)
and the SDK
[README](https://github.com/microsoft/TypeAgent/blob/main/ts/packages/agentSdk/README.md#display-actioncontextactionio).

## The `ActionIO` surface

The methods on `context.actionIO` you should use:

```ts
interface ActionIO {
  setDisplay(content: DisplayContent): void;
  appendDisplay(content: DisplayContent, mode?: DisplayAppendMode): void;
  appendDiagnosticData(data: any): void;
}
```

- `setDisplay` replaces the current display block for this action with
  `content`.
- `appendDisplay` appends `content` to the display, using an append mode
  (default `"inline"`).
- `appendDiagnosticData` attaches diagnostic data (not surfaced to the
  user); useful for host-side logging.

### `actionIO` vs. `ActionResult`

`actionIO` is the **progressive** channel. Anything written through it
appears while the action is running.

The **value** you return from `executeAction` is the authoritative
`ActionResult` - dispatched, cached, and shown as the action's final
outcome. Prefer returning an `ActionResult` for the "answer" and using
`actionIO` for status updates, incremental progress, and rich UI that
the result type can't express (HTML fragments, iframes, tables).

See the helpers in
[`@typeagent/agent-sdk/helpers/action`](https://github.com/microsoft/TypeAgent/blob/main/ts/packages/agentSdk/src/helpers/actionHelpers.ts)
(`createActionResultFromTextDisplay`, `createActionResultFromError`, etc.).

## `DisplayContent`

Every write is a `DisplayContent`. In the simple case it is just a string
(or `string[]` for multi-line, `string[][]` for a table):

```ts
context.actionIO.appendDisplay("Hello.");
context.actionIO.appendDisplay(["Line 1", "Line 2"]);
context.actionIO.appendDisplay([
  ["Header A", "Header B"],
  ["row 1a", "row 1b"],
]);
```

For rich output, pass a `TypedDisplayContent` object:

```ts
context.actionIO.appendDisplay({
  type: "markdown",
  content: "Signed in as **Alice**",
  kind: "success",
});
```

Fields on `TypedDisplayContent`:

| Field        | Purpose                                                                                 |
| ------------ | --------------------------------------------------------------------------------------- |
| `type`       | `"text"`, `"markdown"`, `"html"`, or `"iframe"`. Host support varies; see below.        |
| `content`    | The message body (string, string array, or 2-D array for tables).                       |
| `kind`       | Optional [message kind](#message-kinds) - the host renders these with distinct styling. |
| `speak`      | If `true`, the host may read the content out via TTS.                                   |
| `alternates` | Fallback representations in other `type`s. The host picks whichever it supports best.   |

### `type` support

- `"text"` and `"markdown"` are universal. Text may include ANSI escape codes
  for color; hosts that do not support ANSI strip it.
- `"html"` is supported by the Shell (Electron) and other rich hosts;
  content is sanitised before rendering. The CLI falls back to alternates
  or the raw string.
- `"iframe"` is Shell-only.

Use `alternates` when you want the Shell to render HTML but the CLI to fall
back to text:

```ts
context.actionIO.appendDisplay({
  type: "html",
  content: "<strong>OK</strong>",
  alternates: [{ type: "text", content: "OK" }],
});
```

## Append modes

`appendDisplay` takes an optional `DisplayAppendMode`:

| Mode          | Meaning                                                                                              |
| ------------- | ---------------------------------------------------------------------------------------------------- |
| `"inline"`    | Default. Continues the previous inline chunk on the same visual line.                                |
| `"block"`     | New block, separated from surrounding messages by line breaks.                                       |
| `"temporary"` | Same as `"block"`, but the host replaces this chunk with whatever comes next. Good for status ticks. |
| `"step"`      | Starts a new distinct message container/bubble - used by reasoning to show each phase inline.        |

## Message kinds

`DisplayMessageKind` gives the host a semantic hint so it can style the
message consistently:

- `"info"` - neutral notice.
- `"status"` - transient status update (often paired with `"temporary"`).
- `"warning"` - user attention, non-fatal.
- `"error"` - the action failed or hit a recoverable problem.
- `"success"` - completion of a step.

Passing `kind` on a plain string requires the `TypedDisplayContent` object
form; the helpers below wrap this for you.

## Display helpers

`@typeagent/agent-sdk/helpers/display` wraps the common patterns so you
rarely write out `appendDisplay(..., { kind, ... })` by hand:

```ts
import {
  displayInfo,
  displayStatus,
  displayWarn,
  displayError,
  displaySuccess,
  displayResult,
} from "@typeagent/agent-sdk/helpers/display";

displayStatus("Logging in to calendar service...", context);
displaySuccess(`Signed in as ${user.displayName}`, context);
displayWarn("Already logged in.", context);
displayError("Login failed.", context);
```

- `displayStatus` uses append mode `"temporary"` so the message is replaced
  by the next write - use it for spinner-style progress.
- The others use `"block"` and apply the matching `kind`.
- `displayResult` writes with no kind or adornment.

Each helper also accepts a callback form for building multi-line messages
without concatenation:

```ts
displayInfo((log) => {
  log("Configuration:");
  log(`  endpoint: ${endpoint}`);
  log(`  model:    ${model}`);
}, context);
```

See [`displayHelpers.ts`](https://github.com/microsoft/TypeAgent/blob/main/ts/packages/agentSdk/src/helpers/displayHelpers.ts).

## Worked example

Adapted from the calendar agent's login flow (`calendarActionHandlerV3.ts`):

```ts
import {
  displayStatus,
  displaySuccess,
  displayWarn,
} from "@typeagent/agent-sdk/helpers/display";

async function handleLogin(context: ActionContext<CalendarContext>) {
  const provider = context.sessionContext.agentContext.provider;

  if (await provider.isLoggedIn()) {
    const user = await provider.getUser();
    displayWarn(`Already logged in as ${user.displayName}`, context);
    return;
  }

  displayStatus("Logging in to calendar service...", context);

  const ok = await provider.login((prompt) => {
    if (prompt.kind === "error") {
      displayWarn(prompt.message, context);
    } else {
      // Device-code / browser messages surface as status ticks.
      displayStatus(prompt.message, context);
    }
  });

  if (ok) {
    const user = await provider.getUser();
    displaySuccess(`Signed in as ${user.displayName}`, context);
  } else {
    displayWarn("Login failed.", context);
  }
}
```

Notice the shape: a `displayStatus` opens the operation, further
`displayStatus` messages replace it as work progresses, and a final
`displaySuccess` or `displayWarn` closes with a persistent result.

## Streaming a large result

For actions that produce output progressively (LLM completions, long
downloads), pair `actionIO` with `streamPartialAction` on the `AppAgent`
interface, or write chunks with `appendDisplay(..., "inline")`. The
`chat.generateResponse` action is the canonical streaming example. A
future sub-guide will cover streaming in depth; for now see
[`packages/agents/chat`](https://github.com/microsoft/TypeAgent/tree/main/ts/packages/agents/chat).

## Diagnostic data

`appendDiagnosticData(data)` attaches structured diagnostic data to the
current action. It is **not** shown to the user; hosts and dispatcher
tests use it for logging and assertions. Use it for internal timing,
retry counts, and provider responses that would be too noisy to display.

## Related

- [Build an agent](./index.md) - the overview for this section.
- [Agent SDK README - Display](https://github.com/microsoft/TypeAgent/blob/main/ts/packages/agentSdk/README.md#display-actioncontextactionio)
  for the type-level reference.
- [`display.ts`](https://github.com/microsoft/TypeAgent/blob/main/ts/packages/agentSdk/src/display.ts) -
  the `ActionIO`, `DisplayContent`, and `DisplayAppendMode` definitions.
- [`displayHelpers.ts`](https://github.com/microsoft/TypeAgent/blob/main/ts/packages/agentSdk/src/helpers/displayHelpers.ts) -
  the helper functions imported from `@typeagent/agent-sdk/helpers/display`.
