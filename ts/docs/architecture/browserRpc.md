# Browser RPC & Messaging Protocol

> **Scope:** This document covers the RPC and messaging infrastructure
> that connects the browser agent's distributed components: channel
> multiplexing, message format, connection lifecycle, the content script
> RPC adapter, and type-safe contracts. For the component architecture,
> see `browserAgent.md`. For scenario walkthroughs, see
> `browserScenarios.md`.

## Overview

The browser agent spans four processes connected by three communication
transports. The `@typeagent/agent-rpc` package provides the foundation:
channel multiplexing over a shared transport, typed request-response RPC,
and fire-and-forget messaging.

```
┌─────────────┐  WebSocket   ┌──────────────┐  chrome.tabs   ┌──────────────┐
│ Browser     │◄────────────▶│  Extension    │  .sendMessage  │  Content     │
│ Agent       │  (port 8081) │  Service      │◄──────────────▶│  Script     │
│ (Node.js)  │              │  Worker       │  (per-tab)     │  (per-tab)  │
└──────┬──────┘              └──────────────┘               └──────────────┘
       │
       │  WebSocket (port 8081)
       │
┌──────▼──────┐  IPC          ┌──────────────┐
│ Electron    │  (ipcMain/    │  WebContents  │
│ Main        │  ipcRenderer) │  (per-tab)    │
│ Process     │◄─────────────▶│              │
└─────────────┘               └──────────────┘
```

---

## Design Principles

These principles guide the RPC architecture:

### 1. Transport abstraction

The `ChannelAdapter` interface abstracts over all transports (WebSocket,
Chrome messaging, Electron IPC). Higher layers see only `send()`,
`on("message")`, and `on("disconnect")` — they don't know or care whether
the underlying transport is WebSocket or IPC.

> **Why this matters:** Adding a new transport (e.g., for a Firefox
> extension) requires only implementing a new `ChannelAdapter`, not
> changing any RPC or business logic.

### 2. Channel multiplexing

Multiple logical channels share a single physical connection. Each
channel has its own message handlers and can be created/destroyed
independently.

> **Design trade-off — why multiplex?** The alternative is one WebSocket
> per RPC channel. Multiplexing reduces connection overhead and simplifies
> connection state management. The cost is message routing overhead
> (negligible) and the need for a channel name in every message.

### 3. Type-safe contracts

RPC function signatures are defined as TypeScript interfaces
(`BrowserControlInvokeFunctions`, `BrowserAgentInvokeFunctions`). The
`createRpc()` function produces a `Proxy` that enforces these signatures
at compile time and serializes calls at runtime.

> **Why this matters:** A typo in an RPC method name or wrong parameter
> type is caught at build time, not discovered when the call fails at
> runtime.

### 4. Request-response pairing

Every `invoke()` call returns a `Promise` that resolves when the remote
side sends an `invokeResult` or `invokeError` with the matching `callId`.
Call IDs are monotonically increasing integers, unique per endpoint.

> **Design trade-off — why not message-based?** Pure message-passing
> requires manual correlation of requests and responses. Request-response
> pairing (like HTTP or gRPC) simplifies error handling and provides
> natural backpressure via pending promise count.

### 5. Keep-alive for MV3

WebSocket keep-alive pings every 20 seconds prevent the MV3 service
worker from going idle. The ping is counted as activity, resetting the
30-second idle timer.

> **Why this matters:** Without keep-alive, the service worker would
> terminate during idle periods, dropping the WebSocket connection. The
> agent would have to wait for the user to interact with the extension
> to trigger reconnection.

---

## The agent-rpc package

All RPC communication in the browser agent is built on `@typeagent/agent-rpc`,
which provides four layers of abstraction.

### Layer 1: Channel adapter

A `ChannelAdapter` wraps any transport (WebSocket, IPC, Chrome messaging)
into a uniform event-emitter interface:

```typescript
function createChannelAdapter(
  sendFunc: (message: any, cb?: (err: Error | null) => void) => void,
): {
  channel: RpcChannel;
  notifyMessage(message: any): void;
  notifyDisconnected(): void;
};
```

The `channel` property is an `RpcChannel` that supports:

- `on("message", handler)` / `off("message", handler)` — Listen for incoming messages
- `on("disconnect", handler)` — Listen for disconnection
- `send(message, cb?)` — Send a message via the wrapped transport

