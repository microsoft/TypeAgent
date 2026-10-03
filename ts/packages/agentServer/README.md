# agentServer

The agentServer hosts a **TypeAgent dispatcher over WebSocket**, allowing multiple clients (Shell, CLI, extensions) to share a single running dispatcher instance with full conversation management. It is split into three sub-packages:

| Package     | npm name                | Purpose                                                                                |
| ----------- | ----------------------- | -------------------------------------------------------------------------------------- |
| `protocol/` | `agent-server-protocol` | RPC channel names, conversation types, client-type registry                            |
| `client/`   | `agent-server-client`   | Client library: connect, conversation management, auto-spawn, stop                     |
| `server/`   | `agent-server`          | Long-running WebSocket server with `ConversationManager` and per-conversation dispatch |

---

## Runbook host capabilities

Both WebSocket and embedded hosts inject the named, plain-object
`RunbookHostCapabilities` (`@typeagent/agent-server-protocol`) into browser
initialization as `runbookCapabilities`. Agent RPC proxies its callable
functions; no manager instances, arbitrary server methods, execution methods,
credentials or schema-validator functions are exposed.

- `listSkills` is metadata-only, paginated (`limit` 1–200, default 100;
  nonnegative `offset`). `getSkill` and `readSkillFile` read the existing catalog.
- `previewProcedureArtifact`/`promoteProcedureArtifact` support only `kind:
"skill"` and an explicit saved procedure version. The existing coordinator
  verifies lineage/artifact hashes and publishes a **draft**, never an approval.
  Accepted catalog bindings are revalidated before preview/publication.
- `getSkillLifecycle({identity, revision})` returns the exact entry and the
  catalog's real `allowedTransitions`/`allowedActions`. `changeSkillLifecycle`
  requires that immutable revision plus `expectedState` and `expectedActive`.
  Conflicting concurrent reviews fail atomically; refresh rather than retrying
  against a different revision. Validation checks manifest integrity and
  compiles package grammars; it is not a security certification.
- `listBindingTargets` returns bounded target metadata with explicit notices.
  MCP identities are the real `JSON.stringify([serverConfigId, toolName])`,
  with the current tool fingerprint as `version` and `fingerprint`.
  `getCurrentMcpToolCatalogs` reads registered source-owned current catalogs,
  without connecting/discovering servers. An unloaded/missing catalog is
  explicitly unavailable. Tool annotations are hints, not permission grants.
  Snapshots retain actual configured allow/deny/unset decisions and prompt
  requirements without session grants; configured-denied tools are excluded
  with notices. Live runtime permission checks still remain authoritative.
  Public selection IDs remain the exact compound catalog IDs. The gateway
  verifies/decodes that selected identity before storing canonical
  `targetId = actual tool.name` and `serverId = serverConfigId`. No display
  title is used. The host qualifies those components against their explicit
  server and checks the current catalog; it never searches across servers by
  a bare name. A defensive direct-compound callback path preserves only
  canonical two-string JSON pairs with the exact server; this does not relax
  the canonical store's component-identifier requirements.
- Macro targets use the current approved immutable macro ID/version and a
  canonical input/step fingerprint. Draft/disabled/suppressed, agent-required
  and secret-input macros are excluded. Secret-input MCP schemas are excluded.
  Flows are **not** binding targets: existing flow catalogs do not provide
  immutable, approved version snapshots; visible/active does not mean approved.
- `suggestBindings({inputSchema, commandText?})` ranks approved automation,
  MCP, command text, then manual, with reasons. Schema-fit suggestions are
  advisory, not complete JSON Schema validation. `checkBindingTargets` reports
  missing targets/current-version/schema drift without executing anything.

Binding checks retain `arguments?: Record<string, unknown>` on each
`RunbookBindingReference`; omitted arguments mean `{}`, not an approval bypass.
Concrete arguments are validated against the actual current catalog JSON
Schema, including required fields, types and constraints, using the same
compiler as the live MCP catalog. Shared canonical limits are 65,536 UTF-16
units per string, 128 KiB UTF-8 encoded JSON, 10,000 nodes and depth 16. Non-finite/non-JSON
values, unsafe keys, accessors, proxies and custom containers are rejected.
The checker returns `code: "invalidArguments"` for invalid arguments.

