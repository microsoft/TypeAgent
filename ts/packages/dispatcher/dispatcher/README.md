# TypeAgent Dispatcher

TypeAgent Dispatcher is the core component of the TypeAgent repo that explores how to build a **personal agent** with _natural language interfaces_ using structured prompting and LLM:

- Can be integrated and hosted in different front ends. [TypeAgent Shell](../shell) and [TypeAgent CLI](../cli) are two examples in this repo.
- Extensible [application agents](../agentSdk/README.md) architecture.
- [TypeAgent Cache](../cache/README.md) to lower latency and cost.
- Conversational memory based on [Structured RAG](../../../docs/content/architecture/memory.md)

Dispatcher processes user requests and asks LLM to translate it into an action based on a schema provided by the application agents. It has ability to automatically switch between different agents to provide a seamless experience in a extensible and scalable way.

See [dispatcher architecture](../../../docs/content/architecture/dispatcher.md) doc for more details on the design of the dispatcher component.

## Usage - Natural Language Requests

User can request actions provided by [application agents](../agentSdk/README.md) using natural language.

For example, in the [CLI](../cli):

```bash
[calendar]🤖> can you setup a meeting between 2-3PM
Generating translation using GPT for 'can you setup a meeting between 2-3PM'
🤖: can you setup a meeting between 2-3PM => addEvent({"event":{"day":"today","timeRange":["14:00","15:00"],"description":"meeting"}}) [9.531s]
Accept? (y/n)
```

More sample action requests:

- `play some music by Bach for me please`.
- `create a grocery list`
- `add milk to the grocery list`