The `notifyMessage()` and `notifyDisconnected()` methods are called by the
transport layer when data arrives or the connection drops. This decouples
the RPC layer from any specific transport.

### Layer 2: Channel multiplexing

A `ChannelProviderAdapter` multiplexes multiple logical channels over a
single transport:

```typescript
function createChannelProviderAdapter(
  name: string,
  sendFunc: (message: any, cb?) => void,
): {
  createChannel(name: string): RpcChannel;
  deleteChannel(name: string): void;
  notifyMessage(message: any): void;
  notifyDisconnected(): void;
};
```

**Multiplexing protocol:**

Outgoing messages are wrapped with a channel name:

```json
{
  "name": "browserControl",
  "message": { "type": "invoke", "callId": 1, "name": "scrollDown", "args": [] }
}
```

Incoming messages are routed by `message.name` to the corresponding
channel's listeners:

```
channelProvider.notifyMessage(rawMessage)
    → rawMessage.name === "browserControl"
    → route to browserControl channel adapter
    → channel.emit("message", rawMessage.message)
```

### Layer 3: Typed RPC

The `createRpc()` function implements typed request-response and
fire-and-forget messaging over a channel:

```typescript
function createRpc<
  InvokeTargetFunctions, // Remote functions returning Promise
  CallTargetFunctions, // Remote fire-and-forget functions
  InvokeHandlers, // Local handlers for incoming invokes
  CallHandlers, // Local handlers for incoming calls
>(
  name: string,
  channel: RpcChannel,
  invokeHandlers?: InvokeHandlers,
  callHandlers?: CallHandlers,
): {
  invoke(name: string, ...args: any[]): Promise<any>;
  send(name: string, ...args: any[]): void;
};
```

**Message types:**

| Type           | Fields                      | Semantics                     |
| -------------- | --------------------------- | ----------------------------- |
| `invoke`       | `callId`, `name`, `args[]`  | Request expecting a response  |
| `invokeResult` | `callId`, `result`          | Successful response           |
| `invokeError`  | `callId`, `error`, `stack?` | Error response                |
| `call`         | `callId`, `name`, `args[]`  | Fire-and-forget (no response) |

`callId` is an auto-incrementing integer per RPC endpoint. For `invoke`,
the sender tracks a pending promise map:

```typescript
pending = new Map<number, { resolve; reject }>();
// On send: pending.set(callId, { resolve, reject })
// On result: pending.get(callId)?.resolve(result)
// On error: pending.get(callId)?.reject(new Error(error))
// On disconnect: reject all pending with "Agent channel disconnected"
```

### Layer 4: Agent RPC client/server

For agents running out-of-process, the package provides:

- `createAgentRpcClient(name, channelProvider, agentInterface)` — Creates
  a proxy `AppAgent` that forwards all calls over RPC
- `createAgentRpcServer(name, agent, channelProvider)` — Wraps a local
  `AppAgent` and exposes it via RPC

These use an **object ID mapping** pattern to serialize `SessionContext`
and `ActionContext` objects across process boundaries:

```typescript
// Client side: maps context objects to numeric IDs
contextMap.getId(context) → 42

// Sent over RPC as:
{ contextId: 42, hasInstanceStorage: true, hasSessionStorage: true }

// Server side: reconstructs a context shim from the ID
createSessionContextShim(42, true, true) → SessionContext proxy
```

The context shim proxies storage operations back to the client via RPC
(`storageRead`, `storageWrite`, `storageList`).

---

## Communication tiers

### Tier 1: Agent ↔ Extension (WebSocket)

The primary communication channel between the browser agent (Node.js) and
the Chrome extension (service worker).

**Connection:**

```
Extension connects to: ws://localhost:8081/?channel=browser&role=client&clientId=<extensionId>
```

**Channel setup:**

Both sides create a `ChannelProviderAdapter` over the WebSocket, then
create two logical channels:

| Channel          | Direction         | Types                                                          | Purpose                               |
| ---------------- | ----------------- | -------------------------------------------------------------- | ------------------------------------- |
| `browserControl` | Agent → Extension | `BrowserControlInvokeFunctions`, `BrowserControlCallFunctions` | Browser automation commands           |
| `agentService`   | Extension → Agent | `BrowserAgentInvokeFunctions`, `BrowserAgentCallFunctions`     | Knowledge, import, WebFlow operations |

**Agent side** (`agentWebSocketServer.mts`):

