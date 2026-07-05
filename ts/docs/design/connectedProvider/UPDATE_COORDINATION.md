# Update Coordination — Rework (Implemented)

> **Status: Implemented.** Shipped across Milestones 1–5 (see
> [UPDATE_COORDINATION_EXECUTION_PLAN.md](./UPDATE_COORDINATION_EXECUTION_PLAN.md)).
> Resolves the open item "request-slip in the update absence window" in
> [DEFERRED_REVIEW_LOG.md](./DEFERRED_REVIEW_LOG.md) and supersedes the disruptive
> global drain-then-add previously described in [DESIGN.md](./DESIGN.md) §7.2.
> Update/uninstall now run through a single per-dispatcher `commandLock`-held
> critical section coordinated by a source-side barrier, made cancelable and
> time-bounded with rollback to `v1`.

## 1. Problem

`@update` swaps an installed agent `v1 → v2`. Previously it was a global, disruptive
**drain-then-add**: the old provider was removed across **every** connected
session before the new one was added to **any**. Between a session's remove and
its re-add the agent name was fully unregistered from that session's
`AppAgentManager`, so a user request naming the agent could **slip into the gap** —
it got an "unknown agent" miss or, worse, was **misrouted** to a different agent.
Siblings were the worst case: their remove applied at their own next idle and the
re-add was deferred until the **global** drain finished, so the window was bounded
by the _slowest_ session's activity, not by the update work.

## 2. Constraints (facts that shape the design)

1. **One shared, storage-locked process per installed agent.** An installed
   agent runs as a single process serving all dispatchers; each dispatcher
   passes its own session/action context per request. The agent may hold state
   shared across dispatchers.
2. **Global no-coexistence is a correctness requirement (not lock-enforced).**
   An agent's persisted storage is keyed by agent **name** (not version) and is
   shared, so two versions of the same-named agent would collide on it. Nothing
   _locks_ this: the `instanceDir` lock is **per-dispatcher** — it guards a
   dispatcher's own instance directory against concurrent dispatcher processes
   and is **not** held by the shared agent process. So the design itself must
   maintain the invariant: `v1` must fully stop before `v2` starts. Blue-green
   (two live versions) is out without changing the name-keyed storage contract.
3. **An update can change grammars / action schemas / embeddings.** These are
   currently built per-dispatcher. A schema-changing update requires each
   dispatcher to rebuild its routing artifacts; that rebuild is CPU-only and
   does **not** touch the agent's shared storage.
4. **UX is open**, to be balanced against implementation complexity. Updates are
   infrequent; a brief, bounded interruption is acceptable if it is cancelable.

⇒ An update is fundamentally a **restart of one shared process**, not a swap that
can overlap versions (name-keyed shared storage forbids two versions at once).

## 3. Where a request binds to an agent (the two seams)

There is no single "routing time"; there are two bind decisions plus an execute
step (see `command.ts`, `matchRequest.ts`, `appAgentManager.ts`):

- **Command path** (`@agent …`, `resolveCommand`): binds via
  `isAppAgentName(name)` + `isCommandEnabled(name)`. If the name is unknown it
  **silently falls back to `system`** (the command-path misroute).
- **NL path** (rewritten to `<requestHandler> request …`): binds via **schema
  candidacy** — `getActiveSchemas()` / `isActionActive(name)` decide which
  agents the translator/cache may pick. If a name's schema isn't active the
  translator **picks another agent** (the NL-path misroute).
- **Execution**: `getActionContext → getAppAgent → loadAppAgent →
getSessionContext` actually invokes the handler.

**Implication:** the routing seams (`isAppAgentName` / `getActiveSchemas`) must
keep seeing the name as **present** during an update, or requests misroute. The
current bug is that update calls `removeAgent`, which deletes the name **and** its
schemas, so _both_ routing seams go false. Any fix must keep the name registered
throughout and gate only the **execution/instance** side.

## 4. Key insight — request vs. applicator op are mutually exclusive per op

The applicator idle-gates through the session's `commandLock` (§7.1), the **same**
lock user requests acquire. So on one dispatcher a request and _a single_
`addProvider`/`removeProvider` op cannot interleave. **But an update is two
separate lock acquisitions** — `removeProvider(v1)` now, `addProvider(v2)` later
(after the global drain) — with the lock **released in between**. The slip lives
in that released gap.

The **issuing** session is currently the exception: it applies its update
`immediate`/inline _while holding its own command lock_ (so its swap is already
one locked section) — which is exactly why `addProvider`/`removeProvider` carry an
`immediate` flag and a second, inline apply path. §5.4 **removes** that special
case by making the issuing session **enqueue like a sibling**, so all dispatchers
use one path.

