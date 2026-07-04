# Update Coordination — Rework (Proposed)

> **Status: Proposed / not implemented.** A plan to iterate on. Addresses the
> open item "request-slip in the update absence window" in
> [DEFERRED_REVIEW_LOG.md](./DEFERRED_REVIEW_LOG.md). The shipped behavior is the
> disruptive global drain-then-add in [DESIGN.md](./DESIGN.md) §7.2.

## 1. Problem

`@update` swaps an installed agent `v1 → v2`. Today it is a global, disruptive
**drain-then-add**: the old provider is removed across **every** connected
session before the new one is added to **any**. Between a session's remove and
its re-add the agent name is fully unregistered from that session's
`AppAgentManager`, so a user request naming the agent can **slip into the gap** —
it gets an "unknown agent" miss or, worse, is **misrouted** to a different agent.
Siblings are the worst case: their remove applies at their own next idle and the
re-add is deferred until the **global** drain finishes, so the window is bounded
by the *slowest* session's activity, not by the update work.

## 2. Constraints (facts that shape the design)

1. **One shared, storage-locked process per installed agent.** An installed
   agent runs as a single process serving all dispatchers; each dispatcher
   passes its own session/action context per request. The agent may hold state
   shared across dispatchers.
2. **Storage is guarded by an `instanceDir` lock** — only one agent process may
   hold the agent's storage at a time. ⇒ **Global no-coexistence is mandatory
   and lock-enforced**: `v1` must exit (release the lock) before `v2` starts.
   Blue-green (two live versions) is impossible without changing the storage
   contract.
3. **An update can change grammars / action schemas / embeddings.** These are
   currently built per-dispatcher. A schema-changing update requires each
   dispatcher to rebuild its routing artifacts; that rebuild is CPU-only and
   does **not** touch the `instanceDir` lock.
4. **UX is open**, to be balanced against implementation complexity. Updates are
   infrequent; a brief, bounded interruption is acceptable if it is cancelable.

⇒ An update is fundamentally a **restart of one shared, storage-locked process**,
not a swap that can overlap versions.

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
schemas, so *both* routing seams go false. Any fix must keep the name registered
throughout and gate only the **execution/instance** side.

## 4. Key insight — request vs. applicator op are mutually exclusive per op

The applicator idle-gates through the session's `commandLock` (§7.1), the **same**
lock user requests acquire. So on one dispatcher a request and *a single*
`addProvider`/`removeProvider` op cannot interleave. **But an update is two
separate lock acquisitions** — `removeProvider(v1)` now, `addProvider(v2)` later
(after the global drain) — with the lock **released in between**. The slip lives
in that released gap.

The **issuing** session is already the exception: it applies its update
`immediate`/inline *while holding its own command lock*, so on the issuing
dispatcher the whole swap is one locked critical section — no gap, no slip. Only
**siblings** split into two acquisitions.

## 5. Recommended approach — one command-lock-held critical section per dispatcher

Make **every** dispatcher behave like the issuing one: apply the entire local
swap as a **single `commandLock`-held section** — `remove v1 → wait for shared
v2 ready → add v2`, all under one acquisition. Because the whole update is then
mutually exclusive with requests, the slip is **structurally impossible** — no
`held` routing state, no park machinery, no tombstone change required. The command
lock already provides the exclusion.

### 5.1 Sequence

```
Source (materialize v2 while v1 still serves):
  1. materialize v2 on disk            (v1 running; failure here aborts cleanly, v1 untouched)

Quiesce + restart (each dispatcher holds its command lock across this):
  2. each dispatcher acquires its commandLock and enters the held section:
       drain in-flight v1 requests, remove v1 routing artifacts locally
  3. once all dispatchers quiesced + in-flight drained:
       stop v1 process (release instanceDir lock) → start v2 (acquire lock)
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
- **uninstall** (`active → absent`): ends `absent`, which is the *correct* end
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

## 6. What this removes vs. today

- The `removing` entry with `pending: Set<AppAgentHost>`, `.finally(drainDrop)`,
  and the post-drain `then` callback.
- The "add is enqueued only after the **global** drain" coupling — with one
  shared process the source coordinates a single restart; a slow sibling no
  longer stretches the window.
- The load tombstone's throw-after-removal (the name is never removed, so nothing
  to tombstone).

## 7. Tradeoffs

- **The session is frozen for the swap** — not just requests to `foo`, but every
  command (even `@otheragent`), because the command lock gates all of them.
  Acceptable for a bounded process restart; **cancel/timeout is mandatory**, not
  optional.
- **Holding all N sessions' locks across the shared-process restart is a brief
  global stop-the-world.** Correct and simple, but heavy — see open questions for
  how to soften it.

## 8. Open questions (to iterate)

1. **Do we need all N locks held simultaneously, or can dispatchers swap
   independently?** For a **schema-changing** update the grammar swap must be
   coordinated with the process swap (a dispatcher on v1-grammars talking to a
   v2-process would mismatch), which pushes toward the coordinated freeze. For a
   **code-only** update (schema unchanged) a dispatcher could keep v1 grammars and
   talk to v2 — only the process restart needs a hold. **Detecting "schema
   changed" lets us pick the cheap path.**
2. **Where is the freeze centered — the command lock (freezes all agents) or a
   per-name `held` gate at the load seam (freezes only `foo`)?** The lock-held
   approach is simpler but coarser; the per-name gate is lighter but reintroduces
   routing-seam state. Pick based on how disruptive an all-agents freeze is in
   practice.
3. **How does the source coordinate the single shared-process restart** with N
   dispatchers each holding a lock (signal/ack for "quiesced" and "v2 ready")?
4. **Timeout policy + cancel UX** — default timeout, how cancel is surfaced
   (issuing conversation vs. siblings), and what a sibling sees during the freeze.
5. **Deadlock/liveness** while N locks are held awaiting a shared external
   process — confirm the process restart never needs anything from a frozen
   dispatcher.