```typescript
// On client connection:
const channelProvider = createChannelProviderAdapter(
  "browser",
  ws.send.bind(ws),
);

// Browser control: agent invokes, extension handles
const browserControlChannel = channelProvider.createChannel("browserControl");
client.browserControlRpc = createRpc(
  browserControlChannel /* no local handlers */,
);

// Agent service: extension invokes, agent handles
const agentServiceChannel = channelProvider.createChannel("agentService");
client.agentRpc = createRpc(agentServiceChannel, agentInvokeHandlers, {
  importProgress(params) {
    /* forward to UI */
  },
  knowledgeExtractionProgress(params) {
    /* forward to UI */
  },
});
```

**Extension side** (`websocket.ts`):

```typescript
// On connection:
const channelProvider = createChannelProviderAdapter("browser", ws.send.bind(ws));

// Browser control: extension handles incoming commands
const browserControlChannel = channelProvider.createChannel("browserControl");
createExternalBrowserServer(browserControlChannel);

// Agent service: extension sends requests to agent
const agentServiceChannel = channelProvider.createChannel("agentService");
agentRpc = createRpc(agentServiceChannel, /* no local handlers */, {
    importProgress(params) { /* update UI */ },
    knowledgeExtractionProgress(params) { /* update UI */ }
});
```

**Message routing:**

```
ws.onmessage = (event) => {
    const message = JSON.parse(event.data);
    if (message.method === "keepAlive") return;     // Ignore keep-alive
    channelProvider.notifyMessage(message);           // Route by message.name
};
```

### Tier 2: Service worker ↔ Content script (Chrome messaging)

Communication between the extension service worker and per-tab content
scripts for DOM interaction.

**Transport:** `chrome.tabs.sendMessage()` (service worker → content
script) and `chrome.runtime.sendMessage()` (content script → service
worker), targeting `frameId: 0` (main frame only).

**RPC setup** (`externalBrowserControlServer.ts`):

The service worker maintains a per-tab RPC map:

```typescript
const rpcMap = new Map<
  number,
  {
    channel: ChannelAdapter;
    contentScriptRpc: ContentScriptRpc;
  }
>();
```

On first use for a tab, it creates a channel adapter wrapping
`chrome.tabs.sendMessage()`:

```typescript
const { channel, notifyMessage } = createChannelAdapter(async (message, cb) => {
  try {
    await chrome.tabs.sendMessage(
      tabId,
      { type: "rpc", message },
      { frameId: 0 },
    );
  } catch (error) {
    // Content script missing — inject and retry
    await injectContentScripts(tabId);
    await chrome.tabs.sendMessage(
      tabId,
      { type: "rpc", message },
      { frameId: 0 },
    );
  }
});
```

Incoming RPC responses are routed back by tab ID:

```typescript
chrome.runtime.onMessage.addListener((message, sender) => {
  if (message.type === "rpc") {
    rpcMap.get(sender.tab.id)?.channel.notifyMessage(message.message);
  }
});
```

**ContentScriptRpc interface:**

```typescript
type ContentScriptRpc = {
  scrollUp(): Promise<void>;
  scrollDown(): Promise<void>;
  getPageLinksByQuery(query: string): Promise<string | undefined>;
  getPageLinksByPosition(position: number): Promise<string | undefined>;
  clickOn(cssSelector: string): Promise<any>;
  setDropdown(cssSelector: string, optionLabel: string): Promise<any>;
  enterTextIn(
    textValue: string,
    cssSelector?: string,
    submitForm?: boolean,
  ): Promise<any>;
  awaitPageLoad(timeout?: number): Promise<string>;
  awaitPageInteraction(timeout?: number): Promise<void>;
  runPaleoBioDbAction(action: any): Promise<void>;
};
```

**Auto-injection:** If a `sendMessage` call fails because the content
script isn't loaded (extension was reloaded, new tab), the service worker
automatically injects `contentScript.js` via `chrome.scripting.executeScript()`
and retries.

### Tier 3: Agent ↔ Dispatcher (AppAgent interface)

The browser agent runs in-process with the dispatcher, so this tier uses
direct function calls rather than RPC. The dispatcher calls the agent's
`AppAgent` methods directly:

- `initializeAgentContext()` → `initializeBrowserContext()`
- `updateAgentContext()` → `updateBrowserContext()`
- `executeAction()` → `executeBrowserAction()`
- `resolveEntity()` → entity resolution for `WebPageMoniker`/`WebSearchResult`
- `getDynamicDisplay()` → live rendering of knowledge extraction progress
- `getDynamicGrammar()` → WebFlow grammar rules
- `getDynamicSchema()` → WebFlow action schemas

### Tier 4: Electron shell ↔ Agent (WebSocket listener)

The Electron shell connects to the same WebSocket server (port 8081) as a
secondary client, primarily for UI updates.

**Connection** (`browserIpc.ts`):

`BrowserAgentIpc` is a singleton that manages the shell's WebSocket
connection:

```typescript
class BrowserAgentIpc {
  static getInstance(): BrowserAgentIpc;
  async ensureWebsocketConnected(): Promise<WebSocket | undefined>;
  async send(message: WebSocketMessageV2): Promise<void>;
  isConnected(): boolean;

  onMessageReceived: ((message) => void) | null; // Browser events
  onRpcReply: ((message) => void) | null; // Agent context calls
  onSendNotification: ((message, id) => void) | null;
}
```

**Message routing:**

```
if (message.name === "agentService")     → onRpcReply (agent context)
if (schema starts with "browser")        → onMessageReceived (browser events)
if (method === "importProgress")         → onMessageReceived (progress)
```

**Message queue:** When the WebSocket is not connected, messages are
queued (up to 100) and flushed on reconnection.

**Reconnection:** Exponential backoff starting at 1 second, capping at
5 seconds.

### Tier 5: Electron main ↔ Content script (IPC)

When the Electron host provides browser control, DOM interactions use
Electron IPC instead of Chrome messaging:

```typescript
// Send to content script
webContents.send("inline-browser-rpc-call", message);

// Receive from content script
ipcMain.on("inline-browser-rpc-reply", (event, message) => {
  contentScriptRpcChannel.notifyMessage(message);
});
```

This uses the same `createChannelAdapter()` and `createContentScriptRpcClient()`
as the extension path, so the content script RPC interface is identical
regardless of which backend is active.

---

## Connection lifecycle

### Extension WebSocket connection

```
┌─────────────┐                    ┌─────────────────┐
│  Extension   │                    │  Agent Server    │
│  (SW)        │                    │  (port 8081)     │
└──────┬───────┘                    └────────┬────────┘
       │                                      │
       │──── WebSocket CONNECT ──────────────▶│
       │     ?channel=browser&role=client      │
       │     &clientId=<extensionId>          │
       │                                      │
       │◀─── welcome { connected: true } ─────│
       │                                      │
       │──── Channel setup ──────────────────▶│
       │     browserControl channel            │
       │     agentService channel              │
       │                                      │
       │◀──▶ RPC messages (multiplexed) ◀────▶│
       │                                      │
       │──── keepAlive (every 20s) ──────────▶│
       │                                      │
       │◀─── WebSocket CLOSE ─────────────────│
       │     reason: "duplicate" → no retry   │
       │     other → reconnect (5s interval)  │
       │                                      │
       │──── Reconnect attempt ──────────────▶│
       │     (repeat until success)           │
       └──────────────────────────────────────┘
```

### State management

**Extension side:**

```typescript
let webSocket: WebSocket | undefined;
let channelProvider: ChannelProviderAdapter | undefined;
let agentRpc: RpcProxy | undefined;
let connectionInProgress: boolean = false;
```

**Agent side:**

```typescript
// Per-client state
interface BrowserClient {
  id: string;
  type: "extension" | "electron";
  socket: WebSocket;
  connectedAt: Date;
  lastActivity: Date;
  channelProvider?: ChannelProviderAdapter;
  agentRpc?: RpcProxy;
  browserControlRpc?: RpcProxy;
}

// Server state
clients: Map<string, BrowserClient>;
activeClient: BrowserClient | null;
```

### Keep-alive protocol

The extension sends a `keepAlive` message every 20 seconds to prevent
WebSocket timeout:

```json
{ "method": "keepAlive", "params": {} }
```

The agent server filters these messages before routing to channel handlers.

### Status broadcasting

On connection state changes, the extension broadcasts to all open
extension pages (side panel, library views, options):

```typescript
broadcastConnectionStatus(connected: boolean): void
// Sends to all tabs: { type: "connectionStatusChanged", connected, timestamp }
```

---

## RPC function contracts

### BrowserAgentInvokeFunctions (Extension → Agent)

