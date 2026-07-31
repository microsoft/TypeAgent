# Agent `@`-commands → natural-language actions — Plan

Status: Ready to execute. This document is the single source of truth for
giving agent-host `@`-commands equivalent natural-language **actions**.
Progress tracking lives in [STATUS.md](./STATUS.md).

Scope note: this effort covers **agent-host commands only** (browser,
localPlayer, player, calendar, email, powershell, osNotifications, selfhelp).
The `@system …` commands (config/session/const/…) are a deliberately separate,
later effort.

## Motivation & reframing

The Action Browser catalog reports 301 leaf commands "without an action." That
metric measures whether a command handler declares a `readonly action` **link**
— it does **not** mean natural-language invocation is impossible. When you
reconcile the 64 non-system commands against the agents' existing action
schemas, the picture is very different:

| Bucket                                                                                        | Count | Where                                                                                   |
| --------------------------------------------------------------------------------------------- | ----: | --------------------------------------------------------------------------------------- |
| Already have a matching action (NL works when the agent is enabled; only the link is missing) |   ~30 | localPlayer 14, browser 7 (+`ask` partial), powershell 4, osNotifications 2, selfhelp 1 |
| Not a sensible NL action (auth / config / diagnostics)                                        |   ~32 | browser 16, player 3, calendar 3, email 3, dispatcher 6, powershell 1                   |
| Genuinely missing an action (write a new one)                                                 |    ~1 | email `index`                                                                           |

**Approach (confirmed):** declare the `action` link where an action already
exists; author brand-new actions only for genuine gaps. Pilot on `localPlayer`,
then roll out.

## Mechanism & reference

- SDK field: `packages/agentSdk/src/command.ts` (~L45) —
  `CommandDescriptor.action?: string | { schema: string; actionName: string }`.
  This is **metadata only**: it records the equivalent action so tooling can
  cross-reference a typed command with its NL action. It does not itself wire
  execution.
- Reference implementation to copy (the `@system conversation` / `@system
history` commands are the only 12 that already declare the link):
  - Command handlers: `packages/dispatcher/dispatcher/src/context/system/handlers/conversationCommandHandlers.ts`
    (each handler has `public readonly action = "newConversation"` etc.) and
    `.../handlers/historyCommandHandler.ts`.
  - Action schema: `.../system/schema/conversationActionSchema.ts`.
  - Action handler: `.../system/action/conversationActionHandler.ts` — each
    action **delegates to its equivalent `@conversation` command** so the logic
    lives in exactly one place and the two paths cannot drift.
  - Tests: `.../test/conversationGrammar.spec.ts` and
    `.../test/conversationActionHandler.spec.ts`.
- Catalog verifier (rebuild once, then regenerate to check counts each phase):
  `node tools/actionBrowser/dist/cli.js --out tmp/action-browser.html --json`.
  Baseline at planning time: 33 agents / 558 actions / 415 command entries;
  313 leaf commands, 12 with an action link, 301 without.

## Link map — existing actions (add `readonly action`, no new logic)

Add the link field to each command handler and rebuild. For actions that live in
a **sub-schema** use the object form `{ schema, actionName }` (sub-schema names
come from the manifest `subActionManifests`); a bare `actionName` is fine when
unique within the agent.

- **localPlayer** — `packages/agents/playerLocal/src/agent/localPlayerCommands.ts`:
  play→`playFile`, pause→`pause`, resume→`resume`, stop→`stop`, next→`next`,
  prev→`previous`, shuffle→`shuffle`, status→`status`, list→`listFiles`,
  queue→`showQueue`, clear→`clearQueue`, mute→`mute`, volume→`setVolume`,
  setfolder→`setMusicFolder`, folder→`showMusicFolder`.
- **powershell** — `packages/agents/powershell/src/actionHandler.mts` (command
  handlers ~L950–1150): list→`listPowerShellFlows`, run→`executePowerShellFlow`,
  delete→`deletePowerShellFlow`, import→`importPowerShellFlow`.
- **osNotifications** — `packages/agents/osNotifications/src/osNotificationsActionHandler.ts`:
  sync→`syncOsNotifications`, test→`testOsNotification`.
- **selfhelp** — `packages/agents/selfhelp/src/selfHelpActionHandler.ts` (~L175):
  ask→`answerTypeAgentQuestion`.
- **browser** — `packages/agents/browser/src/agent/browserActionHandler.mts`
  (CommandHandlerTable ~L3468): open→`openWebPage`, close→`closeWebPage`,
  extractKnowledge→`extractPageKnowledge` (knowledge sub-schema),
  learn→`startGoalDrivenTask` (webFlows), actions match→`detectPageActions`
  (actionDiscovery), actions infer→`inferActions`, actions record→`createWebFlowFromRecording`.
  `ask`→`searchWebMemories` is a **partial** match — verify the grammar covers
  "ask about this page," otherwise add a small page-scoped answer action.