Symbolic templates use **exactly** `{ "$input": "edition-input-id" }`, including
inside nested objects/arrays. Exact `{ "$literal": jsonValue }` argument values
escape literal JSON that would otherwise look like a template; the parameter
map itself always retains its parameter names. Supply the edition's declared
`inputs` to `checkBindingTargets`; these are authoritative over the legacy
`inputSchema` compatibility field. References must name non-secret required
inputs and prove target-schema fit for every declared value. Defaults and
examples are never substituted or used as proxy validation values.
Bounded enums are checked exhaustively; unconstrained primitive types and
fixed object/array structure can be proven statically. Actual concrete
portions receive full schema validation. Conditional, composed/ref-based and
other unprovable symbolic schemas return `"unavailable"`: use reviewed
concrete values or retain a manual step. No synthetic witness or sample
argument is used as proof, and templates are never executed or substituted
into persisted bindings. Future runtime values still require live validation.
The durable-memory
validator receives `{ inputs: edition.inputs }` context from the canonical
edition service; missing context makes symbolic bindings unavailable.

Readiness includes indexed `argumentChecks` only after actual schema fit.
Each proof echoes the exact reference/arguments and sets
`argumentsValidated: true`. The canonical callback requires exactly one
matching proof before returning an accepted result with that attestation;
identity-only readiness cannot approve arguments. Catalog-bound editions
reviewed before argument attestation require explicit re-review.

Binding acceptance must explicitly confirm author intent and safety, then
revalidate the target immediately. Both owned durable-memory services receive
the real `RunbookBindingValidator`; absent providers fail closed. Embedded
callers injecting their own memory service must configure its validator
themselves. Persisted drift belongs in readiness/Inbox, not automatic execution
or approval.

### Configured image evidence

Both owned hosts use the same durable-memory factory and lazy configured
runbook synthesizer. Unknown or unsupported image capability remains
**disabled/manual**, even when `describeImages` is selected.

The current AI client has no reliable offline vision-capability metadata on
configured deployments or model pools. Its legacy
`modelResource.isMultiModalContentSupported` recognizes only model-name
heuristics (including an assumed empty default); it is not a reliable
capability check. Copilot model discovery contacts the CLI and can select a
fallback model. Hosts do not run discovery, create a model, retrieve keys or
make model calls to guess capability at startup.

For an operator-verified image-capable route, configure these host environment
variables **before starting either host**:

```powershell
$env:TYPEAGENT_RUNBOOK_MODEL_ENDPOINT = "azure:YOUR_VERIFIED_VISION_DEPLOYMENT"
$env:TYPEAGENT_RUNBOOK_MULTIMODAL = "true"
```

This is an explicit host capability **declaration**, not automatic discovery.
The selected route must already be configured through normal AI-client
configuration; the existing endpoint getter checks configuration presence,
not vision support or actual model availability. Copilot/Ollama routes are
registered by provider rather than validated through model discovery; OpenAI
checks endpoint presence rather than a named model's capabilities.
The operator must verify image-input support for the
actual selected model and every pool/fallback route. Missing scoped endpoints,
unconfigured declared routes and malformed declarations fail explicitly.
An enabled declaration requires an explicit `provider:named-model` selector;
implicit provider routing and default aliases are not accepted.
Omitting the declaration, or setting it to `"false"`, keeps images manual.
The endpoint can also select a text-only model while leaving images disabled.

The factory forwards the same endpoint to `runbookModelEndpoint` and the
declaration to `runbookMultimodal`; there is no hardcoded image-capable default.
The ingestion service still requires the user's `describeImages` preference,
retained revision/asset evidence and explicit review. A vision-capable model
does not make original pixels a safe preview, accept bindings, approve a skill
or qualify model-quality/golden-set results. Callers injecting their own
memory service configure those `FileMemoryServiceOptions` themselves.