These are the methods the extension can call on the agent:

**Knowledge extraction and indexing:**

- `extractKnowledgeFromPage(params)` — Extract entities, topics, relationships
- `indexWebPageContent(params)` — Index page for search
- `checkPageIndexStatus(params)` — Check if page is indexed
- `getPageIndexedKnowledge(params)` — Retrieve indexed knowledge
- `getKnowledgeIndexStats(params)` — Index statistics

**Knowledge search:**

- `searchWebMemories(params)` — Keyword search with optional answer generation
- `searchByEntities(params)` — Entity-based search
- `searchByTopics(params)` — Topic-based search
- `hybridSearch(params)` — Combined search strategy

**Knowledge graph:**

- `buildKnowledgeGraph(params)` — Build graph from index
- `getGlobalGraphLayoutData(params)` — Graph visualization data
- `getEntityNeighborhood(params)` — Entity relationship subgraph
- `getHierarchicalTopics(params)` — Topic hierarchy

**Import/export:**

- `importWebsiteDataWithProgress(params)` — Import bookmarks/history
- `importHtmlFolder(params)` — Batch import HTML files
- `clearKnowledgeIndex(params)` — Clear all indexed data

**WebFlow management:**

- `createWebFlowFromRecording(params)` — Generate WebFlow from recording
- `getWebFlowsForDomain(params)` — List flows for a domain
- `getAllWebFlows(params)` — List all flows
- `deleteWebFlow(params)` — Delete a flow

**Navigation:**

- `handlePageNavigation(params)` — Notify agent of page navigation

### BrowserAgentCallFunctions (Agent → Extension, fire-and-forget)

- `importProgress(params)` — Import progress update
- `knowledgeExtractionProgress(params)` — Extraction progress update

### BrowserControlInvokeFunctions (Agent → Extension)

All methods from the `BrowserControl` interface (see `browserAgent.md`
for the full list): navigation, content access, element interaction,
view control, settings.

### BrowserControlCallFunctions (Agent → Extension, fire-and-forget)

- `setAgentStatus(isBusy, message)` — Update extension badge/status

### ExtensionLocalInvokeFunctions (internal to extension)

Methods handled entirely within the service worker:

- `checkWebSocketConnection()` — Connection status
- `initialize()` — Trigger initialization
- `takeScreenshot()` — Capture via CDP
- `saveRecordedActions(params)` / `getRecordedActions()` — Recording state
- `settingsUpdated(params)` — Apply new settings
- `autoIndexSettingChanged(params)` — Toggle auto-indexing

### ChatPanelInvokeFunctions (Side panel → Service worker)

- `chatPanelConnect()` — Connect to dispatcher
- `chatPanelProcessCommand(params)` — Send NL command
- `chatPanelGetCompletions(params)` — Get autocomplete suggestions
- `chatPanelStartRecording()` / `chatPanelStopRecording()` — Recording control
- `chatPanelCreateWebFlowFromRecording(params)` — Generate WebFlow

---

## Custom protocol handling

The extension implements a custom `typeagent-browser://` protocol for
internal navigation:

```typescript
function resolveCustomProtocolUrl(url: string): string;
// Maps: typeagent-browser://knowledgeLibrary.html
//    → chrome-extension://<extensionId>/views/knowledgeLibrary.html
// Preserves query parameters
```

This allows the agent to open extension views (knowledge library, graph
views) via the same `openWebPage()` mechanism used for regular URLs.

---

## Error handling patterns

### Content script injection recovery

When a `chrome.tabs.sendMessage()` call fails because the content script
isn't loaded:

```
1. sendMessage fails with "Could not establish connection"
2. Service worker calls chrome.scripting.executeScript({
       target: { tabId },
       files: ["contentScript.js"]
   })
3. Retry the original sendMessage
```

### WebSocket reconnection

On unexpected WebSocket close (not "duplicate" reason):

```
1. Clear channel provider and RPC state
2. Start reconnection timer (5-second interval)
3. Update badge to show disconnected state
4. Broadcast connectionStatusChanged(false) to extension pages
5. On successful reconnect: flush message queue, restore state
```

### RPC timeout and disconnect

When the WebSocket disconnects while RPC calls are pending:

```
1. channelProvider.notifyDisconnected() fires
2. All pending invoke promises are rejected with "Agent channel disconnected"
3. Callers receive the rejection and can retry or report to user
```

---

## WebAgent relay protocol