## 5. Recommended approach — one command-lock-held critical section per dispatcher

On **every** dispatcher, apply the entire local swap as a **single
`commandLock`-held section** — `remove v1 → wait for shared v2 ready → add v2`,
all under one acquisition. Because the whole update is then mutually exclusive
with requests, the slip is **structurally impossible** — no `held` routing state,
no park machinery, no tombstone change required. The command lock already
provides the exclusion. (The issuing session reaches this via the enqueue model
in §5.4, not the current inline path.)

**Every update is treated as potentially schema-changing** and always uses this
coordinated freeze — there is no "code-only" fast path. A schema-changing update
swaps grammars, and grammars are used during _translation_ (before execution), so
a dispatcher on v1-grammars talking to a v2-process would mismatch; the only safe
option is to freeze all dispatchers in lockstep across the swap. A code-only fast
path (skip the lockstep when v1≡v2 schemas) was considered and **rejected for
simplicity**; revisit only if the freeze proves too disruptive.

**The freeze is centered on the command lock, not a per-name gate.** A per-name
`held` gate (block only requests for `foo`) sounds lighter, but under the
always-schema-changing model it can't spare NL traffic: an NL request has no known
target until _after_ translation — which uses the very grammars being swapped — so
you'd have to hold all NL requests anyway. Its only real win (letting other agents'
explicit `@commands` through) doesn't justify the extra routing-seam state, so the
command lock is both simpler and effectively the same blast radius.

### 5.1 Sequence

```
Source (materialize v2 while v1 still serves):
  1. materialize v2 on disk            (v1 running; failure here aborts cleanly, v1 untouched)
                                       (feed: install into a per-agent version-scoped root - see §5.5)

Quiesce + restart (each dispatcher holds its command lock across this):
  2. each dispatcher acquires its commandLock and enters the held section:
       drain in-flight v1, remove v1 routing artifacts, unloadAppAgent(v1)
       (decrement the shared provider refcount), ACK quiesced
  3. once all quiesce ACKs are in AND the shared v1 refcount is VERIFIED 0
       (v1's close() has actually run - §5.6):
       start v2 process   (never overlap: shared name-keyed storage)
  4. each dispatcher (still holding its lock) swaps in v2 artifacts, releases the lock

Result: foo routes to v2 everywhere; no request ever observed foo absent.
Prune v1 from disk only after success.
```

### 5.2 update = uninstall + install under one hold

Structurally, the held section is exactly **`uninstall(v1)` immediately followed
by `install(v2)`** with the command lock held across both — so no request slips
between them. This lets update **reuse** the uninstall/install primitives instead
of the bespoke drain / `pending` / `then` state machine.

- **install** (`absent → active`): slip-free by construction — no prior version,
  so a request before install is correctly "unknown". No hold needed.
- **uninstall** (`active → absent`): ends `absent`, which is the _correct_ end
  state; an in-flight request drains, a new one gets a clean "removed". No
  resume, no slip.
- **update** (`active(v1) → active(v2)`): the **only** op needing the resume-hold,
  and it is just the other two under one lock.

### 5.3 Cancellation / timeout (keep v1 until v2 succeeds)

The held wait spans a process restart, so it must be **cancelable** (user) and
**time-bounded** (safety). Ordering makes cancel a clean rollback: keep `v1`
fully intact and restartable until `v2` is confirmed serving; only prune `v1`
after success.

```
if cancel / timeout before v2 is serving:
    restart v1 (still on disk), swap v1 artifacts back in, release lock,
    discard v2  → active(v1), as if the update never happened
```

- **Per-phase timeouts:** a short **quiesce** timeout (abandon a straggler fast)
  and a longer **v2 start/verify** timeout (accommodate process launch); either
  expiry auto-rolls-back. Config-tunable; start conservative.
- **Cancel is out-of-band.** During the freeze the command lock is held, so a
  typed `cancel` command would queue behind the frozen op and **deadlock**. Cancel
  must ride the existing interrupt/abort path (`abortSignal`), not the command
  queue; the issuing dispatcher's abort maps to a source-coordinated rollback.
  Initially cancel need only be **available on the API** (abort-driven); the
  user-facing cancel UX is deferred (TODO in `packageAgent.ts`).
- **Surfacing:** the issuing conversation gets async status (§5.4:
  updating / updated / cancelled-reverted / failed-reverted); siblings experience
  the brief freeze and get a system message on the outcome.

### 5.4 Uniform enqueue model — delete `immediate`

Today the `immediate`/inline apply path exists **only** because `@update` runs
inside the command lock, so its op cannot use the idle-gated queue without
deadlock. Make the issuing session **enqueue like a sibling** instead:

1. `@update foo` (in-lock): **enqueue** the update op onto the applicator, then
   **return** — the command lock releases naturally at handler end.
2. At the issuing session's next idle (immediately after the command returns), the
   applicator runs the op as the **same** one atomic lock-held section as every
   sibling (§5.1). Because the op was enqueued _before_ `@update` returned, it
   sits ahead of any later user command in the FIFO — no request slips ahead.
3. **Completion is reported asynchronously** (a follow-up message / streaming
   command result): `@update` returns "update started"; the
   "updated"/"failed"/"cancelled" outcome arrives when the op settles. `@update`
   never blocks the command lock waiting on the cross-session restart.

This **deletes the `immediate` parameter and the inline apply path** from
`AppAgentHost.addProvider`/`removeProvider` (§3.1) entirely — install, uninstall,
and update all apply through the single idle-gated path on every dispatcher,
issuing included.

> An alternative that makes `@update` _feel_ synchronous by awaiting the op
> off-lock was considered, but it needs the command framework to let a handler
> **yield the command lock mid-execution** (which is the very constraint that
> forced `immediate`). The async-status model above avoids that and matches the
> inherently async cross-session restart.

### 5.5 Non-destructive materialize — per-agent install roots (feed)

Step 1 requires materializing `v2` without touching `v1`. `path` (re-stats the
same external dir) and `catalog` (record-shaping) are already non-destructive.
`feed` is **not**: `npm install <spec>` into the **shared** `installDir` keeps one
dir per package name, so installing `v2` overwrites `v1` in place — a failed
install can corrupt `v1`, and `v1`'s running process has its files changed
underneath it. (Latent hazard today: `update` npm-installs `v2` over `v1` before
draining it.)

**Decision — content-addressed, deduplicated install roots.** The install unit is
the **package**, not the agent. Every feed agent materializes into a
**content-addressed** root keyed by `sanitize(module)@version`
(`installDir/agents/<module>@<version>/node_modules/...`), and the provider's
require-root points there instead of the single shared `node_modules`. Because the
root is a pure function of package identity + version, it is **deterministic,
deduplicated, and reference-counted**:

- Two agents (or two installs) that resolve to the **same** package+version share
  **one** root — the second materialize is an idempotent no-op (no npm install).
- A **new** version lands in its **own** root alongside the still-running old one
  (non-destructive); the swap happens after the old version stops, then the old
  root is pruned only if no other record still references it.
- Installing the **same** version again is a true no-op end to end: `find`
  resolves the concrete version, `materialize` reuses the existing root, and
  `update` skips the disruptive barrier swap entirely (§5.2).

So materialize is non-destructive, a failed install is a clean abort, §5.3
cancel/rollback falls out for free, and same-version updates cost nothing.

- **Version resolved on `find`:** the membership check already fetches the
  packument, so `find` resolves the requested tag/range/exact spec to a **concrete
  published version** up front (best-effort; offline falls back to letting the
  install resolve it). This lets `materialize` name the root before installing and
  skip npm when that root already exists.
- **Atomic adoption:** the slow path installs into a unique temp root
  (`agents/.tmp-<id>`) and, on success, atomically renames it to
  `agents/<module>@<version>` — or discards it if that root already exists (dedup).
  A crash/failure never leaves a usable-looking partial root behind.
- **Granularity:** one root per **package+version**, shared by every agent that
  resolves to it; transiently a second root during an update to a new version
  (old kept for rollback), collapsing back after prune.
- **File-level only:** compatible with process-level no-coexistence — still one
  running process; runtime name-keyed storage unchanged.
- **Trade:** loses npm's cross-package dependency dedup/hoisting (each
  package+version carries its own deps) in exchange for isolation and determinism —
  clean install/uninstall/update, no clobber, safe sharing.
- **Naming:** `installDir/agents/<sanitize(module)>@<version>/node_modules/...`,
  keyed by the package name + concrete resolved version. `sanitize` collapses the
  scope `@`/`/` to a single traversal-safe path component.
- **GC (refcount):** prune a root on a successful swap or after an uninstall **only
  once no remaining `agents.json` record references it** (a sibling may share it),
  plus a startup orphan sweep that keeps the union of every agent's
  recorded-current root (removing a `.tmp-*` or version dir from a crashed update).
- **Record/provider:** the `InstalledAgentRecord` carries the `installRoot`
  (`module@version`); the provider builder derives the require-root from it instead
  of the shared `installDir`. The concrete version is not stored separately — it is
  already embedded in `installRoot`. Same-version detection in `update` keys off
  `installRoot` being defined and byte-identical, so path/catalog records (no
  `installRoot`) always re-swap and still pick up an in-place manifest edit.