---

## Architecture

```
Shell (Electron)              CLI (Node.js)
   │  in-process (default)       │  always remote
   │  OR WebSocket               │
   └──────────────┬──────────────┘
                  │ ws://localhost:8999
         ┌────────▼────────┐
         │   agentServer   │
         │                 │
         │ ConversationManager│
         │  ┌────────────┐ │
         │  │ Convo A    │ │  ← clients 0, 1
         │  │ Dispatcher │ │
         │  ├────────────┤ │
         │  │ Convo B    │ │  ← client 2
         │  │ Dispatcher │ │
         │  └────────────┘ │
         └─────────────────┘
```

Each conversation has its own `SharedDispatcher` instance with isolated chat history, conversation memory, display log, and persist directory. Clients connected to the same conversation share one dispatcher; clients in different conversations are fully isolated.

### RPC channels per connection

Each WebSocket connection multiplexes independent JSON-RPC channels:

| Channel                       | Direction       | Purpose                                                                           |
| ----------------------------- | --------------- | --------------------------------------------------------------------------------- |
| `agent-server`                | client → server | Conversation lifecycle: `joinConversation`, `leaveConversation`, CRUD, `shutdown` |
| `dispatcher:<conversationId>` | client → server | Commands: `submitCommand`, `getCommandCompletion`, etc.                           |
| `clientio:<conversationId>`   | server → client | Display/interaction callbacks: `setDisplay`, `askYesNo`, etc.                     |

The dispatcher and clientIO channels are namespaced by `conversationId`, allowing a single WebSocket connection to participate in multiple conversations simultaneously.

> **Breaking change (2026-05).** The legacy `processCommand` RPC method on the `dispatcher:<conversationId>` channel was removed. All callers must use `submitCommand` and await the synthesized `completion` promise returned by `createDispatcherRpcClient` (or use the `awaitCommand` helper). Clients and servers from before this change are not wire-compatible. See [`docs/architecture/core/messageQueueing.md`](../../docs/architecture/core/messageQueueing.md) §14.1.

---

## Starting and stopping the server

### With pnpm (recommended)

From the `ts/` directory:

```bash
# Build (if not already built)
pnpm run build agentServer

# Start
pnpm --filter agent-server start

# Start with a named config (e.g. loads config.test.json)
pnpm --filter agent-server start -- --config test

# Stop (sends shutdown via RPC)
pnpm --filter agent-server stop
```

### With node directly

```bash
# From the repo root
node --disable-warning=DEP0190 ts/packages/agentServer/server/dist/server.js

# With optional config name
node --disable-warning=DEP0190 ts/packages/agentServer/server/dist/server.js --config test
```

The server listens on `ws://localhost:8999` and logs `Agent server started at ws://localhost:8999` when ready.

---

## Conversation lifecycle

```
Client calls joinConversation({ conversationId?, clientType, filter })
  │
  ├─ conversationId provided?
  │   ├─ Yes → look up conversations.json
  │   │   ├─ Found → load SharedDispatcher (lazy init if not in memory)
  │   │   └─ Not found → error: "Conversation not found"
  │   └─ No → connect to the default conversation
  │       └─ No conversations exist → auto-create conversation named "default"
  │
  ├─ Register client in conversation's SharedDispatcher routing table
  └─ Return { connectionId, conversationId }
```

Conversation dispatchers are automatically evicted from memory after 5 minutes with no connected clients.

---

## Connection lifecycle

```
Client calls ensureAgentServer(port, hidden)
  │
  └─ Is server already listening on ws://localhost:<port>?
      └─ No → spawnAgentServer() — detached child process, survives parent exit
               hidden=true suppresses the terminal/window

Client calls connectAgentServer(url)
  │
  ├─ Open WebSocket → create RPC channels
  │
  ├─ Send joinConversation({ conversationId, clientType, filter }) on agent-server channel
  │   └─ Server assigns connectionId, returns { connectionId, conversationId }
  │
  └─ Return AgentServerConnection (call .joinConversation() to get a Dispatcher proxy)
```