WebAgents communicate with the dispatcher through a relay chain:

```
WebAgent (MAIN world)
    ↓ chrome.runtime.connect({ name: "typeagent" })
Service Worker (port listener)
    ↓ WebSocket message
Browser Agent
    ↓ handleWebAgentRpc() / addDynamicAgent()
Dispatcher
```

### Port protocol messages

| Method                | Direction             | Payload                                               |
| --------------------- | --------------------- | ----------------------------------------------------- |
| `webAgent/register`   | WebAgent → Dispatcher | `{ agentName, url, tabId, frameId, schema, grammar }` |
| `webAgent/disconnect` | WebAgent → Dispatcher | `{ agentNames[] }`                                    |
| (other)               | Bidirectional         | Relayed verbatim between WebAgent and dispatcher      |

The service worker injects `tabId` and `frameId` into registration
messages from the `sender` metadata provided by `chrome.runtime.onConnect`.

### Message type guards

```typescript
isWebAgentMessage(message); // Messages FROM a WebAgent
isWebAgentMessageFromDispatcher(message); // Messages FROM the dispatcher TO a WebAgent
```

These guards are used to filter and route messages at the service worker
relay point.

---

## Invariants

These conditions must hold for the RPC system to function correctly.
Violations typically manifest as silent failures or confusing state.

### Connection invariants

**#1 — Single active connection per client type.**
At most one WebSocket connection from each client type (extension or
Electron) to the agent is active at any time. Duplicate connections
cause the older one to close with code 1013, reason `"duplicate"`.

_Impact of violation:_ Message ordering violations, duplicate event
delivery, state inconsistency between old and new connections.

**#2 — Message ordering within channel.**
Messages within a single logical channel (e.g., `browserControl`) are
delivered in order. The WebSocket transport guarantees this; the
channel multiplexer preserves it.

_Impact of violation:_ Out-of-order messages cause extraction progress
to appear non-monotonic, action results to arrive before the action
completes, or WebFlow steps to execute in wrong order.

**#3 — Request-response pairing.**
Every RPC `invoke` request receives exactly one response (`invokeResult`
or `invokeError`). The `callId` is unique per endpoint and monotonically
increasing within a session.

_Impact of violation:_ Missing responses cause client-side promise leaks
and eventual memory exhaustion. Duplicate responses cause unpredictable
promise resolution.

### State invariants

**#4 — Service worker RPC map consistency.**
The service worker's `rpcMap: Map<tabId, { channel, contentScriptRpc }>`
reflects exactly the set of tabs with active content scripts. An entry
is added on first RPC to a tab and removed on `chrome.tabs.onRemoved`.

_Impact of violation:_ Stale entries cause RPC calls to be sent to
closed tabs (harmless — Chrome returns error). Missing entries cause
unnecessary content script re-injection.

**#5 — Recording state durability.**
Active recording state (`recordedActions`, `actionIndex`, etc.) is
persisted to `chrome.storage.session` within 1 second of each captured
action. The content script calls `saveRecordedActions()` after each
`recordClick`, `recordInput`, etc.

_Impact of violation:_ Service worker restart during recording loses
captured actions since the last save. Short rapid interactions (< 1s
apart) are more vulnerable.

**#6 — Channel provider lifecycle.**
A `ChannelProviderAdapter` is created exactly once per WebSocket
connection. On disconnect, `notifyDisconnected()` must be called to
reject all pending RPC promises.

_Impact of violation:_ If `notifyDisconnected()` is not called, pending
promises hang forever, leaking memory and causing timeouts to appear
as hangs.

### Content script invariants

**#7 — RPC target frame.**
All content script RPC calls target `frameId: 0` (main frame only).
The `chrome.tabs.sendMessage()` call includes `{ frameId: 0 }`.

_Impact of violation:_ Without `frameId`, Chrome broadcasts to all
frames, causing duplicate handling in iframes or cross-origin errors.

**#8 — Auto-injection recovery.**
If `chrome.tabs.sendMessage()` fails with "Could not establish
connection", the service worker injects `contentScript.js` via
`chrome.scripting.executeScript()` and retries exactly once.

_Impact of violation:_ Without retry, pages that load before the
extension initializes (or after extension reload) appear unresponsive.
Multiple retries without limit could cause injection storms.

### WebAgent invariants

