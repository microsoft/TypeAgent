# TypeAgent VS Code Shell ⇄ GitHub Copilot — Parity & Gap Assessment

> **Status:** Baseline snapshot — **2026-07-16**. Point-in-time inventory to track progress toward unifying the TypeAgent VS Code experience with GitHub Copilot.
> **Audience:** Planning material for closing the code-editing inner-loop gap while preserving TypeAgent's multi-agent / voice / cross-surface strengths.
> **How to use:** Each gap has a stable ID (`G-A1`, `G-B2`, …). Update the **Status** column and append to the **Progress log** as work lands. Re-run the assessment and add a new dated section rather than overwriting rows.

---

## 0. Scope & framing

"TypeAgent in VS Code" is actually **three extensions plus a reasoning backend**, assessed together because they ship one underlying experience:

| Surface | Role |
| --- | --- |
| [`packages/vscode-shell`](../../../packages/vscode-shell/README.md) | Custom webview chat panel (sidebar + editor tabs), talks to the agent server over WebSocket. The main "shell in VS Code." Marketplace-eligible. |
| [`packages/vscode-chat`](../../../packages/vscode-chat/README.md) | Registers TypeAgent as a native Chat-view session provider (proposed `chatSessionsProvider` API; Insiders-only). |
| [`packages/coda`](../../../packages/coda/README.md) | The in-editor actuator for the `code` agent (create files, split editors, themes) — and it **delegates code generation to Copilot**. |
| [`reasoning/copilot.ts`](../../../packages/dispatcher/dispatcher/src/reasoning/copilot.ts) + [`packages/copilot-plugin`](../../../packages/copilot-plugin/README.md) | TypeAgent *uses* `@github/copilot-sdk` as a reasoning engine, and can *embed into* Copilot CLI as a plugin. |

**Central structural finding:** TypeAgent's VS Code coding capability is an NL/voice orchestration layer **on top of** Copilot, not a replacement for it. [`packages/coda/src/helpers.ts`](../../../packages/coda/src/helpers.ts) calls `isCopilotEnabled()`, `triggerAndMaybeAcceptInlineSuggestion()` (`editor.action.inlineSuggest.trigger`), `requestCopilotFix()`, and hands off to `workbench.action.chat.open`. TypeAgent does no code completion of its own.

Legend — **Gap:** Large / Medium / Small / None · **Status:** Open · In progress · Closed · Met (TypeAgent already at/above parity).

---

## A. In-editor coding assistance