Additional system "commands" are available to provide direct interaction with the system, See the [Commands](#commands) section below.

## Usage - Commands

Beyond natural language, users can specify system command with inputs starting with `@`.

### Toggling Dispatcher Agents

Dispatcher agent can be enabled and disabled.

Toggle a specific `<agent>`:

- `@config agent <agent>` _(Enable `<agent>`)_
- `@config agent --off <agent>` or `@config agent -x <agent>` _(Disable `<agent>`)_

Toggle using `*` pattern:

- `@config agent *` (Enable all agents)
- `@config agent *l*` | (Enable agents that has "l" in the name)

Reset to default:

- `@config agent --reset` or `@config agent -r`

Dispatcher agent's schema, action and command can be toggled independently as well, using `@config schema`, `@config action`, `@config command`.

To list all available agents and their status, just the command without any parameters:

```bash
🤖🚧💾  [🎧📅📩📝🌐💬🤖🔧📷🖐🖼️📱🗎]> @config agent
|Agent               |Schemas|Actions|Commands|
|--------------------|-------|-------|--------|
|androidMobile       |✅     |✅     |        |
|browser             |✅     |✅     |✅      |
|  browser.commerce  |💤     |💤     |        |
|  browser.crossword |💤     |💤     |        |
|  browser.paleoBioDb|💤     |💤     |        |
|calendar            |✅     |✅     |✅      |
|chat                |✅     |✅     |        |
|code                |❌     |❌     |❔      |
|  code.code-debug   |❌     |❌     |        |
|  code.code-display |❌     |❌     |        |
|  code.code-general |❌     |❌     |        |
|desktop             |❌     |❌     |❔      |
|dispatcher          |✅     |✅     |✅      |
|  dispatcher.clarify|✅     |✅     |        |
|email               |✅     |✅     |✅      |
|greeting            |✅     |✅     |✅      |
|image               |✅     |✅     |        |
|list                |✅     |✅     |        |
|markdown            |✅     |✅     |        |
|photo               |✅     |✅     |        |
|player              |✅     |✅     |✅      |
|system              |       |       |✅      |
|  system.config     |✅     |✅     |        |
|  system.conversation|✅    |✅     |        |
```

### Explainer

Explainer is the step where the dispatcher leverages the cache to ask the GPT to explain the generated translations once the user accepted it. The result is used to create constructions if it is enabled (see below). (Explanation is not generated for translations using constructions if it is enabled).

As part of the exploration, the cache has multiple explainer implementations, which can be changed in the CLI's interactive mode using the command `@config explainer name <explainer>`.

For example, in the [CLI](../cli):

```bash
[📅💊📩📝👀🪟⚛️💬🔧]> @config explainer name v4

[📅💊📩📝👀🪟⚛️💬🔧 (explainer: v4)]>
```

To list all configured explainers:

```bash
🤖🚧💾  [📅💊📩📝👀🪟⚛️💬🔧]>@config explainer
Usage: @config explainer name <explainer>
   <explainer>: v4, v5
```

### Shortcut commands

There are other short cut commands to exercise specify part of the TypeAgent Dispatcher system:

- `@translate <request>` - Only do the translation (no follow up explanation )
- `@explain <request> => <action>` - only do the explanation of the request/action combo
- `@reasoning [--engine claude|copilot|none] <request>` - Invoke the reasoning engine on a request. If `--engine` is omitted, the configured default from `@config execution reasoning` is used. Also available as `@reason`.

### Conversations

Conversation management commands can also be invoked via natural language through the `system.conversation` agent. Examples:

- "create a new conversation called research"
- "switch to my work conversation"
- "rename this conversation to project notes"
- "delete the old project conversation"
- "list my conversations"
- "show conversation info"

The dispatcher translates these requests into structured payloads and forwards them to the client via `ClientIO.takeAction(requestId, "manage-conversation", payload)` where `payload` is one of:

```
{ subcommand: "new";    name?: string }
{ subcommand: "list" }
{ subcommand: "info" }
{ subcommand: "switch"; name: string }
{ subcommand: "rename"; name?: string; newName: string }
{ subcommand: "delete"; name: string }
```

`name` identifies the conversation to act on (by name); for `rename`, `name` is optional and defaults to the current conversation. `newName` is the desired name after renaming. The CLI handles these by delegating to the `@conversation` command machinery (`handleConversationCommand`); the Shell calls the corresponding `ClientAPI` conversation methods (`conversationCreate`, `conversationList`, `conversationSwitch`, `conversationRename`, `conversationDelete`, `conversationGetCurrent`) over Electron IPC. This bridge allows the NL agent — which runs inside the dispatcher and has no direct access to the agent-server RPC layer — to manage server-side client-connection conversations in both clients.

TypeAgent dispatcher settings, such as translator, explainer, etc., are stored in sessions, and sessions can be persisted across activation on a per user basis and restored when the app restarts. Use `@session <args>` command to do run operations. Additionally data such as construction store are saved in the sessions as well by default unless an explicit path are provided. The last cache file used is preserved thru reload.

For dispatcher configured to persist sessions (i.e. [CLI](../cli) and [shell](../shell)) the session settings and data are stored in `<home>/.typeagent/profiles/<profile>/sessions/<name>`. (`<home>` is the user profile directory. `~` in Linux, `%USERPROFILE%` in Windows. `<profile>` set for the enlistment, the mapping from enlistment to `<profile>` can be found in `<home>/.typeagent/global.json`).

| Command                         | Description                                                                                                                                                                                   |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@session new`                  | Create a new session with the default settings. Session names are generate implicitly using YYYYMMDD format based on current date. If one already exist, `_<index>` is append to disambiguate |
| `@session open [<name>]`        | Load a sessions with `<name>`. Use `@session list` for a list of session name that can be opened                                                                                              |
| `@session info`                 | Current session name, saved settings and a list of construction stores                                                                                                                        |
| `@session reset`                | Reset all settings to the default, but keep all data.                                                                                                                                         |
| `@session clear`                | Clear all data but keep the settings.                                                                                                                                                         |
| `@session list`                 | List all sessions                                                                                                                                                                             |
| `@session delete [<name>] [-a]` | Delete a session. If no session is specified, delete the current sessions.`-a` to delete all sessions. If the current session is deleted, a new session will be created.                      |

### Constructions

Constructions are local parsing and transform rules built based on the explanations given by LLM.
Use the `@const <args>` command at the prompt to control the construction store.

| Command                   | Description                                                                                                                                                                                                                                                                                                                                                                                        |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@const new [<file>]`     | Initialize the construction store and start saving constructions built using explanations from user prompts. Existing constructions will be removed.<br> If file is not provide, but session is persisted and auto save is on, then it will use a file name generated in the session directory.<br>Otherwise, the cache will be in memory only. Use `@const save` to assign a file name to save to |
| `@const load [<file>]`    | Load a construction store from a file. If the file is not provided, load from the default location for the translation specified in the config. Existing construction will be removed.                                                                                                                                                                                                             |
| `@const import [<file>]`  | Import the construction from the translation and explanation stored in a test data file and add it to the existing construction store.                                                                                                                                                                                                                                                             |
| `@const save [<file>]`    | Save the construction store to a file. If the file is not provided, it will save to location it last saved to or loaded from, or error if it was never backed by a file.                                                                                                                                                                                                                           |
| `@const auto [on\|off]`   | Toggle auto saving mode. When auto saving mode is on, the construction store will be written on every new construction added to the store. If the session is persisted and auto save mode is turned on, but the construction store is not backed by a file, then a new file name will be generated and save in the session.                                                                        |
| `@const off`              | Turn off construction store. The existing constructions will be lost                                                                                                                                                                                                                                                                                                                               |
| `@const info`             | Show state of the construction store                                                                                                                                                                                                                                                                                                                                                               |
| `@const list [<options>]` | List the constructions.<br>Options:<br><table><tr><td>-v, --verbose</td><td>Show verbose match set names</td></tr><tr><td>-a, --all</td><td>Show all items in the match set</td></tr><tr><td>-b, --builtin</td><td>Show built in construction store</td></tr></table>                                                                                                                              |
| `@const merge on\|off`    | Toggle whether the match sets are merged or not                                                                                                                                                                                                                                                                                                                                                    |
| `@const wildcard on\|off` | Toggle whether to use wildcards in matches                                                                                                                                                                                                                                                                                                                                                         |
| `@const delete <id>`      | Delete a construction by ID as shown in `@const list`                                                                                                                                                                                                                                                                                                                                              |

### Grammar

Grammar commands let you inspect runtime-learned rules and scan loaded `.agr` files for cross-agent collisions.

| Command                                     | Description                                                                                                                                                                                                                                                                       |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@grammar` _(or)_ `@grammar list [<agent>]` | List grammar rules learned at runtime by the dispatcher. Optionally filter by agent name. Default subcommand. Shows risk icons (munch / completion).                                                                                                                              |
| `@grammar show <id>`                        | Show a single learned rule's pattern, anchor words, and risk analysis.                                                                                                                                                                                                            |
| `@grammar delete <id>`                      | Delete a learned rule by ID. Rebuilds the in-memory NFA for the affected schema.                                                                                                                                                                                                  |
| `@grammar clear [<agent>]`                  | Clear all learned rules. Optionally scope to one agent.                                                                                                                                                                                                                           |
| `@grammar collisions [--json <path>]`       | NFA-product-construction collision detector across all loaded agent grammars. Reports concrete witness inputs that both grammars accept, plus the action interpretation each grammar produces. With `--json <path>`, also writes a structured report for offline post-processing. |

**About the collision scanner:**

- Compiles every loaded schema's grammar to an NFA, then for each cross-agent pair builds the joint product NFA (`findGrammarOverlap` in [`action-grammar`](../../actionGrammar/src/nfaIntersection.ts)) and BFSes from start-pair to any accept-pair. The path's accumulated tokens are a concrete **witness** — proof of overlap, not just a heuristic guess.
- For each detected overlap, also runs the witness through each grammar's AST matcher (`matchGrammar`) and shows what the runtime dispatcher would interpret it as. This makes the report actionable when the rule pattern is opaque (e.g. a top-level rule that's just a single dispatching `<rules>` reference).
- Witnesses on **typed wildcards with no concrete sample** (custom entity validators whose accepted language we can't enumerate) come back with synthetic `<TypeName>` placeholders and are flagged for manual review.
- Grammars optimized with `tailFactoring` (RulesPart `tailCall: true`) are auto-stripped before NFA compile — language acceptance is preserved; only the optimizer's bindings-flow shortcut is lost (the AST matcher is used for the action-value preview, which understands `tailCall` natively, so previews stay accurate).
- Skip reasons (no grammar / wrong format / parse error / compile error) are surfaced in a collapsible breakdown with per-reason counts and sample schema names, so the question "why was X skipped?" is self-answering.
- `--json <path>` writes a `CollisionScanResult` keyed by canonical `"schemaA|schemaB"` (alphabetical) — same engine and JSON shape as the standalone [`analyze-grammar-collisions` CLI](../../actionGrammar/README.md#cli-analyze-grammar-collisions). Use it to gate CI on grammar collisions, diff across changes, or post-process for tuning.

For testing, enable the [vampire agent](../../agents/vampire) — its actions and grammar rules are engineered to collide deliberately, so `@grammar collisions` will produce a non-empty report once it's loaded.

### Debugging

#### Traces

`@trace <trace pattern>` - add a trace pattern for debugging. See [Tracing](../../README.md#tracing) in the ts root README.md.

#### In-proc agent mode.

By default agents runs out of proc in their own process. This is to ensure that agent is built to be able to run independently or in the cloud. For debugging, agents can be forced to run in the same process as the dispatcher by setting the environment variable `TYPEAGENT_EXECMODE=0`

### Other configs

| Command                       | Description                                                                    |
| ----------------------------- | ------------------------------------------------------------------------------ |
| `@config bot on\|off`         | Toggle the LLM translation (Turn off to rely on constructions only if enabled) |
| `@config explanation on\|off` | Toggle LLM explanation (Turn off to stop updating construction store)          |
| `@config log db on\|off`      | Toggle sending logging information to a remote database (default: on)          |

### Diagnostics

| Command         | Description                                                                                                                                                                                                                                                                                                                                                          |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@system ports` | List every TCP port registered with the dispatcher's `PortRegistrar`, grouped by `(agent, role, port)`. Includes the agent-server's own listen port and the connected-client count for any agent that publishes one via `SessionContext.notifyClientCountChanged` (currently the browser and code agents). Rows from agents that don't publish a count render `N/A`. |

### User feedback

When the user rates an agent message via the chat UI's thumbs-up/down buttons or moves a bubble to the trash, the dispatcher persists each event to the per-session `displayLog.json` (as `user-feedback` and `user-message-hidden` entries) and emits a `userFeedback` telemetry event through `Logger.logEvent`. The `@feedback` command group lets you inspect and export those entries.

| Command                        | Description                                                                                                                                                                            |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@feedback` / `@feedback list` | Recent feedback, newest first. `--limit N` (default 20), `--all` to include re-rates.                                                                                                  |
| `@feedback top`                | Totals by rating + top thumbs-down categories. `--limit N` controls category depth.                                                                                                    |
| `@feedback filter`             | Filtered list. Flags: `--rating up\|down\|cleared`, `--category wrong-agent\|didnt-understand\|bad-response\|other`, `--since YYYY-MM-DD`, `--until YYYY-MM-DD`, `--limit N`, `--all`. |
| `@feedback export <file>`      | Dump entries to disk. `--format json\|jsonl` (default: inferred from extension). `--all` to include re-rates. Uses `~` expansion and prompts before overwriting an existing file.      |
| `@feedback count`              | One-line summary: total entries and unique-request count.                                                                                                                              |

By default each command reduces to the latest rating per request (so a user who flipped 👍 → 👎 shows once with 👎). Pass `--all` to see the full append-only history.

#### Trash bin

The trash icon on a message bubble routes through a separate persistence path. The user can hide either a user-message or an agent-response independently; restoration is bulk via two shell commands:

| Command                | Description                                                                                   |
| ---------------------- | --------------------------------------------------------------------------------------------- |
| `@shell trash restore` | Un-hide every bubble that's currently in the trash (skips entries previously flushed).        |
| `@shell trash flush`   | Permanently delete every bubble currently in the trash — the user can no longer restore them. |

## Action Collision Detection

When two or more agents can plausibly handle the same user input, the dispatcher needs a policy for picking a winner. The default ("first-match") preserves legacy behavior — silently take the first validated match — but the dispatcher also supports detecting collisions across four points and applying one of four configurable resolution strategies. This subsystem is **off by default**; opt in per detection point via session config.

> **Soft-rollout plan:** see [`collision-rollout.md`](../../../docs/architecture/collision-rollout.md) for the staged experiment plan (observability first, then strategy A/B), tester opt-in protocol, telemetry pipeline, and Cosmos query reference. That document is the canonical record for any experiment touching this subsystem — update it as experiments run.
>
> **Analysis tooling:** see [`collision-analysis.md`](../../../docs/architecture/collision-analysis.md) for the user guide to the data + analysis surface — `@collision similar` / `@collision probe` / `@collision corpus *` / `@collision neighborhoods preview`, the three interactive HTML visualizations, and the operational scripts that exercise them.

### Detection points

| Point              | When it fires                                                                                                                      | Source                                                                                                                                                            |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`static`**       | At agent registration time — duplicate `actionName` declared by more than one schema (e.g. both `player.play` and `vampire.play`). | [`appAgentManager.scanActionNameCollisions`](src/context/appAgentManager.ts), invoked from [`runStaticCollisionDetection`](src/context/commandHandlerContext.ts). |
| **`grammarMatch`** | At runtime, in the cache/grammar match path — multiple agents return validated matches for the same input.                         | [`getValidatedMatches`](src/translation/matchRequest.ts) + [`resolveGrammarCollision`](src/translation/matchCollision.ts).                                        |
| **`llmSelect`**    | At runtime, during embedding-based schema selection — top-N embedding scores are within `scoreDeltaThreshold`.                     | [`pickInitialSchema`](src/translation/translateRequest.ts).                                                                                                       |
| **`fuzzy`**        | Static and/or runtime — actions whose **meaning** overlaps even when names/grammars differ (e.g. `delete` vs `remove`).            | [`fuzzyCollision.ts`](src/translation/fuzzyCollision.ts) — **scaffolded only; default scorer returns 0**.                                                         |

### Resolution strategies

All runtime detection points share the same four-way strategy enum. Each detection point selects one independently.

| Strategy       | Behavior                                                                                                                                                                                            |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `first-match`  | Pick the heuristically-first validated candidate. Byte-identical to legacy behavior.                                                                                                                |
| `score-rank`   | Sort by `(matchedCount desc, nonOptionalCount desc, -wildcardCharCount)`; ties fall through to `priority`.                                                                                          |
| `priority`     | Pick the candidate from the highest-priority agent. Priority comes from `priorityOrder` (comma-separated list) if set, otherwise agent registration order.                                          |
| `user-clarify` | Synthesize a [`ClarifyMultipleAgentMatches`](src/context/dispatcher/schema/clarifyActionSchema.ts) action listing all candidates so the user can pick. The user's reply re-enters the request loop. |

The `static` point uses a separate two-way enum: `warn` (log and continue) or `error` (throw). The async `onSchemaReady` path always degrades `error` → `warn` so a slow agent can never crash a live session.

### Config schema

Defined as `CollisionConfig` in [`session.ts`](src/context/session.ts). All defaults preserve current behavior — `detect: false` everywhere, `strategy: "first-match"`.

```ts
collision: {
    static: {
        detect: boolean;                    // scan duplicate actionNames at registration
        strategy: "warn" | "error";
    };
    grammarMatch: {
        detect: boolean;
        classifier: "distinctActions" | "tiedHeuristics";
        strategy: "first-match" | "score-rank" | "priority" | "user-clarify";
    };
    llmSelect: {
        detect: boolean;
        topN: number;                       // default 3
        scoreDeltaThreshold: number;        // default 0.05 — within = ambiguous
        strategy: "first-match" | "score-rank" | "priority" | "user-clarify";
    };
    fuzzy: {
        detect: boolean;
        staticEnabled: boolean;
        runtimeEnabled: boolean;            // (TODO: runtime hook not yet wired into matchCollision.ts)
        similarityThreshold: number;        // default 0.85 — placeholder until calibrated
        scorer: "placeholder" | "actionEmbedding";
        strategy: "first-match" | "score-rank" | "priority" | "user-clarify";
    };
    priorityOrder: string;                  // comma-separated agent names; "" = registration order
    multipleActionBehavior:
        | "downgrade-to-priority"           // safest default
        | "pause-and-prompt"                // (TODO: requires batch-executor changes; currently degrades to priority)
        | "abort";
    telemetry: {
        emit: boolean;                      // append to ring buffer (size 50) on CommandHandlerContext
        debugLog: boolean;                  // also log via debug("typeagent:dispatcher:collision")
    };
};
```

### Telemetry & evaluation surface

When `telemetry.emit` is true, every detected collision lands in **three places**:

1. **In-memory ring buffer** on `CommandHandlerContext.collisionEvents` (cap 50). Surfaced via `@collision events`.
2. **Per-session JSONL** at `<sessionDir>/collision-events.jsonl` — one line per event, survives shell exit. Always written when emit is on; no DB credentials needed.
3. **Existing logger pipeline** (Cosmos `telemetrydb / dispatcherlogs`, `eventName: "collision"`) — gated separately by `@config log db on`. The DB sink self-disables on auth errors so a stale credential won't spam retries.

Each event carries `kind` (detection point), `strategy`, `candidates[]` (with per-candidate `matchedCount` / `nonOptionalCount` / `wildcardCharCount` / `priorityRank`), `chosen`, `firstMatchCandidate` (counterfactual — what `first-match` would have picked, lets every Cosmos query measure strategy divergence in one row), `classifier` (for grammarMatch), `requestId`, `experimentId` (set via `@config collision telemetry experimentId`), `sessionId`, `elapsedMs`, `note`.

`DEBUG=typeagent:dispatcher:collision` enables a one-line log per event when `telemetry.debugLog` is true (on by default).

### Shell-level config (M1 / M5)

Runtime opt-in via `@config collision …` and ring-buffer inspection via `@collision events`:

| Command                                           | Effect                                                                                                                                                        |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@config collision`                               | Render the current collision config as an HTML status table.                                                                                                  |
| `@config collision <point> detect [on\|off]`      | Toggle a detection point (`static` / `grammarMatch` / `llmSelect` / `fuzzy`). Persisted to `data.json`.                                                       |
| `@config collision <point> strategy <name>`       | Set the resolution strategy (`first-match` / `score-rank` / `priority` / `user-clarify`; static uses `warn` / `error`).                                       |
| `@config collision priority [<list>]`             | Set / show the comma-separated `priorityOrder` used by the `priority` strategy.                                                                               |
| `@config collision telemetry emit [on\|off]`      | Toggle the ring-buffer + JSONL capture.                                                                                                                       |
| `@config collision telemetry debugLog [on\|off]`  | Toggle the `typeagent:dispatcher:collision` debug log.                                                                                                        |
| `@config collision telemetry experimentId [<id>]` | Stamp every emitted event with this tag. Use to slice Cosmos queries per experiment.                                                                          |
| `@collision events [-n <N>] [-k <kind>]`          | Show recent events from the in-memory ring buffer with kind / strategy badges and a ⚡ marker on rows where the chosen candidate diverged from `first-match`. |
| `@config log db [on\|off]`                        | Toggle DocumentDB upload (gates remote sink — independent of the per-session local capture).                                                                  |

Calibration knobs (`classifier` / `topN` / `scoreDeltaThreshold` / `scorer` / `similarityThreshold`) are intentionally not exposed via `@config collision` — they're long-tail tuning, not opt-in toggles, and the same `data.json` accepts hand edits when needed.

### Usage example

For deliberate, repeatable collisions during evaluation, enable the [vampire test agent](../../agents/vampire) (default-disabled) — it ships rules engineered to collide with the **list** agent on these inputs:

| Test phrase                        | Collides on                                 |
| ---------------------------------- | ------------------------------------------- |
| `add eggs to my grocery list`      | `list.addItems` vs `vampire.addItems`       |
| `remove eggs from my grocery list` | `list.removeItems` vs `vampire.removeItems` |
| `what is on my grocery list`       | `list.getList` vs `vampire.getList`         |

(The `<Play>` rule in `vampireSchema.agr` claims it collides with `player.play` but the current player grammar requires `play <track> by <artist>`, so a bare `play X` only matches vampire today — kept for reference but not a working collision target until player grows back a bare `play <song>` rule.)

A typical Phase 1 observability experiment looks like:

```
@config agent vampire                              # enable the test agent
@config log db on                                  # remote upload (Cosmos)
@config collision telemetry emit on                # capture events
@config collision telemetry experimentId E1.2-2026-05-12
@config collision grammarMatch detect on           # opt in to detection
add eggs to my grocery list                        # known colliding phrase
@collision events -k grammarMatch -n 25            # inspect what fired
@config collision grammarMatch detect off          # rollback (one step)
```

Programmatic equivalent (used by tests and tools):

```ts
session.updateSettings({
  collision: {
    grammarMatch: { detect: true, strategy: "first-match" },
    telemetry: { emit: true, debugLog: true, experimentId: "E1.2-2026-05-12" },
  },
});
```

### MultipleAction interaction

`multipleActionBehavior` controls what happens when `user-clarify` would fire on a sub-action inside a `MultipleAction` batch:

- `downgrade-to-priority` (default, safest): silently fall back to `priority`. Telemetry still records the original collision so the choice is auditable.
- `pause-and-prompt`: **TODO** — requires non-trivial batch-executor changes. Today this value falls back to `downgrade-to-priority`.
- `abort`: surface the clarify and fail the batch; the user re-issues the request.

### TODOs / open work

- **Real `ActionEmbeddingScorer` implementation** — the fuzzy detection point is fully wired but the only shipped scorer (`PlaceholderScorer`) returns 0 for all pairs. Selecting `scorer: "actionEmbedding"` today logs a "not implemented; falling back to placeholder" warning. Reusing the embedding model already loaded by `semanticSearchActionSchema` is the natural follow-up.
- **Runtime fuzzy detection hook** — `fuzzy.runtimeEnabled` is in the config but the call site in `matchCollision.ts` (post-resolver fuzzy candidate scan) is not yet wired up. Static fuzzy scanning is wired.
- **`pause-and-prompt` for `MultipleAction`** — requires batch-executor pause/resume support. Today this strategy auto-degrades to `downgrade-to-priority`.
- ~~**Runtime collision-events command** — `@grammar collisions` covers the static-scan side (cross-agent grammar overlap, with concrete witnesses via NFA product construction). The runtime side — `lastStaticCollisions` (post-load) and the `collisionEvents` ring buffer (per-request) — is still programmatic-only and needs a command surface.~~ Done (M5): `@collision events` surfaces the per-event ring buffer; events also persist to `<sessionDir>/collision-events.jsonl` and (when `dblogging` is on) to Cosmos. The `lastStaticCollisions` post-load snapshot is still programmatic-only.
- **Threshold calibration** — `fuzzy.similarityThreshold: 0.85` is a placeholder. Once a real scorer lands, calibrate against a labeled set of agent-action pairs.
- **On-disk fuzzy matrix cache** — once fuzzy scoring is non-trivial, cache the static pairwise matrix in the agent cache directory so it doesn't re-run on every dispatcher boot.
- **Clarify-loop bias** — when the user picks an agent in response to a `ClarifyMultipleAgentMatches`, the same collision can repeat on the next round-trip. Mitigation: temporarily set `lastActionSchemaName` to the user's pick to bias re-translation. Deferred until/unless it bites in evaluation.
- **`@config collision …` shell command** — programmatic-only setting today; a CLI surface would make A/B evaluation easier.

## Developer

### Adding Dispatcher Agent

Additional Dispatcher Agent can be create and added to the dispatcher to extend the capabilities of TypeAgent as a **personal agent**. [TypeAgent SDK](../agentSdk) defines the interfaces and helper needed to develop an agent. The `Echo` agent [tutorial](../../../docs/content/tutorial/agent.md) illustrate the steps to create a basic agent in a NPM module and install into TypeAgent's [shell](../shell) and [CLI](../cli).

By default dispatcher only comes with `system` and `dispatcher` agents, providing minimal base functionality. Additional agents are provided using [AppAgentProvider](./src/agentProvider/agentProvider.ts) when the dispatcher is created by the host. The host of the dispatcher (like [shell](../shell) and [CLI](../cli)) is configured with the default provider with subset of agents implemented in this repo, and a extensible provider that allow additional agent to be dynamically install/registered. (See [default-agent-provider](../defaultAgentProvider/) package).

### Hosting Dispatcher

#### Main entry point `createDispatcher` API

Use `createDispatcher` to create a dispatcher instance `createDispatcher`. The main options are:

- appAgentProviders: app agent providers to use. If not specified, only the system agents are available.
- clientIO: The client IO to use for interactivity. If not specified, no interactivity is available.
- persistDir: The directory to save states, including cache and session (if enabled)
- persistSession: whether to save and restore session state across runs.

After creation, use the `submitCommand` API on the instance to start process any user requests. The unified `submitCommand` returns `{ok, entry}` where `entry` is a `SubmittedRequest` carrying an `entry.completion` promise; await `entry.completion` for the request result, or use the `awaitCommand(dispatcher, …)` helper from `@typeagent/dispatcher-types` for a one-liner that throws on submit failure.

## Trademarks

This project may contain trademarks or logos for projects, products, or services. Authorized use of Microsoft
trademarks or logos is subject to and must follow
[Microsoft's Trademark & Brand Guidelines](https://www.microsoft.com/en-us/legal/intellectualproperty/trademarks/usage/general).
Use of Microsoft trademarks or logos in modified versions of this project must not cause confusion or imply Microsoft sponsorship.
Any use of third-party trademarks or logos are subject to those third-party's policies.
