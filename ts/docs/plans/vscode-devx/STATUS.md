# TypeAgent Studio — Status

> Living status of the VS Code DevX work. Unlike `DESIGN.md` (which describes
> the **intended** end state), this file tracks what is **actually built today**
> and what remains. Update it whenever a capability changes state.

Branch: feature work has merged to `main` via PR #2468; ongoing work continues
on `dev/talzacc/typeagent_studio`.

## Capability matrix

Legend: ✅ done · 🟡 partial · ❌ not started.
"Wired to dispatcher" = backed by the real TypeAgent dispatcher/engine rather
than an in-memory stand-in.

| Capability                                                     | Core logic                                   | UI                                       | Wired to dispatcher                                   | Tested |
| -------------------------------------------------------------- | -------------------------------------------- | ---------------------------------------- | ----------------------------------------------------- | ------ |
| Sandboxes (lifecycle, agent load/unload)                       | ✅ in-memory                                 | ✅ tree view                             | ❌ in-memory only (no subprocess/isolated dispatcher) | ✅     |
| Sandbox persistence across reload/restart                      | ✅                                           | ✅ (auto-restore)                        | n/a                                                   | ✅     |
| Corpora (federation: in-repo / captures / external / feedback) | ✅ file-backed                               | ✅ tree view                             | n/a                                                   | ✅     |
| Event Log (structured event stream)                            | 🟡 in-memory ring buffer                     | ✅ tree view                             | ❌ most emit sites unwired                            | ✅     |
| Agent health (status bar + findings)                           | 🟡 heuristic/filesystem checks               | ✅ status bar                            | ❌ no real schema parse / grammar compile             | ✅     |
| Collisions (cross-schema grammar overlap)                      | ✅ real NFA scanner over compiled `.ag.json` | ✅ tree view + Skipped group + auto-scan | n/a (reads compiled grammars)                         | ✅     |
| Feedback (thumbs up/down → corpus)                             | ✅                                           | ✅ command                               | n/a                                                   | ✅     |
| Replay / compare engine                                        | 🟡 engine + command                          | 🟡 quick-pick (no Impact Report)         | ❌ identity resolver (no two-version build/dispatch)  | ✅     |
| Onboarding bridge (snapshot/restore, stale detection)          | ✅                                           | ✅ commands                              | ❌ in-memory bridge                                   | ✅     |
| Repo-root detection (find `packages/agents`)                   | ✅                                           | ✅ warn toast + status bar               | n/a                                                   | ✅     |
| Webview infrastructure (`webviewKit`)                          | ❌                                           | ❌                                       | —                                                     | ❌     |
| Impact Report webview                                          | ❌                                           | ❌                                       | ❌                                                    | ❌     |
| Player corpus capture                                          | ❌                                           | ❌                                       | ❌                                                    | ❌     |
| Schema Studio                                                  | ❌                                           | ❌                                       | ❌                                                    | ❌     |
| Live Trace                                                     | ❌                                           | ❌                                       | ❌                                                    | ❌     |
| `agr-language` / `vscode-shell` refactor onto core             | 🟡 dependency edge only                      | —                                        | ❌ no behavioral integration                          | ❌     |

## The long pole

The headline "find a regression" journey (capture → replay two versions →
Impact Report) is **not** closed:

- **No webview infrastructure exists.** Impact Report, Schema Studio, Wizard,
  Trace, and Live Trace all depend on a `webviewKit` that hasn't been started.
  This is the single biggest hidden dependency.
- **Replay is an identity-comparison shell.** The default resolver returns each
  corpus entry's captured `expectedAction` for _both_ versions, producing an
  all-equal baseline (`studioRuntimeCore.ts` `identityReplayResolver`). There is
  no git-worktree build, transient dispatcher, or version-specific resolution.
- **No capture-to-corpus path.** `vscode-shell` depends on core but doesn't use
  it; without capture the Impact Report would have no real labelled corpus.
- **Health gives false confidence.** It does not run the schema parser or
  compile `.agr`; `grammar.rules.targetKnownActions` is currently a no-op pass
  (`health/service.ts`). It can mark things healthier than the dispatcher would.

## Recently completed (this work stream)

- Health handler discovery uses `package.json` `exports` (dispatcher contract)
  instead of filename heuristics; chat-style agents opt out of the
  "needs grammar" rule via `manifest.schema.injected`.
- Sandbox set persists across reload/restart (workspace-state snapshot).
- Collisions view: "Skipped (N)" group surfacing each skipped schema's reason
  and owning agent; auto-scan (debounced) when the loaded agent set changes.
- Collisions skips distinguish `no-grammar` (by design), `grammar-not-built`
  (buildable — has `.agr` + an `agc` script; offers an inline "Build grammar"
  action that runs `agc:all` as a VS Code task then re-scans), and grammar
  source with no compile step (e.g. `email`, shown but not buildable).
- Repo-root detection: finds the directory containing `packages/agents` by
  probing each workspace folder, its `ts/` subdir, and ancestors; warns clearly
  when none is found.