On disconnect, the server removes all of that connection's conversations from its routing table.

---

## Shell integration

[`packages/shell/src/main/instance.ts`](../shell/src/main/instance.ts) supports two modes:

**Standalone (default)** — dispatcher runs in-process inside the Electron main process.

```
Chat UI (renderer) ↔ IPC ↔ Main process ↔ in-process Dispatcher
```

**Connected (`--connect <port>`)** — connects to a running agentServer.

```
Chat UI (renderer) ↔ IPC ↔ Main process ↔ WebSocket ↔ agentServer
```

---

## CLI integration

The CLI ([`packages/cli/`](../cli/)) always uses remote connection via WebSocket.

```
Terminal ↔ ConsoleClientIO ↔ WebSocket ↔ agentServer
```

### `agent-cli connect` (interactive)

`connect` calls `ensureAgentServer(port, hidden, idleTimeout)` to auto-spawn the server if needed, then calls `connectAgentServer()` and `joinConversation()` directly. By default the spawned server window is visible; pass `--hidden` to suppress it. Pass `--idle-timeout <seconds>` to enable idle shutdown when spawning (default: `0`, server stays alive indefinitely).

### `agent-cli run` (non-interactive)

The `run request`, `run translate`, and `run explain` subcommands also call `ensureAgentServer()` — but default to **hidden** (no window), with `--show` to opt into a visible window. All three support `--conversation <id>` to target a specific conversation instead of the default `"CLI"` conversation. When spawning, passes `--idle-timeout 600` so the server exits 10 minutes after the last client disconnects.

### `agent-cli replay`

`replay` always creates an ephemeral conversation (`cli-replay-<uuid>`) and deletes it on exit. Defaults to hidden; `--show` to opt in. Also passes `--idle-timeout 600` when spawning.

### `agent-cli server`

```bash
agent-cli server status    # check whether the server is running
agent-cli server stop      # send a graceful shutdown via RPC
```

---

## Startup scenarios

**Shell standalone (default)**

```
Shell launches → createDispatcher() in-process → no server involved
```

**Shell or CLI — server already running**

```
Client → ensureAgentServer(port=8999, hidden)
       → server already running → no-op
Client → connectAgentServer() → joinConversation() → Dispatcher proxy
```

**Shell or CLI — server not yet running**

```
Client → ensureAgentServer(port=8999, hidden, idleTimeout)
       → server not found → spawnAgentServer() (hidden or visible window)
       → poll until ready (60 s timeout)
Client → connectAgentServer() → joinConversation() → Dispatcher proxy
```

**Headless server**

```
pnpm --filter agent-server start
→ listens on ws://localhost:8999
→ any number of Shell/CLI clients can connect and share conversations
```

**Stopping the server**

```bash
agent-cli server stop              # via CLI (recommended)
pnpm --filter agent-server stop    # via pnpm script
```

---

## Conversation persistence

Conversation metadata is stored at `~/.typeagent/profiles/dev/conversations/conversations.json`. Each conversation's data (chat history, conversation memory, display log) lives under `~/.typeagent/profiles/dev/conversations/<conversationId>/`.

---

## Sub-package details

- [protocol/README.md](protocol/README.md) — channel names, RPC types, conversation types, client-type registry
- [client/README.md](client/README.md) — `connectAgentServer`, `ensureAndConnectConversation`, `stopAgentServer`
- [server/README.md](server/README.md) — server entry point, `ConversationManager`, `SharedDispatcher`, routing ClientIO

---

## Trademarks

This project may contain trademarks or logos for projects, products, or services. Authorized use of Microsoft
trademarks or logos is subject to and must follow
[Microsoft's Trademark & Brand Guidelines](https://www.microsoft.com/en-us/legal/intellectualproperty/trademarks/usage/general).
Use of Microsoft trademarks or logos in modified versions of this project must not cause confusion or imply Microsoft sponsorship.
Any use of third-party trademarks or logos are subject to those third-party's policies.