### 5.6 Refcount barrier — v1 must actually terminate before v2 starts

The v1 provider is a shared, **refcounted** singleton
(`createNpmAppAgentProvider`: `AgentProcess.count`). `unloadAppAgent` runs the
process teardown (`close()`) **only when the count reaches 0** — i.e. after the
_last_ dispatcher unloads. So the quiesce step (§5.1 step 2) must call
**`unloadAppAgent(v1)`** to decrement the shared count, not merely remove routing
artifacts. The refcount equals the number of dispatchers that actually _loaded_
(used) v1; a dispatcher that added but never loaded it holds no ref.

**Verify count 0 — do not assume it from the ACKs.** After collecting every
quiesce ACK, the source must **explicitly confirm the shared v1 refcount is
actually 0** (v1 is gone from `moduleAgents` and `close()` has run). If it is
**not** 0, v1's process **has not really terminated** — a ref lingers (a
not-yet-quiesced or late-joining/racing loader, an in-flight op, or a leaked ref)
— and starting v2 would violate name-keyed no-coexistence. In that case the
update **must not proceed**: wait for the straggler(s) or abort/rollback (§5.3).
Only once v1 is _confirmed_ terminated does v2 start.

> **API implication:** the shared provider must **expose** its loaded state
> (today `count` is private to `createNpmAppAgentProvider`), e.g. `isLoaded(name)`,
> so the source can verify release rather than infer it from ACKs alone. The
> source only needs the boolean "still loaded?", not the count magnitude.

With §5.5's version-scoped roots, v1 and v2 are **separate provider instances**
with **separate refcounts**, so "v1 count → 0 → close" and "v2 first load → start"
are a clean handoff — no shared refcount to disentangle.

### 5.7 Coordination — a single coordinated op + source barrier

The per-dispatcher swap is driven by **one coordinated `AppAgentHost` op** (e.g.
`replaceProvider(oldProvider, newProviderThunk, { onQuiesced, whenReady })`) — one
op = one lock acquisition, so the whole freeze is a single awaitable unit (clean
for the §5.3 timeout/cancel). Its body: remove v1 artifacts + `unloadAppAgent(v1)`
→ call `onQuiesced()` → `await whenReady` → build/add v2 artifacts → release. The
source supplies `onQuiesced` (fills a barrier slot) and `whenReady` (a shared
promise it resolves once §5.6's verify-0 passes and v2 is up). Rejected: a
`prepare`/`commit` pair that holds the lock _between_ two host calls (fragile
cross-call lock ownership, partial states).

The barrier is **source-coordinated** — each op awaits the source's signal, never
another dispatcher — so there is no dispatcher-to-dispatcher cycle. A host that
**disconnects** mid-barrier is dropped from it (like today's `drainDrop`).

**Liveness (no unavoidable deadlock):**

- The **timeout (§5.3) is the ultimate backstop** — any stall (straggler that
  won't idle, `v1` that won't die, `v2` that won't start) resolves to rollback.
- **Leaf-op invariant:** teardown (`unloadAppAgent`/`close`) and startup
  (`load`/`init`) run under the held command lock and **must be leaf ops** —
  process teardown/launch only, never dispatching a command or reacquiring the
  command lock (holds for per-agent `close`/`initialize` too). Enforce + test.
- A dispatcher mid-`foo`-request correctly blocks §5.6's verify-0 until it drains
  (bounded by the timeout).
- Tests: straggler-times-out-rolls-back; mid-request blocks-then-times-out;
  disconnect-during-freeze drops from the barrier.

## 6. What this removes vs. today

- The `removing` entry with `pending: Set<AppAgentHost>`, `.finally(drainDrop)`,
  and the post-drain `then` callback.
- The "add is enqueued only after the **global** drain" coupling — with one
  shared process the source coordinates a single restart; a slow sibling no
  longer stretches the window.
- The load tombstone's throw-after-removal (the name is never removed, so nothing
  to tombstone).
- The **`immediate` inline apply path** on `addProvider`/`removeProvider` (§3.1):
  the issuing session enqueues like a sibling (§5.4), so all dispatchers — and
  install/uninstall/update — use the one idle-gated path.

## 7. Tradeoffs

- **The session is frozen for the swap** — not just requests to `foo`, but every
  command (even `@otheragent`), because the command lock gates all of them.
  Acceptable for a bounded process restart; **cancel/timeout is mandatory** (§5.3),
  not optional.
- **Holding all N sessions' locks across the shared-process restart is a brief
  global stop-the-world.** Correct and simple; deliberately chosen over a lighter
  per-name gate (§5) because that gate can't spare NL traffic under the
  always-schema-changing model. Revisit only if the freeze proves painful.