**#9 — Registration before action.**
A WebAgent must send `webAgent/register` before the dispatcher can
route actions to it. The dispatcher rejects actions for unregistered
agent names.

_Impact of violation:_ Race condition where user issues a command
before the WebAgent finishes initializing. The command fails with
"Unknown agent" error.

**#10 — Deregistration on unload.**
WebAgents must send `webAgent/disconnect` on page `beforeunload`.
The dispatcher removes the dynamic agent and clears its grammar.

_Impact of violation:_ Stale agent registration causes grammar matches
to route to a WebAgent that no longer exists. The RPC call hangs until
timeout.

---

## Error Handling & Recovery

This section documents error handling patterns and recovery procedures
for common failure modes.

### WebSocket connection errors

| Error                         | Cause                           | Recovery                                     |
| ----------------------------- | ------------------------------- | -------------------------------------------- |
| Connection refused            | Agent server not running        | Extension auto-retries every 5 seconds       |
| Connection closed (code 1013) | Duplicate client connection     | No retry needed — newer connection took over |
| Connection closed (other)     | Network issue or server restart | Auto-reconnect with 5-second interval        |
| Handshake timeout             | Server overloaded               | Retry with exponential backoff               |

**Recovery procedure:**

```
1. On WebSocket close:
   - If code === 1013 (duplicate): do nothing, newer connection is active
   - Otherwise: set reconnect timer for 5 seconds

2. On reconnect:
   - Create new WebSocket with same URL
   - Re-establish channel provider and RPC proxies
   - Flush any queued messages (Electron only)
```

### Content script RPC errors

| Error                            | Cause                           | Recovery                                           |
| -------------------------------- | ------------------------------- | -------------------------------------------------- |
| "Could not establish connection" | Content script not injected     | Auto-inject via `chrome.scripting.executeScript()` |
| Message timeout (30s)            | Content script crashed or stuck | Retry once, then report error                      |
| "Receiving end does not exist"   | Tab closed during RPC           | Abort RPC, clean up tab state                      |
| "Invalid tab ID"                 | Tab was closed                  | Return error to caller                             |

**Auto-injection logic** (`externalBrowserControlServer.ts`):

```typescript
async function ensureContentScript(tabId: number): Promise<void> {
  try {
    await chrome.tabs.sendMessage(tabId, { type: "ping" });
  } catch {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["contentScript.js"],
    });
  }
}
```

### RPC timeout handling

Default timeouts:

- Content script RPC: 30 seconds
- WebFlow RPC: 30 seconds
- WebAgent RPC: 60 seconds
- WebFlow script execution: 180 seconds

**Timeout recovery:**

```
1. Promise rejects with TimeoutError
2. Caller decides whether to retry or report to user
3. For user-facing actions: show "Operation timed out" message
4. For background operations: log warning, continue
```

### WebAgent communication errors

| Error                    | Cause                               | Recovery                                       |
| ------------------------ | ----------------------------------- | ---------------------------------------------- |
| Port disconnected        | Page navigation                     | WebAgent deregisters, user retries on new page |
| Message not acknowledged | Content script relay failed         | Retry message once                             |
| Agent not registered     | Race between navigation and command | Wait for page load, retry                      |

**Port lifecycle:**

```
1. WebAgent calls chrome.runtime.connect({ name: "typeagent" })
2. Service worker adds port to port map
3. On port.onDisconnect:
   - Remove from port map
   - Send webAgent/disconnect to agent
   - Dispatcher removes dynamic agent
```

### Graceful degradation

When the extension is not connected (red badge), the agent degrades
gracefully:

| Capability           | Behavior when disconnected                             |
| -------------------- | ------------------------------------------------------ |
| Browser control      | Falls back to Electron (if available) or reports error |
| Knowledge extraction | Queues request, processes when reconnected             |
| WebFlow recording    | Disabled (requires content script)                     |
| WebAgent actions     | Disabled (requires in-page agent)                      |

### Debugging RPC failures

**Enable debug logging:**

```bash
# Agent side
DEBUG=typeagent:browser:* pnpm run cli:dev

# Extension side (in service worker DevTools console)
localStorage.setItem('debug', 'typeagent:*');
```

**Key log patterns:**

- `"WS connected"` — WebSocket established
- `"Channel setup complete"` — RPC channels ready
- `"invoke: <name>"` — RPC call initiated
- `"invokeResult: <callId>"` — RPC call completed
- `"invokeError: <callId>"` — RPC call failed