| ID | Capability | GitHub Copilot | TypeAgent VS Code shell | Gap | Status |
| --- | --- | --- | --- | --- | --- |
| G-A1 | Inline completions (ghost text) | Yes | Partial (triggers *Copilot's* via coda) | Depends on Copilot | Open |
| G-A2 | Next-edit suggestions (NES) | Yes | No | Large | Open |
| G-A3 | Inline chat (Ctrl+I in editor) | Yes | No | Large | Open |
| G-A4 | Multi-file edits w/ diff → review → apply | Yes (Edit/Agent) | No (coda writes whole files; no diff/apply loop) | Large | Open |
| G-A5 | Autonomous agent loop (edit + tools + iterate) | Yes (Agent mode) | Partial (reasoning=copilot has `github/fs/*`, `shell`; no in-editor diff/checkpoint UX) | Medium | Open |
| G-A6 | Undo / checkpoints / edit history | Yes | No (conversation mgmt only) | Medium | Open |

## B. Context & grounding

| ID | Capability | GitHub Copilot | TypeAgent VS Code shell | Gap | Status |
| --- | --- | --- | --- | --- | --- |
| G-B1 | `#file` / `#selection` / `#editor` context | Yes | **No** — shell reads no editor state (no `activeTextEditor`/`selection` in extension source) | Large | Open |
| G-B2 | `@workspace` / `#codebase` semantic index | Yes | Partial (`github/search/*` via reasoning SDK; no persistent index) | Medium | Open |
| G-B3 | `#problems` / diagnostics, test-failure context | Yes | No (coda can *ask Copilot* to fix a diagnostic) | Medium | Open |
| G-B4 | `#changes` / git/staged diff context | Yes | No | Medium | Open |
| G-B5 | Vision / image input | Yes | Partial (chat-ui has `attachments` plumbing; not editor/vision-oriented) | Medium | Open |
| G-B6 | Terminal selection / command context | Yes (`@terminal`) | No | Small | Open |

## C. Chat UX & modes

| ID | Capability | GitHub Copilot | TypeAgent VS Code shell | Gap | Status |
| --- | --- | --- | --- | --- | --- |
| G-C1 | Distinct Ask / Edit / Agent modes | Yes | No (one conversational mode + optional reasoning) | Medium | Open |
| G-C2 | Code slash commands (`/explain`, `/fix`, `/tests`, `/doc`) | Yes | No (has `@agent` routing + `@config`, not code slashes) | Medium | Open |
| G-C3 | In-chat model picker | Yes (many models) | Partial (config/env `reasoningModel`, not a UI picker) | Small | Open |
| G-C4 | Streaming + cancellation/queue | Yes | Yes (rich queue/cancel, cross-client) | None | Met |
| G-C5 | Voice input | Yes | Yes (Azure Speech, [`azureSpeechProvider.ts`](../../../packages/vscode-shell/src/webview/azureSpeechProvider.ts)) | None | Met |

## D. Customization & extensibility

| ID | Capability | GitHub Copilot | TypeAgent VS Code shell | Gap | Status |
| --- | --- | --- | --- | --- | --- |
| G-D1 | Custom instructions (`copilot-instructions.md`, `AGENTS.md`) | Yes | No shell equivalent | Medium | Open |
| G-D2 | Prompt files (`.prompt.md`) | Yes | No (taskflow recipes are auto-generated, not authored) | Medium | Open |
| G-D3 | Custom chat modes / agents (`.chatmode.md`, `.agent.md`) | Yes (file-based) | Partial (agents are compiled TS plugins — heavier) | Medium | Open |
| G-D4 | Skills (`SKILL.md`) | Yes | No | Small | Open |
| G-D5 | MCP servers (as client) | Yes | Partial (mcp agent + copilot-plugin "mcp mode"; no shell-level MCP client UI) | Medium | Open |
| G-D6 | Per-tool approval / auto-approve controls | Yes (granular) | No (`onPermissionRequest: approveAll` in reasoning) | Medium (safety) | Open |

## E. Platform / ecosystem

| ID | Capability | GitHub Copilot | TypeAgent VS Code shell | Gap | Status |
| --- | --- | --- | --- | --- | --- |
| G-E1 | Cloud coding agent (issue → PR) | Yes | No | Large (different product) | Open |
| G-E2 | Code review (`/review`, PR review) | Yes | No | Medium | Open |
| G-E3 | Marketplace distribution | Yes | No (vscode-shell unpublished; vscode-chat needs proposed API) | Medium | Open |
| G-E4 | Enterprise auth, content exclusion, policy | Yes | No (own keys via `config.local.yaml`) | Medium | Open |

---

## F. Where TypeAgent leads (differentiators to preserve, not close)

- **Multi-domain agents beyond code** — [`packages/agents`](../../../packages/agents) ships browser automation, calendar, email, music/player, desktop, discord, image, montage, weather, lists, etc. Copilot is code-scoped.
- **One conversation across surfaces** — the same session is joinable from CLI, Electron shell, `vscode-shell`, and the native Chat view, with real-time shared queue/cancel state.
- **Deterministic action grammar + translation cache** — matches NL to typed actions without an LLM call where possible (`actionGrammar` / `cache`).
- **Conversation memory as a tool** — `search_memory` / `remember` over knowPro RAG, exposed to the reasoning loop.
- **Taskflow recipe auto-generation** — successful reasoning traces are distilled into reusable, grammar-matchable flows (`saveTaskFlowRecipeToStorage`).
- **Interoperates with Copilot both directions** — uses the Copilot SDK as a backend *and* plugs into Copilot CLI.

---

## G. Integration / leverage opportunities (unify, don't rebuild)

Because the relationship is symbiotic, several gaps are cheaper to close by wiring in Copilot than by reimplementing it. Ordered by ROI:

1. **Feed editor context into the shell (highest ROI).** Closes most of §B (`G-B1`–`G-B4`) with an extension-host change only — no server changes. Pipe `activeTextEditor` / selection / visible files / diagnostics into the prompt.
2. **Surface a per-tool approval UI (`G-D6`).** `approveAll` is the biggest safety gap vs. Copilot's confirmation model — route `onPermissionRequest` to a webview prompt.
3. **Adopt file-based customization (`G-D1`, `G-D2`).** Honor `AGENTS.md` / `copilot-instructions.md` and support `.prompt.md`-style saved prompts, mapping them onto the existing taskflow/recipe machinery.
4. **Expose Copilot's Edit/Agent surfaces from NL/voice (`G-A3`–`G-A5`).** coda already triggers inline suggest and Copilot Chat; extend it to drive Edit/Agent mode so repo-wide changes get Copilot's diff/apply/checkpoint UX for free.
5. **MCP client at the shell level (`G-D5`)** to reach parity with Copilot's tool ecosystem.

---

## Bottom line

The **largest true gaps** are all in the *code-editing inner loop*: no editor context (`G-B1`), no inline/edit/agent-mode diff-and-apply UX (`G-A3`–`G-A5`), and no code-aware slash commands (`G-C2`). Everything else is meaningful but secondary. TypeAgent's shell is best understood not as a Copilot competitor but as a **voice-first, multi-agent, cross-surface conversational layer** that can *orchestrate* Copilot — so the pragmatic unification path is to pipe editor context in and delegate deep coding work to Copilot's existing surfaces.

---

## Progress log

| Date | Change | Gaps touched | Notes |
| --- | --- | --- | --- |
| 2026-07-16 | Baseline assessment captured | — | Initial snapshot; all rows Open except `G-C4`, `G-C5` (Met). |