- Investigated the player/crossword/workbench collision-scan compile errors —
  root cause is an engine issue (see Known issues), not a per-agent defect.
- Repo policy + CodeQL fixes for the two new packages (LICENSE, Trademarks,
  `crypto.randomUUID`, polynomial-regex removal).

## Next slice candidates

Smallest → larger.

1. **Configurable agent search paths** (next follow-up PR). Add a
   `typeagentStudio.agentSearchPaths: string[]` setting — directories that
   contain agent subdirectories (peer to `packages/agents`), relative entries
   resolved against the repo root. Generalize the single hardcoded
   `packages/agents` assumption into an ordered list of agent roots threaded
   through health (`discoverAgentFiles` / `FileHealthService`), the sandbox
   loader (`createRepoAgentLoader`), and the collision scanner
   (`createRepoGrammarScanner`), plus discovery (`listAvailableAgents`), so
   agents outside `packages/agents` (e.g. a sibling `agents/` directory in a
   submodule) fully load, report health, and participate in collisions. Keep
   `packages/agents` + the registry config as implicit defaults; the setting is
   additive and generic (no hardcoded paths).
2. **Loader parity for registry entries** — the Load agent picker lists the
   `defaultAgentProvider` registry keys, but the loader still resolves by
   `packages/agents/<name>`, so keys whose folder differs (e.g. `localPlayer`,
   `workflow`) load with `health: unknown`. Resolve registry entries by their
   package `name` like the dispatcher does. (Folds naturally into item 1.)
3. **Split `studioRuntimeCore.ts`** into bounded runtime modules
   (sandbox/corpus/collision/replay/onboarding) before webviews land — it is
   already a god/facade object.
4. **Minimal `webviewKit` + Impact Report shell** — prove lifecycle, state
   restore, CSP/assets, message protocol, theming before full replay exists.
5. **Player corpus capture** — wire `vscode-shell` request/feedback IDs into the
   core corpus.
6. **One real replay path** — one agent, one utterance, working tree vs. HEAD,
   real dispatch; validate the Impact Report contract.

## Known issues

- **Collision scan can't compile many agents' optimized grammars**
  (`compile-error: Cannot compile: unknown variable t` / `__opt_v_0`).
  Confirmed-affected: `list`, `timer`, `desktop`, `github-cli`, `powershell`,
  `visualStudio`, `player`, `browser`'s `crossword`, `code`'s `workbench`.
  Root cause: the `agc` **optimizer** rewrites two constructs into rule
  fragments that reference a variable not bound in the flattened rule —
  (1) **optional groups**, emitted as `__opt_v_N`, and (2) **inlined captures**
  from sub-rules (e.g. the built-in `Ordinal`/`Cardinal` compound number rules
  `$(t:<Tens>) (\-)? $(o:<OrdinalOnes>) -> t + o` in `builtInEntities.agr`,
  leaving `t` dangling). `grammar-tools-core`'s re-compilation
  (`action-grammar/environment.ts`) rejects these. The grammar **source is
  valid** and the **dispatcher consumes these grammars fine** (it uses the
  precompiled dispatch tables rather than re-compiling the AST); a fresh `agc`
  rebuild does **not** fix it. Engine-level issue for the action-grammar /
  grammar-tools owners, not a per-agent grammar defect. The Skipped view
  surfaces it honestly as a compile error.
  - Agents that **do** scan cleanly today: `calendar`, `weather`, `ipconfig`,
    `discord`, `vampire`, `utility`, `screencapture`, `osNotifications`.

## Build / test

From `ts/`:

```bash
pnpm i

# Engine library (jest against dist/test/*.spec.js — build first):
pnpm --filter "@typeagent/core" build
pnpm --filter "@typeagent/core" test          # 124 tests

# Extension (esbuild bundles core into dist/extension.js; tests via tsx/node:test):
pnpm --filter typeagent-studio build
pnpm --filter typeagent-studio test:local     # 107 tests

# Package + install the VSIX into the local VS Code:
cd packages/typeagent-studio
pnpm build && pnpm deploy:local               # then: Developer: Reload Window
```

## Known gotchas

- **Open `ts/`, not the git root.** Repo-root detection now finds
  `packages/agents` under `ts/` (or by walking up), and warns if it can't —
  but pointing Studio at a folder with no agents still yields empty views.
- **esbuild inlines core into the extension bundle.** Changes to
  `@typeagent/core` require a `typeagent-studio` rebuild to be visible.
- **Installed VSIX vs. F5 dev host.** Rebuilding `dist/extension.js` does not
  update an installed VSIX — use `pnpm deploy:local` + reload, or run via F5.
- **`vsce package` needs a LICENSE** in the package directory (now present).
- **`string-union` action params** throw "Unknown type string-union" via
  `confirmTranslation` when `@config dev on` (pre-existing dispatcher bug,
  `actionTemplate.ts`), unrelated to Studio but can surface during agent work.