## New actions — genuine gaps

Every new action type MUST follow the onboarding agent's **schema-authoring
guidelines**: the shared `schemaGuidelines` constant in
`packages/dispatcher/dispatcher/src/translation/schemaGuidelines.ts` (exported via
`agent-dispatcher/internal`; it is the exact system prompt the onboarding
`schemaGen` handler uses). In short:

- Comments live **above** the declaration (no inline trailing comments), ordered
  broad-context / aliases → `IMPORTANT`/`NOTE` hard constraints → a one-sentence
  **identity line** immediately above the type/property (identity closest to the
  declaration).
- The action-level block leads with user/agent example pairs, then rules, then
  the one-sentence "what it does" directly above the type.
- Hard constraints embed a concrete `WRONG` / `RIGHT` example above the identity
  line.
- Enum-like parameters are explicit unions of string literals (never bare
  `string`); the identity line names the underlying enum and default. Don't
  overfit examples to real user/benchmark data; prefer widening the right action
  over "DO NOT use for" anti-examples.

Pattern per new action: (1) add the interface to `<name>Schema.ts` with comments
per `schemaGuidelines`; (2) add phrasings to `<name>Schema.agr` (or lean on
schema translation); (3) implement it in the `executeAction` switch, delegating
to the **same** service/helper the command calls (no divergence); (4) add the
`readonly action` link on the command; (5) add grammar + action-handler tests
mirroring the conversation specs.

Gaps to author:

- **email `index`** — `packages/agents/email` (`emailActionsSchema.ts`,
  `emailSchema.agr`, `emailActionHandler.ts`): new `indexInbox` action reusing the
  `@email index` command logic. Phrasings like "index my inbox."
- **auth login/logout** (agent-prefixed verb naming):
  `calendarLogin`/`calendarLogout` (`packages/agents/calendar` — `calendarActionsSchemaV3.ts`,
  grammar, `calendarActionHandlerV3.ts`); `emailLogin`/`emailLogout`
  (`packages/agents/email`); `spotifyLogin`/`spotifyLogout`
  (`packages/agents/player` — `playerSchema.ts`, `playerSchema.agr`,
  `playerHandlers.ts`; the commands are `@player spotify login|logout`).
- **browser config & search-provider management** (~13 actions, last & most
  collision-prone): external on/off, resolver history/keyword/list, lookup
  mode/status, search add/import/list/remove/set/show. Put these in a
  config-oriented **sub-schema** and favor schema-based translation with narrow
  phrasings so they don't collide with the main browser `search` action.

## Phases

1. **Pilot — localPlayer (linking only).** Add the 15 links. Build; regenerate
   the catalog; confirm "without action" drops by 15. Enable the agent
   (`@config localPlayer on`) and smoke-test an NL phrasing. This proves the
   rebuild + verify loop.
2. **Link the remaining matches.** powershell (4), osNotifications (2), selfhelp
   (1), browser page-ops (7). Verify the `ask` phrasing.
3. **New auth actions.** calendar + email + Spotify login/logout.
4. **New action.** email `index`.
5. **New browser config / search-provider actions** (collision-aware; do last).

## Verification

- Build per agent: `pnpm run build <agent>` (fluid-build from `ts/`) or
  `pnpm --filter <pkg> build`.
- Regenerate the catalog after each phase and diff the without-action count.
- Add a grammar spec + an action-handler spec per new action (mirror the
  conversation specs); `pnpm --filter <pkg> test`; `pnpm run prettier:fix`.
- Manual: enable the agent, speak a phrasing, confirm the action fires with the
  right parameters.

## Decisions (locked)

- Linking adds metadata only and reuses existing NL — no duplicated logic. New
  actions must delegate to the same service/helper the command calls so the two
  paths can't drift.
- **Excluded for now:** `google-auth` OAuth callbacks (take an auth-code
  argument, not spoken), dispatcher diagnostics (`request` / `match` /
  `translate` / `reason` / `reasoning` / `explain` — circular), and the CLI-only
  commands `powershell show`, browser `auto launch hidden|standalone`, `auto
close`, and `actions stop recording`.
- **Auth naming:** agent-prefixed verbs (`calendarLogin`, `emailLogout`,
  `spotifyLogin`, …) — not `connect`/`disconnect`, not bare `login`/`logout`.
- **Default-off agents stay off** (localPlayer, player, osNotifications); their
  actions translate only when the agent is enabled (enable on demand).

## Open design detail (non-blocking)

- Browser config actions (phase 5): confirm main schema vs. a new config
  sub-schema (recommend sub-schema) and the grammar-collision mitigation for
  "search …" phrasings.
