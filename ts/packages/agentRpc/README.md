# Agent Remoting

This package contains code to support remoting TypeAgent SDK interfaces via an abstract RpcChannel interface.

## Connection convention: prefer `rpc.rebind` over recreate

**Decision (adopted):** rpc connection clients should be built as a **durable
session that rebinds its transport on reconnect**, not as an object that is thrown
away and rebuilt on every drop.

Concretely, a client that owns a reconnecting transport should:

1. Create its rpc **once**, with `createRpc(..., { rebindable: true })`.
2. On reconnect, reopen the transport and call `rpc.rebind(newChannel)` (reusing the
   same rpc/connection object), rather than calling `createRpc(...)` again.

```ts
// On (re)connect:
if (rpc) {
  rpc.rebind(channelProvider.createChannel(name)); // reuse — stable identity
} else {
  rpc = createRpc(
    name,
    channelProvider.createChannel(name),
    invokeHandlers,
    callHandlers,
    {
      rebindable: true,
    },
  );
}
```

### Why — benefits

- **Connection safety (the main reason).** A non-rebindable rpc is _permanently
  poisoned_ the first time its channel disconnects: `invoke`/`send` are swapped for
  error stubs, so any reference to it is dead after a single drop. A rebindable rpc
  instead rejects in-flight calls, **fail-fasts** with a clear error while
  disconnected, and **resumes** after `rebind`. The object stays usable across the
  whole connection lifetime.

- **Pit of success — caching/injecting the rpc is safe by default.** Because the
  object survives reconnects, you can hold it in a field, inject it into a service's
  constructor, capture it in a closure, or hand it to a webview, and it keeps working
  after a drop. With recreate, every such holder is a latent bug: it works until the
  first reconnect, then silently breaks unless the author _remembered_ to re-fetch
  from a getter. Rebind makes the obvious thing (keep the reference) the correct
  thing, instead of relying on a "never cache, always re-fetch" rule no compiler
  enforces.

- **Stable identity → cleaner consumers.** Consumers can call `rpc.invoke(...)`
  directly instead of threading a `getRpc()` getter and null-checking at every call
  site. This is the classic DI shape (a dependency passed as a plain object), which is
  more decoupled and more testable than reaching for a module-level accessor — and it
  works across process/webview boundaries where you can only pass an object, not a
  getter.

- **Logical / correct domain model.** A connection _has_ a transport (an ephemeral
  socket) rather than _is_ one. Modeling reconnect as "re-point the transport of a
  durable session" matches the domain better than "throw the session away and build a
  new one," and keeps continuity of per-rpc state (registered handlers, the call-id
  sequence) across reconnects.

- **Consistency.** One pattern for every connection-owning client means one mental
  model to learn, review, and maintain — rather than a mix of recreate-and-refetch and
  rebind across the codebase.

> Honest scope note: for the connection clients that exist **today**, every consumer
> already re-fetches, so the immediate, measurable benefit is small — these are
> lateral refactors. The value above is mostly **forward-looking** (it pays off as
> more/longer-lived consumers cache or inject the rpc). We adopt it as a convention so
> that future code is safe by construction, not because it fixes a present bug.

### Notes / caveats

- The rebindable behavior is **opt-in** (`{ rebindable: true }`); existing
  non-rebindable consumers are unchanged.
- This is a convention for **connection-owning** clients (those with a reconnect
  loop). One-shot clients (connect → invoke → close) and servers (one rpc per inbound
  socket) don't need it.
- Reconnect orchestration (backoff, badges, re-subscribe, re-join) stays
  transport-specific per client — only the create-once/rebind kernel is shared.
- Adopted clients: browser extension (`agentRpc`), studio `StudioServiceConnection`,
  agent-server `connectAgentServer`. See the design doc
  `docs/plans/.../rpc-rebindable-channel-design.md` (where maintained) for the full
  rationale and the per-consumer assessment.

## Trademarks

This project may contain trademarks or logos for projects, products, or services. Authorized use of Microsoft
trademarks or logos is subject to and must follow
[Microsoft's Trademark & Brand Guidelines](https://www.microsoft.com/en-us/legal/intellectualproperty/trademarks/usage/general).
Use of Microsoft trademarks or logos in modified versions of this project must not cause confusion or imply Microsoft sponsorship.
Any use of third-party trademarks or logos are subject to those third-party's policies.
