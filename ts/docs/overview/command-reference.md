# TypeAgent Command Reference

> **Auto-generated — do not edit by hand.** This file is produced by
> `docs-autogen --command-reference`, which walks the command descriptors
> registered by the dispatcher and each bundled agent. To change a command's
> summary, arguments, or flags, edit its `CommandDescriptor` in the agent source
> and regenerate. Extended prose for a command belongs in the README next to the
> code that implements it, not here. See the
> [doc-autogen guide](../contributing/doc-autogen.md#the-command-reference---command-reference).

This is the reference for TypeAgent's `@` commands, generated directly from the
command descriptors registered by the dispatcher and the bundled application
agents. Commands without an agent prefix (e.g. `@config`) are handled by the
built-in **system** agent; every other agent prefixes its commands with the
agent name (e.g. `@dispatcher reason`).

Availability depends on the client (for example, `@shell` commands provided by
the desktop shell do not work on the CLI) and on which agents are enabled. Some
clients register additional agents that are not part of the default bundle;
those commands are documented with their respective
[agents](../agents/index.md). Run `@help` in any client to list what is
currently available.

## @action - Execute an action

Usage: `@action [--naturalLanguage <string>] [--parameters <json>] <schemaName> <actionName>`

### Arguments:

- &lt;schemaName&gt; - Action schema name (type: string)
- &lt;actionName&gt; - Action name (type: string)

### Flags:

- --parameters &lt;json&gt; : Action parameter
- --naturalLanguage &lt;string&gt; : Natural language phrase to associate with this action for cache population

## @session new - Create a new empty session

Usage: `@session new [--persist] [--keep]`

### Flags:

- --keep : Copy the current session settings in the new session (default: false)
- --persist : Persist the new session. Default to whether the current session is persisted.

## @session open - Open an existing session

Usage: `@session open <session>`

### Arguments:

- &lt;session&gt; - Name of the session to open. (type: string)

## @session reset - Reset config on session and keep the data

Usage: `@session reset`

## @session clear - Delete all data on the current sessions, keeping current settings

Usage: `@session clear`

## @session list - List all sessions. The current session is marked green.

Usage: `@session list`

## @session delete - Delete a session. If no session is specified, delete the current session and start a new session.

-a to delete all sessions

Usage: `@session delete [-a|--all] [<session>]`

### Arguments:

- &lt;session&gt; - (optional) Session name to delete (type: string)

### Flags:

- --all -a : Delete all sessions

## @session info - Show info about the current session

Usage: `@session info`

## @conversation new - Create a new conversation, optionally with a name

Usage: `@conversation new [<name>]`

### Arguments:

- &lt;name&gt; - (optional) Name for the new conversation (optional) (type: string)

## @conversation list - List all conversations

Usage: `@conversation list`

## @conversation info - Show info about the current conversation

Usage: `@conversation info`

## @conversation switch - Switch to a conversation by name (defaults to the next conversation in the list)

Usage: `@conversation switch [<name>]`

### Arguments:

- &lt;name&gt; - (optional) Name of the conversation to switch to (omit to cycle to the next) (type: string)

## @conversation prev - Switch to the previous conversation in the list (wraps around)

Usage: `@conversation prev`

## @conversation next - Switch to the next conversation in the list (wraps around)

Usage: `@conversation next`

## @conversation rename - Rename a conversation. With one argument, renames the current conversation; with two, renames the named conversation.

Usage: `@conversation rename <nameOrNewName> [<newName>]`

### Arguments:

- &lt;nameOrNewName&gt; - New name (renames current) or existing name (when newName given) (type: string)
- &lt;newName&gt; - (optional) New name when renaming a specific conversation (type: string)

## @conversation delete - Delete a conversation by name

Usage: `@conversation delete <name>`

### Arguments:

- &lt;name&gt; - Name of the conversation to delete (type: string)

## @conversation help - Show conversation command help

Usage: `@conversation help`

## @copilot import - Import GitHub Copilot Chat sessions as conversation mirrors

Usage: `@copilot import`

## @collision events - Show recent collision events captured in the current session's ring buffer

Usage: `@collision events [-k|--kind <string>] [-n|--limit <number>]`

### Flags:

- --limit -n &lt;number&gt; : Maximum number of events to show (default 10) (default: 10)
- --kind -k &lt;string&gt; : Filter by detection point (one of: static, grammarMatch, llmSelect, fuzzy)

## @collision similar - Find semantically similar actions across agents (multi-vector embedding similarity, clusters by default)

Usage: `@collision similar [--no-cache] [--json <string>] [-n|--top <number>] [--pairs] [--all-strategies] [-s|--strategy <string>] [-t|--threshold <number>]`

### Flags:

- --threshold -t &lt;number&gt; : Per-strategy score threshold (default 0.85; raw cosine scale) (default: 0.85)
- --strategy -s &lt;string&gt; : Named scoring strategy (use `@collision similar list-strategies` to see all). Default: balanced (default: balanced)
- --all-strategies : Run every strategy and render a comparison view (default: false)
- --pairs : Render pairwise (legacy view) instead of clusters (default: false)
- --top -n &lt;number&gt; : Maximum clusters / pairs to render (default 50) (default: 50)
- --json &lt;string&gt; : Write the structured scan result + applied-strategy data to this path as JSON
- --no-cache : Skip the on-disk embedding cache (forces re-embed) (default: false)

## @collision probe - Probe what action(s) a hand-crafted utterance would route to via the embedding ranker (top-K with cosine deltas)

Usage: `@collision probe [--include-inactive] [--delta <number>] [-e|--expected <string>] [-n|--top <number>] <phrase>`

### Arguments:

- &lt;phrase&gt; - The utterance to probe, e.g. "turn on wifi" (type: string)

### Flags:

- --top -n &lt;number&gt; : Top-K candidates to render (default 5) (default: 5)
- --expected -e &lt;string&gt; : Expected target as "schema.actionName" — flagged in the output if the top-1 candidate matches
- --delta &lt;number&gt; : Score delta below which the top two are flagged ambiguous (default 0.05, matches llmSelect.scoreDeltaThreshold) (default: 0.05)
- --include-inactive : Include schemas that aren't currently active in this session (default: false)

## @collision corpus generate - Generate an LLM-authored phrase corpus for every action in this dispatcher's loaded schemas (slow: ~12 min for the full set)

Usage: `@collision corpus generate [--workdir <string>] [--out <string>] [--concurrency <number>] [--styles <string>] [--models <string>] [--schemas <string>]`

### Flags:

- --schemas &lt;string&gt; : Comma-separated schemas to scan. Empty = all loaded schemas.
- --models &lt;string&gt; : Comma-separated chat-model names from ts/.env. Default: GPT_4_1,GPT_5,GPT_5_NANO
- --styles &lt;string&gt; : Comma-separated phrase styles to generate. Available: imperative,conversational,casual,polite,curt,slang,typos. Default: imperative,conversational,casual.
- --concurrency &lt;number&gt; : Concurrent LLM calls (default 8) (default: 8)
- --out &lt;string&gt; : Output corpus JSON file path (file name, not directory — use --workdir to choose the directory). Default: <instanceDir>/collisions/corpus.json
- --workdir &lt;string&gt; : Directory for default-named output files. Default: <instanceDir>/collisions

## @collision corpus probe - Replay a phrase corpus through the embedding ranker and classify each phrase as CLEAN / TIGHT / MISROUTE

Usage: `@collision corpus probe [--workdir <string>] [--concurrency <number>] [--delta <number>] [--top <number>] [--out <string>] [--in <string>]`

### Flags:

- --in &lt;string&gt; : Input corpus JSON path. Default: <workdir>/corpus.json
- --out &lt;string&gt; : Output probe-results JSON path. Default: <workdir>/probe-results.json
- --top &lt;number&gt; : Candidate rows kept per probe (default 5) (default: 5)
- --delta &lt;number&gt; : Tight-vs-clean threshold (default 0.05) (default: 0.05)
- --concurrency &lt;number&gt; : Concurrent probes (default 8) (default: 8)
- --workdir &lt;string&gt; : Directory for default-named files. Default: <instanceDir>/collisions

## @collision corpus translate - Replay a phrase corpus through the LLM translator (cache/grammar/exec/fuzzy off) and classify each phrase as CLEAN / MISROUTE / CLARIFY / INVALID / ERROR. Distinct from 'corpus probe' — that one runs the embedding ranker; this runs the actual translator.

Usage: `@collision corpus translate [--workdir <string>] [--output-suffix <string>] [--user-context-json <string>] [--user-context-mode <string>] [--model-label <string>] [--max-phrases <number>] [--strategy <string>] [--concurrency <number>] [--out <string>] [--in <string>]`

### Flags:

- --in &lt;string&gt; : Input corpus JSON path. Default: <workdir>/corpus.json
- --out &lt;string&gt; : Output translation-results JSON file path (file name, not directory — use --workdir to choose the directory). Default: <workdir>/translation-results.json (or translation-results-<suffix>.json when --output-suffix is set).
- --concurrency &lt;number&gt; : Concurrent translator calls (default 4 — chat completions are expensive) (default: 4)
- --strategy &lt;string&gt; : llmSelect strategy to force during the run. Default 'first-match' (suppresses user-clarify short-circuit). Reserved: future runs will sweep multiple strategies in one go. (default: first-match)
- --max-phrases &lt;number&gt; : Cap the run to N phrases (deterministic prefix). Useful for smoke tests.
- --model-label &lt;string&gt; : Label recorded in each row's `model` field. Reserved for future multi-model sweeps; defaults to 'default'.
- --user-context-mode &lt;string&gt; : How userContext is attached per phrase: 'none' (baseline, no injection), 'expected-schema' (derive from each phrase's expected schema via manifest), 'fixed' (use --user-context-json for every phrase). (default: none)
- --user-context-json &lt;string&gt; : JSON object parsed as UserContext when --user-context-mode=fixed. E.g. '{"activeApp":"spotify","activeAppDescription":"Spotify music agent"}'.
- --output-suffix &lt;string&gt; : When set and --out is not given, write to <workdir>/translation-results-<suffix>.json so baseline and context runs coexist in one workdir.
- --workdir &lt;string&gt; : Directory for default-named files. Default: <instanceDir>/collisions

## @collision corpus reanalyze - Re-classify saved probe results with prefix-aware action matching (recovers misroutes that were just naming differences)

Usage: `@collision corpus reanalyze [--workdir <string>] [--delta <number>] [--out <string>] [--in <string>]`

### Flags:

- --in &lt;string&gt; : Input probe-results JSON. Default: <workdir>/probe-results.json
- --out &lt;string&gt; : Output reclassified JSON. Default: <workdir>/probe-results-reclassified.json
- --delta &lt;number&gt; : Tight-vs-clean threshold (default 0.05) (default: 0.05)
- --workdir &lt;string&gt; : Directory for default-named files. Default: <instanceDir>/collisions

## @collision corpus recovery - Decompose MISROUTE results by where the correct target ranks among the top-K candidates (which fix lever applies?)

Usage: `@collision corpus recovery [--delta <number>] [--workdir <string>] [--in <string>]`

### Flags:

- --in &lt;string&gt; : Input reclassified probe-results JSON. Default: <workdir>/probe-results-reclassified.json
- --workdir &lt;string&gt; : Directory for default-named files. Default: <instanceDir>/collisions
- --delta &lt;number&gt; : llmSelect threshold for the rank-2 tight/wide split (default 0.05) (default: 0.05)

## @collision corpus visualize - Build an interactive HTML visualization of misroute hotspots from reclassified probe results, overlaid with a cross-schema similarity scan

Usage: `@collision corpus visualize [--workdir <string>] [--no-translator] [--translator <string>] [--no-similarity] [--similarity-threshold <string>] [--similarity-strategy <string>] [--top <number>] [--out <string>] [--in <string>]`

### Flags:

- --in &lt;string&gt; : Input reclassified probe-results JSON. Default: <workdir>/probe-results-reclassified.json
- --out &lt;string&gt; : Output HTML path. Default: <workdir>/collisions-viz.html
- --top &lt;number&gt; : Sankey edge count (default 60) (default: 60)
- --similarity-strategy &lt;string&gt; : Similarity strategy for the overlay (default balanced)
- --similarity-threshold &lt;string&gt; : Similarity threshold for the overlay, decimal in [0,1] (default 0.85)
- --no-similarity : Skip the similarity overlay; produce a corpus-only viz (default: false)
- --translator &lt;string&gt; : Translator-probe results JSON to overlay (enables the 'translator-confirmed' source filter). Default: <workdir>/translation-results.json when present. Use --no-translator to skip.
- --no-translator : Skip the translator overlay even if translation-results.json is present (default: false)
- --workdir &lt;string&gt; : Directory for default-named files. Default: <instanceDir>/collisions

## @collision corpus visualize-recovery - Build an interactive HTML visualization of recovery-rank analysis (which fix lever applies, per action and per agent)

Usage: `@collision corpus visualize-recovery [--workdir <string>] [--delta <number>] [--out <string>] [--in <string>]`

### Flags:

- --in &lt;string&gt; : Input reclassified probe-results JSON. Default: <workdir>/probe-results-reclassified.json
- --out &lt;string&gt; : Output HTML path. Default: <workdir>/recovery-viz.html
- --delta &lt;number&gt; : llmSelect threshold for the rank-2 tight/wide split (default 0.05) (default: 0.05)
- --workdir &lt;string&gt; : Directory for default-named files. Default: <instanceDir>/collisions

## @collision corpus run - Run the full corpus pipeline (generate → probe → reanalyze → visualize) with consistent file naming

Usage: `@collision corpus run [--sankey-top <number>] [--top <number>] [--delta <number>] [--concurrency <number>] [--styles <string>] [--models <string>] [--schemas <string>] [--workdir <string>] [--from <string>]`

### Flags:

- --from &lt;string&gt; : Resume from a step: generate | probe | reanalyze | visualize (default generate) (default: generate)
- --workdir &lt;string&gt; : Directory for intermediate files. Default: <instanceDir>/collisions
- --schemas &lt;string&gt; : Comma-separated schemas (corpus only)
- --models &lt;string&gt; : Comma-separated model names (corpus only)
- --styles &lt;string&gt; : Comma-separated phrase styles (corpus only). Available: imperative,conversational,casual,polite,curt,slang,typos. Default: imperative,conversational,casual.
- --concurrency &lt;number&gt; : LLM concurrency (corpus only, default 8) (default: 8)
- --delta &lt;number&gt; : Tight-vs-clean threshold (probe + reanalyze, default 0.05) (default: 0.05)
- --top &lt;number&gt; : Probe candidate rows (default 5) (default: 5)
- --sankey-top &lt;number&gt; : Sankey edge count (default 60) (default: 60)

## @collision neighborhoods - Build neighborhoods directly from translator misroute edges and write a persisted JSON index plus an HTML viz.

Usage: `@collision neighborhoods [--workdir <string>] [--out-html <string>] [--out <string>] [--samples-per-category <number>] [--include-same-schema] [--min-misroute <number>] [--corpus <string>]`

### Flags:

- --corpus &lt;string&gt; : Translator probe results JSON (default <workdir>/translation-results.json)
- --min-misroute &lt;number&gt; : Drop edges below this count (default 2) (default: 2)
- --include-same-schema : Include same-schema misroute edges (e.g. email.send + email.reply). Default: true (default: true)
- --samples-per-category &lt;number&gt; : Per-category cap on edge sample phrases (default 5). (default: 5)
- --out &lt;string&gt; : Output JSON path (default <workdir>/neighborhoods.json)
- --out-html &lt;string&gt; : Output HTML path (default <workdir>/neighborhoods.html)
- --workdir &lt;string&gt; : Directory for default-named files. Default: <instanceDir>/collisions

## @collision optimize list-levers - List all registered optimization levers with their description, consumes, and probeType.

Usage: `@collision optimize list-levers`

## @collision optimize explore - Run the optimize loop on the top-N collision neighborhoods. Writes an attempts archive under <workdir>/optimization-run-<ts>/.

Usage: `@collision optimize explore [--concurrency <number>] [--dry-run] [--workdir <string>] [--severity <string>] [--lever <string>] [--depth <number>] [--hypotheses-per-lever <number>] [--top <number>] [--baseline <string>] [--corpus <string>]`

### Flags:

- --corpus &lt;string&gt; : Path to neighborhoods.json (default <workdir>/neighborhoods.json)
- --baseline &lt;string&gt; : Path to translation-results.json (default <workdir>/translation-results.json)
- --top &lt;number&gt; : Top-N cases by gravity to run (default 5) (default: 5)
- --hypotheses-per-lever &lt;number&gt; : K hypotheses per lever per case (default 3). Reserved — levers pick K from this flag in a future revision. (default: 3)
- --depth &lt;number&gt; : Recursion depth budget (default 2). When all hypotheses at depth N regress, the case loop re-prompts the LLM with the failed mechanisms and asks for a different approach. (default: 2)
- --lever &lt;string&gt; : Comma-separated lever names. Default: all registered levers.
- --severity &lt;string&gt; : Comma-separated severity tiers to include (default blocker,leaky). Allowed: blocker, leaky, minor. (default: blocker,leaky)
- --workdir &lt;string&gt; : Directory for default-named files. Default: <instanceDir>/collisions
- --dry-run : Write attempt scaffolding only — no LLM calls, no apply, no probe. (default: false)
- --concurrency &lt;number&gt; : Reserved for future per-case parallelism. (default: 8)

## @collision optimize validate - Stack all winners from an optimization run and re-probe the full baseline corpus. Emits optimization-impact.{json,html} with cross-neighborhood regression flags.

Usage: `@collision optimize validate [--leave-one-out <string>] [--winners <string>] [--workdir <string>] [--baseline <string>] [--phrases <string>] [--run <string>]`

### Flags:

- --run &lt;string&gt; : Run timestamp (the <ts> in optimization-run-<ts>/). Default: latest under <workdir>.
- --phrases &lt;string&gt; : Restrict re-probing to phrases for a single neighborhood id. Faster for targeted iteration.
- --baseline &lt;string&gt; : Override the baseline path recorded in optimization-run.json (useful when the original baseline moved).
- --workdir &lt;string&gt; : Directory containing optimization-run-\* subdirectories. Default: <instanceDir>/collisions.
- --winners &lt;string&gt; : Comma-separated attemptIds to include. Stacks ONLY these winners. Mutually exclusive with --leave-one-out.
- --leave-one-out &lt;string&gt; : Comma-separated attemptIds to EXCLUDE. Stacks every winner except these. Useful for ablation — drop a suspected harmful winner and see whether the global numbers improve.

## @collision optimize patterns - Mine patterns.jsonl across all accumulated optimize runs. Emits patterns.{json,html} with three groupings (mechanism × pattern, per-lever, lever-effectiveness) plus classifier agreement.

Usage: `@collision optimize patterns [--workdir <string>] [--out-html <string>] [--out <string>] [--surface-disagreement <string>] [--min-attempts <number>] [--patterns-file <string>]`

### Flags:

- --patterns-file &lt;string&gt; : Path to patterns.jsonl. Default: <workdir>/patterns.jsonl
- --min-attempts &lt;number&gt; : Cells with fewer attempts than this render as '—' (default 5). (default: 5)
- --surface-disagreement &lt;string&gt; : Highlight classifier-disagreement cells above this rate (0-1, default 0.5). (default: 0.5)
- --out &lt;string&gt; : Output JSON path (default <workdir>/patterns.json).
- --out-html &lt;string&gt; : Output HTML path (default <workdir>/patterns.html).
- --workdir &lt;string&gt; : Directory containing patterns.jsonl. Default: <instanceDir>/collisions.

## @collision optimize run - Run the full optimize pipeline (neighborhoods → explore → validate → patterns → distill) with --from gating. Each step's predecessor must exist before it runs.

Usage: `@collision optimize run [--workdir <string>] [--distill-min-attempts <number>] [--skip-distill] [--dry-run] [--severity <string>] [--lever <string>] [--depth <number>] [--top <number>] [--from <string>]`

### Flags:

- --from &lt;string&gt; : Resume from a step: neighborhoods | explore | validate | patterns | distill (default neighborhoods) (default: neighborhoods)
- --top &lt;number&gt; : Top-N cases (forwarded to explore, default 5) (default: 5)
- --depth &lt;number&gt; : Recursion depth (forwarded to explore, default 2). (default: 2)
- --lever &lt;string&gt; : Lever filter (forwarded to explore)
- --severity &lt;string&gt; : Severity tiers (forwarded to explore, default blocker,leaky) (default: blocker,leaky)
- --dry-run : Dry-run mode (forwarded to explore). (default: false)
- --skip-distill : Skip the distill step regardless of attempt count. (default: false)
- --distill-min-attempts &lt;number&gt; : Minimum winners in patterns.jsonl before distill runs (default 10). (default: 10)
- --workdir &lt;string&gt; : Directory for pipeline intermediates. Default: <instanceDir>/collisions.

## @collision optimize distill - Distill winning attempts in patterns.jsonl into candidate schemaGuidelines additions. Groups winners by (mechanism, guidelineHook), calls the LLM with the current schemaGuidelines as context, writes schemaGuidelines.candidates.md for operator review.

Usage: `@collision optimize distill [--workdir <string>] [--min-attempts <number>]`

### Flags:

- --min-attempts &lt;number&gt; : Minimum winners in patterns.jsonl before distill runs (default 10). (default: 10)
- --workdir &lt;string&gt; : Workdir containing patterns.jsonl.

## @collision optimize browse - Generate browse.html for one or more optimization-run-\* directories. Walks the run, writes a sortable case index plus a self-contained case.html per case showing every attempt with before/after diffs.

Usage: `@collision optimize browse [--workdir <string>] [--all] [--run <string>]`

### Flags:

- --run &lt;string&gt; : Run timestamp suffix (the <ts> in optimization-run-<ts>/). Default: latest run under <workdir>.
- --all : Generate browse.html for ALL optimization-run-\* directories under <workdir>. Overrides --run. (default: false)
- --workdir &lt;string&gt; : Directory containing optimization-run-\* subdirectories. Default: <instanceDir>/collisions.

## @collision preferences list - List stored collision preferences (Tier-1)

Usage: `@collision preferences list`

## @collision preferences set - Set an explicit collision preference: among a candidate set, always pick the chosen option

Usage: `@collision preferences set <candidates> <chosen>`

### Arguments:

- &lt;candidates&gt; - Comma-separated competing options as schema.action, e.g. "player.play,list.play". (type: string)
- &lt;chosen&gt; - The option to always pick, as schema.action. Must be one of the candidates. (type: string)

## @collision preferences remove - Remove a stored collision preference by key (see `@collision preferences list`)

Usage: `@collision preferences remove <key>`

### Arguments:

- &lt;key&gt; - The preference key to remove. (type: string)

## @collision preferences clear - Remove every stored collision preference

Usage: `@collision preferences clear`

## @collision keywords - Inspect/tune contextSelector keyword vectors: @collision keywords [<schema.action> [list|add|remove|clear] [keywords…]]

Usage: `@collision keywords [<tokens>...]`

### Arguments:

- &lt;tokens&gt; - (optional) e.g. "list.addItems", "list.addItems add grocery shopping", or omit to list all overrides. (type: string)

## @collision keywords backfill - Backfill/refresh committed keyword files for agent actions. Lexical by default; --llm uses the preferred LLM distillation pass.

Usage: `@collision keywords backfill [--force] [--llm] [<schemas>...]`

### Arguments:

- &lt;schemas&gt; - (optional) Schema names to backfill; omit to backfill every loaded schema. (type: string)

### Flags:

- --llm : Use LLM distillation (the preferred producer) instead of the deterministic lexical floor. (default: false)
- --force : Overwrite an existing LLM-distilled file with a lexical one (a lexical backfill preserves llm files by default). (default: false)

## @collision list-strategies - List the named strategies available for `@collision similar -s <name>`

Usage: `@collision list-strategies`

## @grammar list - List grammar rules learned at runtime (optionally filtered by agent)

Usage: `@grammar list [<agent>]`

### Arguments:

- &lt;agent&gt; - (optional) Agent name to filter by (e.g. 'list', 'player') (type: string)

## @grammar show - Show a stored grammar rule by ID

Usage: `@grammar show <id>`

### Arguments:

- &lt;id&gt; - Numeric ID of the rule to inspect (type: number)

## @grammar delete - Delete a stored grammar rule by ID

Usage: `@grammar delete <id>`

### Arguments:

- &lt;id&gt; - Numeric ID of the rule to delete (type: number)

## @grammar clear - Clear stored grammar rules (optionally for a specific agent)

Usage: `@grammar clear [<agent>]`

### Arguments:

- &lt;agent&gt; - (optional) Agent name to clear rules for. Omit to clear all stored rules. (type: string)

## @grammar collisions - Scan all loaded agent grammars for cross-agent collisions, with concrete witness inputs

Usage: `@grammar collisions [--json <string>]`

### Flags:

- --json &lt;string&gt; : Write the structured scan result to this path as JSON (in addition to rendering the report)

## @history list - List history

Usage: `@history list`

## @history clear - Clear the history

Usage: `@history clear [--activity]`

### Flags:

- --activity : Clear the current activity context (default: true)

## @history delete - Delete a specific message from the chat history

Usage: `@history delete <index>`

### Arguments:

- &lt;index&gt; - Chat history index to delete. (type: number)

## @history insert - Insert messages to chat history

Usage: `@history insert <messages>`

### Arguments:

- &lt;messages&gt; - Chat history messages to insert (type: json)

## @history save - Save the chat history to a file

Usage: `@history save <file>`

### Arguments:

- &lt;file&gt; - File to save the chat history to (type: string)

## @history entities list - Shows all of the entities currently in 'working memory.'

Usage: `@history entities list`

## @history entities delete - Delete entities from the chat history (working memory).

Usage: `@history entities delete <entityId>`

### Arguments:

- &lt;entityId&gt; - The UniqueId of the entity (type: string)

## @memory legacy on - Turn on legacy

Usage: `@memory legacy on`

## @memory legacy off - Turn off legacy

Usage: `@memory legacy off`

## @memory query - Search conversation memory

Usage: `@memory query [--distinct] [--count <number>] [--knowledge] [--message] [--asc] <terms>...`

### Arguments:

- &lt;terms&gt; - Terms to search in conversation memory (type: string)

### Flags:

- --asc : Sort results in ascending order (default: true)
- --message : Display message (default: true)
- --knowledge : Display knowledge (default: true)
- --count &lt;number&gt; : Display count of results (default: 25)
- --distinct : Display distinct results (default: false)

## @memory search - Answer a question using conversation memory

Usage: `@memory search [--distinct] [--count <number>] [--knowledge] [--message] [--asc] <question>`

### Arguments:

- &lt;question&gt; - Question to ask the conversation memory (type: string)

### Flags:

- --asc : Sort results in ascending order (default: true)
- --message : Display message (default: false)
- --knowledge : Display knowledge (default: false)
- --count &lt;number&gt; : Display count of results (default: 25)
- --distinct : Display distinct results (default: false)

## @memory answer - Answer a question using conversation memory

Usage: `@memory answer [--distinct] [--count <number>] [--knowledge] [--message] [--asc] <question>`

### Arguments:

- &lt;question&gt; - Question to ask the conversation memory (type: string)

### Flags:

- --asc : Sort results in ascending order (default: true)
- --message : Display message (default: false)
- --knowledge : Display knowledge (default: false)
- --count &lt;number&gt; : Display count of results (default: 25)
- --distinct : Display distinct results (default: false)

## @const new - Create a new construction store

Usage: `@const new [<file>]`

### Arguments:

- &lt;file&gt; - (optional) File name to be created in the session directory or path to the file to be created. (type: string)

## @const load - Load a construction store from disk

Usage: `@const load [<file>]`

### Arguments:

- &lt;file&gt; - (optional) Construction file in the session directory or path to file (type: string)

## @const save - Save construction store to disk

Usage: `@const save [<file>]`

### Arguments:

- &lt;file&gt; - (optional) Construction file in the session directory or path to file (type: string)

## @const auto on - Turn on construction auto save

Usage: `@const auto on`

## @const auto off - Turn off construction auto save

Usage: `@const auto off`

## @const off - Disable construction store

Usage: `@const off`

## @const info - Show current construction store info

Usage: `@const info`

## @const list - List constructions

Usage: `@const list [--id <number>] [-p|--part <string>] [-m|--match <string>] [-b|--builtin] [-a|--all] [-v|--verbose]`

### Flags:

- --verbose -v : Verbose only. Includes part index, and list all string in match set (default: false)
- --all -a : List all string in match set (default: false)
- --builtin -b : List the construction in the built-in cache (default: false)
- --match -m &lt;string&gt; : Filter to constructions that has the string in the match set
- --part -p &lt;string&gt; : Filter to constructions that has the string match in the part name
- --id &lt;number&gt; : Construction id to list

## @const import - Import constructions from test data

Usage: `@const import [-t|--extended] [<file>...]`

### Arguments:

- &lt;file&gt; - (optional) Path to the construction file to import from. Load host specified test files if not specified. (type: string)

### Flags:

- --extended -t : Load host specified extended test files if no file argument is specified (default: false)

## @const prune - Prune out of date construction from the cache

Usage: `@const prune`

## @const delete - Delete a construction by id

Usage: `@const delete <namespace> <id>`

### Arguments:

- &lt;namespace&gt; - namespace the construction in (type: string)
- &lt;id&gt; - construction id to delete (type: number)

## @const builtin on - Turn on construction built-in cache

Usage: `@const builtin on`

## @const builtin off - Turn off construction built-in cache

Usage: `@const builtin off`

## @const merge on - Turn on construction merge

Usage: `@const merge on`

## @const merge off - Turn off construction merge

Usage: `@const merge off`

## @const wildcard on - Turn on wildcard matching

Usage: `@const wildcard on`

## @const wildcard off - Turn off wildcard matching

Usage: `@const wildcard off`

## @const wildcard entity on - Turn on entity wildcard matching

Usage: `@const wildcard entity on`

## @const wildcard entity off - Turn off entity wildcard matching

Usage: `@const wildcard entity off`

## @config schema - Toggle agent schemas

Usage: `@config schema [-f|--priority <string>] [-x|--off <string>] [-r|--reset] [<agentNames>...]`

### Arguments:

- &lt;agentNames&gt; - (optional) enable pattern (type: string)

### Flags:

- --reset -r : reset to default (default: false)
- --off -x &lt;string&gt; : disable pattern
- --priority -f &lt;string&gt; : priority pattern

## @config action - Toggle agent actions

Usage: `@config action [-f|--priority <string>] [-x|--off <string>] [-r|--reset] [<agentNames>...]`

### Arguments:

- &lt;agentNames&gt; - (optional) enable pattern (type: string)

### Flags:

- --reset -r : reset to default (default: false)
- --off -x &lt;string&gt; : disable pattern
- --priority -f &lt;string&gt; : priority pattern

## @config command - Toggle agent commands

Usage: `@config command [-f|--priority <string>] [-x|--off <string>] [-r|--reset] [<agentNames>...]`

### Arguments:

- &lt;agentNames&gt; - (optional) enable pattern (type: string)

### Flags:

- --reset -r : reset to default (default: false)
- --off -x &lt;string&gt; : disable pattern
- --priority -f &lt;string&gt; : priority pattern

## @config agent - Toggle agents

Usage: `@config agent [-f|--priority <string>] [-x|--off <string>] [-r|--reset] [<agentNames>...]`

### Arguments:

- &lt;agentNames&gt; - (optional) enable pattern (type: string)

### Flags:

- --reset -r : reset to default (default: false)
- --off -x &lt;string&gt; : disable pattern
- --priority -f &lt;string&gt; : priority pattern

## @config agent setup - Run setup for an agent that needs configuration before use

Usage: `@config agent setup [<agentName>]`

### Arguments:

- &lt;agentName&gt; - (optional) agent to set up (omit to list agents that need setup) (type: string)

## @config agent refresh - Re-check an agent's readiness state (or all agents)

Usage: `@config agent refresh [<agentName>]`

### Arguments:

- &lt;agentName&gt; - (optional) agent to refresh (omit for all enabled agents) (type: string)

## @config request - Set the agent that handle natural language requests

Usage: `@config request <appAgentName>`

### Arguments:

- &lt;appAgentName&gt; - name of the agent (type: string)

## @config match grammar on - Turn on grammar cache usage

Usage: `@config match grammar on`

## @config match grammar off - Turn off grammar cache usage

Usage: `@config match grammar off`

## @config cache grammarSystem - Set grammar system (completionBased or nfa)

Usage: `@config cache grammarSystem <system>`

### Arguments:

- &lt;system&gt; - Grammar system to use (type: string)

## @config cache useDFA - Enable or disable DFA matching within the NFA grammar system (faster; requires grammarSystem=nfa)

Usage: `@config cache useDFA <enabled>`

### Arguments:

- &lt;enabled&gt; - true or false (type: string)

## @config translation on - Turn on translation

Usage: `@config translation on`

## @config translation off - Turn off translation

Usage: `@config translation off`

## @config translation model - Set model

Usage: `@config translation model [-r|--reset] [<model>]`

### Arguments:

- &lt;model&gt; - (optional) Model name (type: string)

### Flags:

- --reset -r : Reset to default model (default: false)

## @config translation multi on - Turn on multiple action translation

Usage: `@config translation multi on`

## @config translation multi off - Turn off multiple action translation

Usage: `@config translation multi off`

## @config translation multi result on - Turn on result id in multiple action

Usage: `@config translation multi result on`

## @config translation multi result off - Turn off result id in multiple action

Usage: `@config translation multi result off`

## @config translation multi pending on - Turn on pending request in multiple action

Usage: `@config translation multi pending on`

## @config translation multi pending off - Turn off pending request in multiple action

Usage: `@config translation multi pending off`

## @config translation switch on - Turn on switch schema

Usage: `@config translation switch on`

## @config translation switch off - Turn off switch schema

Usage: `@config translation switch off`

## @config translation switch fix - Set a fixed schema disable switching

Usage: `@config translation switch fix <schemaName>`

### Arguments:

- &lt;schemaName&gt; - name of the schema (type: string)

## @config translation switch inline on - Turn on inject inline switch

Usage: `@config translation switch inline on`

## @config translation switch inline off - Turn off inject inline switch

Usage: `@config translation switch inline off`

## @config translation switch search on - Turn on search switch

Usage: `@config translation switch search on`

## @config translation switch search off - Turn off search switch

Usage: `@config translation switch search off`

## @config translation switch embedding on - Turn on Use embedding for initial pick of schema

Usage: `@config translation switch embedding on`

## @config translation switch embedding off - Turn off Use embedding for initial pick of schema

Usage: `@config translation switch embedding off`

## @config translation history on - Turn on history

Usage: `@config translation history on`

## @config translation history off - Turn off history

Usage: `@config translation history off`

## @config translation history limit - Set the limit of chat history usage in translation

Usage: `@config translation history limit <limit>`

### Arguments:

- &lt;limit&gt; - Number of actions (type: number)

## @config translation stream on - Turn on streaming translation

Usage: `@config translation stream on`

## @config translation stream off - Turn off streaming translation

Usage: `@config translation stream off`

## @config translation schema generation on - Turn on generated action schema

Usage: `@config translation schema generation on`

## @config translation schema generation off - Turn off generated action schema

Usage: `@config translation schema generation off`

## @config translation schema generation json on - Turn on use generate json schema if model supports it

Usage: `@config translation schema generation json on`

## @config translation schema generation json off - Turn off use generate json schema if model supports it

Usage: `@config translation schema generation json off`

## @config translation schema generation jsonFunc on - Turn on use generate json schema function if model supports it

Usage: `@config translation schema generation jsonFunc on`

## @config translation schema generation jsonFunc off - Turn off use generate json schema function if model supports it

Usage: `@config translation schema generation jsonFunc off`

## @config translation schema optimize on - Turn on schema optimization

Usage: `@config translation schema optimize on`

## @config translation schema optimize off - Turn off schema optimization

Usage: `@config translation schema optimize off`

## @config translation schema optimize actions - Set number of actions to use for initial translation

Usage: `@config translation schema optimize actions <count>`

### Arguments:

- &lt;count&gt; - Number of actions (type: number)

## @config translation entity resolve on - Turn on entity resolution

Usage: `@config translation entity resolve on`

## @config translation entity resolve off - Turn off entity resolution

Usage: `@config translation entity resolve off`

## @config translation entity filter on - Turn on entity filter using LLM

Usage: `@config translation entity filter on`

## @config translation entity filter off - Turn off entity filter using LLM

Usage: `@config translation entity filter off`

## @config translation entity clarify on - Turn on entity clarification

Usage: `@config translation entity clarify on`

## @config translation entity clarify off - Turn off entity clarification

Usage: `@config translation entity clarify off`

## @config explainer on - Turn on explanation

Usage: `@config explainer on`

## @config explainer off - Turn off explanation

Usage: `@config explainer off`

## @config explainer async on - Turn on asynchronous explanation

Usage: `@config explainer async on`

## @config explainer async off - Turn off asynchronous explanation

Usage: `@config explainer async off`

## @config explainer name - Set explainer

Usage: `@config explainer name <explainerName>`

### Arguments:

- &lt;explainerName&gt; - name of the explainer (type: string)

## @config explainer model - Set model

Usage: `@config explainer model [-r|--reset] [<model>]`

### Arguments:

- &lt;model&gt; - (optional) Model name (type: string)

### Flags:

- --reset -r : Reset to default model (default: false)

## @config explainer filter on - Turn on all explanation filters

Usage: `@config explainer filter on`

## @config explainer filter off - Turn off all explanation filters

Usage: `@config explainer filter off`

## @config explainer filter multiple on - Turn on explanation filter multiple actions

Usage: `@config explainer filter multiple on`

## @config explainer filter multiple off - Turn off explanation filter multiple actions

Usage: `@config explainer filter multiple off`

## @config explainer filter reference on - Turn on all explanation reference filters

Usage: `@config explainer filter reference on`

## @config explainer filter reference off - Turn off all explanation reference filters

Usage: `@config explainer filter reference off`

## @config explainer filter reference value on - Turn on explainer filter reference by value in the request

Usage: `@config explainer filter reference value on`

## @config explainer filter reference value off - Turn off explainer filter reference by value in the request

Usage: `@config explainer filter reference value off`

## @config explainer filter reference list on - Turn on explainer filter reference using word lists

Usage: `@config explainer filter reference list on`

## @config explainer filter reference list off - Turn off explainer filter reference using word lists

Usage: `@config explainer filter reference list off`

## @config explainer filter reference translate on - Turn on explainer filter reference by translate without context

Usage: `@config explainer filter reference translate on`

## @config explainer filter reference translate off - Turn off explainer filter reference by translate without context

Usage: `@config explainer filter reference translate off`

## @config execution activity on - Turn on activity context

Usage: `@config execution activity on`

## @config execution activity off - Turn off activity context

Usage: `@config execution activity off`

## @config execution reasoning - Set reasoning engine

Usage: `@config execution reasoning <engine>`

### Arguments:

- &lt;engine&gt; - Reasoning engine to use (claude, copilot, or none) (type: string)

## @config execution conversationAnswer - How conversation questions are answered: 'lookup' (conversation-memory lookup, reasoning as fallback), 'reasoning-first' (reasoning agent primary, lookup as fallback), or 'reasoning-only' (remove the lookup action; reasoning handles conversation Q&A)

Usage: `@config execution conversationAnswer <strategy>`

### Arguments:

- &lt;strategy&gt; - 'lookup' (default), 'reasoning-first', or 'reasoning-only' (type: string)

## @config execution reasoningHistory - Number of recent conversation turns included as context in the reasoning prompt

Usage: `@config execution reasoningHistory <turns>`

### Arguments:

- &lt;turns&gt; - Number of recent conversation turns to include (e.g. 4). 0 disables history. Larger values give the reasoning agent more context at the cost of a bigger prompt. (type: number)

## @config execution recordUserMessages on - Turn on record the user's own messages in the conversation transcript (chat history)

Usage: `@config execution recordUserMessages on`

## @config execution recordUserMessages off - Turn off record the user's own messages in the conversation transcript (chat history)

Usage: `@config execution recordUserMessages off`

## @config execution planReuse - Enable or disable workflow plan reuse for reasoning actions

Usage: `@config execution planReuse <mode>`

### Arguments:

- &lt;mode&gt; - Plan reuse mode: 'enabled' to cache and reuse workflow plans, 'disabled' for standard reasoning (type: string)

## @config execution scriptReuse - Enable or disable PowerShell script reuse for reasoning actions

Usage: `@config execution scriptReuse <mode>`

### Arguments:

- &lt;mode&gt; - Script reuse mode: 'enabled' to capture and reuse PowerShell scripts, 'disabled' for standard reasoning (type: string)

## @config execution entityPromptShape - Shape used when serializing Entity objects into LLM prompts

Usage: `@config execution entityPromptShape <shape>`

### Arguments:

- &lt;shape&gt; - 'facets' (default, name+value array), 'flat' (collapse facets into a properties object), or 'facets-with-schema' (facets + append the Entity TS type to the reasoning system prompt) (type: string)

## @config execution setupOnFirstUse on - Turn on auto-run agent setup on first use (otherwise emit a hint to run @config agent setup)

Usage: `@config execution setupOnFirstUse on`

## @config execution setupOnFirstUse off - Turn off auto-run agent setup on first use (otherwise emit a hint to run @config agent setup)

Usage: `@config execution setupOnFirstUse off`

## @config modelProvider - Show or set the active model provider (azure | openai | ollama | copilot)

Usage: `@config modelProvider [<name>] [<action>]`

### Arguments:

- &lt;name&gt; - (optional) Provider to activate (azure | openai | ollama | copilot) (type: string)
- &lt;action&gt; - (optional) Optional 'list' to list provider's models (type: string)

## @config dev on - Turn on development mode (records conversation + translation data)

Usage: `@config dev on [-c|--confirm]`

### Flags:

- --confirm -c : Also confirm each translated action via the client before running it (default: false)

## @config dev off - Turn off development mode

Usage: `@config dev off`

## @config log db on - Turn on logging

Usage: `@config log db on`

## @config log db off - Turn off logging

Usage: `@config log db off`

## @config collision show - Show the current collision detection config

Usage: `@config collision show`

## @config collision static detect on - Turn on static collision detection

Usage: `@config collision static detect on`

## @config collision static detect off - Turn off static collision detection

Usage: `@config collision static detect off`

## @config collision static strategy - Set static resolution strategy (one of: warn, error)

Usage: `@config collision static strategy <strategy>`

### Arguments:

- &lt;strategy&gt; - strategy name (type: string)

## @config collision grammarMatch detect on - Turn on grammarMatch collision detection

Usage: `@config collision grammarMatch detect on`

## @config collision grammarMatch detect off - Turn off grammarMatch collision detection

Usage: `@config collision grammarMatch detect off`

## @config collision grammarMatch strategy - Set grammarMatch resolution strategy (one of: first-match, score-rank, priority, user-clarify, preference-clarify)

Usage: `@config collision grammarMatch strategy <strategy>`

### Arguments:

- &lt;strategy&gt; - strategy name (type: string)

## @config collision llmSelect detect on - Turn on llmSelect collision detection

Usage: `@config collision llmSelect detect on`

## @config collision llmSelect detect off - Turn off llmSelect collision detection

Usage: `@config collision llmSelect detect off`

## @config collision llmSelect strategy - Set llmSelect resolution strategy (one of: first-match, score-rank, priority, user-clarify, preference-clarify)

Usage: `@config collision llmSelect strategy <strategy>`

### Arguments:

- &lt;strategy&gt; - strategy name (type: string)

## @config collision fuzzy detect on - Turn on fuzzy collision detection

Usage: `@config collision fuzzy detect on`

## @config collision fuzzy detect off - Turn off fuzzy collision detection

Usage: `@config collision fuzzy detect off`

## @config collision fuzzy strategy - Set fuzzy resolution strategy (one of: first-match, score-rank, priority, user-clarify, preference-clarify)

Usage: `@config collision fuzzy strategy <strategy>`

### Arguments:

- &lt;strategy&gt; - strategy name (type: string)

## @config collision priority - Set priorityOrder (comma-separated agent names) used by the `priority` resolution strategy. Empty argument shows the current value.

Usage: `@config collision priority [<order>]`

### Arguments:

- &lt;order&gt; - (optional) Comma-separated agent names, e.g. "list,player,calendar". Use the empty string "" to clear. (type: string)

## @config collision preference enabled on - Turn on preference-clarify resolution

Usage: `@config collision preference enabled on`

## @config collision preference enabled off - Turn off preference-clarify resolution

Usage: `@config collision preference enabled off`

## @config collision preference source - Set which ambiguity source feeds the `preference-clarify` strategy. Empty argument shows the current value.

Usage: `@config collision preference source [<source>]`

### Arguments:

- &lt;source&gt; - (optional) One of: runtime, registry, both. (type: string)

## @config collision preference remember - Set how learned preferences are captured for the `preference-clarify` strategy. Empty argument shows the current value.

Usage: `@config collision preference remember [<mode>]`

### Arguments:

- &lt;mode&gt; - (optional) One of: prompt, always, never. (type: string)

## @config collision preference registry - Set the filesystem path to the known-ambiguous neighborhoods registry (neighborhoods.json). Empty string clears it.

Usage: `@config collision preference registry [<path>]`

### Arguments:

- &lt;path&gt; - (optional) Absolute path to neighborhoods.json. Use the empty string "" to clear. (type: string)

## @config collision preference registryFirst on - Turn on registry-first detection (scan all embedding candidates against the neighborhood registry, independent of the score-delta detector)

Usage: `@config collision preference registryFirst on`

## @config collision preference registryFirst off - Turn off registry-first detection (scan all embedding candidates against the neighborhood registry, independent of the score-delta detector)

Usage: `@config collision preference registryFirst off`

## @config collision telemetry emit on - Turn on collision telemetry ring buffer

Usage: `@config collision telemetry emit on`

## @config collision telemetry emit off - Turn off collision telemetry ring buffer

Usage: `@config collision telemetry emit off`

## @config collision telemetry debugLog on - Turn on collision telemetry debug log

Usage: `@config collision telemetry debugLog on`

## @config collision telemetry debugLog off - Turn off collision telemetry debug log

Usage: `@config collision telemetry debugLog off`

## @config collision telemetry experimentId - Set the experimentId tag attached to every emitted collision event. Empty string clears it.

Usage: `@config collision telemetry experimentId [<id>]`

### Arguments:

- &lt;id&gt; - (optional) Experiment tag, e.g. "E1.2-2026-05-12". Empty string "" clears. (type: string)

## @config collision contextSelector detect on - Turn on context-weighted resolution (contextSelector)

Usage: `@config collision contextSelector detect on`

## @config collision contextSelector detect off - Turn off context-weighted resolution (contextSelector)

Usage: `@config collision contextSelector detect off`

## @config collision contextSelector windowTurns - Get/set contextSelector windowTurns (ring-buffer look-back N over recent user turns)

Usage: `@config collision contextSelector windowTurns [<value>]`

### Arguments:

- &lt;value&gt; - (optional) New value; omit to show the current value. (type: number)

## @config collision contextSelector decay - Get/set contextSelector decay (per-turn recency decay lambda (0 < lambda <= 1))

Usage: `@config collision contextSelector decay [<value>]`

### Arguments:

- &lt;value&gt; - (optional) New value; omit to show the current value. (type: number)

## @config collision contextSelector minUniqueTokens - Get/set contextSelector minUniqueTokens (evidence gate: min distinct distinguishing tokens the winner must match)

Usage: `@config collision contextSelector minUniqueTokens [<value>]`

### Arguments:

- &lt;value&gt; - (optional) New value; omit to show the current value. (type: number)

## @config collision contextSelector minMass - Get/set contextSelector minMass (evidence gate: min winner matched mass)

Usage: `@config collision contextSelector minMass [<value>]`

### Arguments:

- &lt;value&gt; - (optional) New value; omit to show the current value. (type: number)

## @config collision contextSelector margin - Get/set contextSelector margin (clear-winner margin the winner must beat the runner-up by)

Usage: `@config collision contextSelector margin [<value>]`

### Arguments:

- &lt;value&gt; - (optional) New value; omit to show the current value. (type: number)

## @feedback list - List recent user-feedback entries (most recent first).

Usage: `@feedback list [--all] [--limit <number>]`

### Flags:

- --limit &lt;number&gt; : Maximum number of entries to show (default: 20)
- --all : Include every entry; otherwise only the latest rating per request is shown (default: false)

## @feedback top - Aggregate user feedback — counts by rating and category.

Usage: `@feedback top [--limit <number>]`

### Flags:

- --limit &lt;number&gt; : Top-N depth for the per-category breakdown (default: 10)

## @feedback filter - Filter feedback by rating, category, and/or date range.

Usage: `@feedback filter [--all] [--limit <number>] [--until <string>] [--since <string>] [--category <string>] [--rating <string>]`

### Flags:

- --rating &lt;string&gt; : up | down | cleared
- --category &lt;string&gt; : wrong-agent | didnt-understand | bad-response | other
- --since &lt;string&gt; : ISO date (YYYY-MM-DD) — entries on/after this date
- --until &lt;string&gt; : ISO date (YYYY-MM-DD) — entries on/before this date
- --limit &lt;number&gt; : Maximum number of entries to show (default: 50)
- --all : Include every entry; otherwise only the latest rating per request (default: false)

## @feedback export - Export user-feedback entries to a local file (JSON or JSONL).

Usage: `@feedback export [--all] [--format <string>] <file>`

### Arguments:

- &lt;file&gt; - Destination path (extension picks the format if --format is omitted: .jsonl → JSONL, anything else → JSON) (type: string)

### Flags:

- --format &lt;string&gt; : json | jsonl (overrides the path extension)
- --all : Include every entry; otherwise only the latest rating per request (default: false)

## @feedback count - Show the total number of feedback entries.

Usage: `@feedback count`

## @display - Send text to display

Usage: `@display [--inline] [--type <string>] [--speak] <text>...`

### Arguments:

- &lt;text&gt; - text to display (type: string)

### Flags:

- --speak : Speak the display for the host that supports TTS (default: false)
- --type &lt;string&gt; : Display type (default: text)
- --inline : Display inline (default: false)

## @trace - Enable or disable trace namespaces

Usage: `@trace [-*|--clear] [<namespaces>...]`

### Arguments:

- &lt;namespaces&gt; - (optional) Namespaces to enable (type: string)

### Flags:

- --clear -\* : Clear all trace namespaces (default: false)

## @help - Show help

Usage: `@help [-a|--all] [<command>]`

### Arguments:

- &lt;command&gt; - (optional) command to get help for (type: string)

### Flags:

- --all -a : shows all commands (default: false)

## @debug - Start node inspector

Usage: `@debug`

## @clear - Clear the console

Usage: `@clear`

## @clear deep - Clear the console and wipe chat history, reasoning, activity, and persistent display log so nothing replays on rejoin

Usage: `@clear deep`

## @run - Run a command script file

Usage: `@run <input>`

### Arguments:

- &lt;input&gt; - command script file path (type: string)

## @exit - Exit the program

Usage: `@exit`

## @shutdown - Shut down the agent server and exit

Usage: `@shutdown`

## @random online - Uses the LLM to generate random requests.

Usage: `@random online`

## @random offline - Issues a random request from a dataset of pre-generated requests.

Usage: `@random offline`

## @notify info - Shows the number of notifications available

Usage: `@notify info`

## @notify clear - Clears notifications

Usage: `@notify clear`

## @notify test - Fire a synthetic notification through the channel — for verifying chat rendering without an agent

Usage: `@notify test [--mode <string>] <message>`

### Arguments:

- &lt;message&gt; - Notification body text (type: string)

### Flags:

- --mode &lt;string&gt; : Render mode: toast | inline | info | warning | error (default: toast)

## @notify show unread - Shows unread notifications

Usage: `@notify show unread`

## @notify show all - Shows all notifications

Usage: `@notify show all`

## @token summary - Get overall LLM usage statistics.

Usage: `@token summary`

## @token details - Gets detailed LLM usage statistics.

Usage: `@token details`

## @env all - Echos environment variables to the user interface.

Usage: `@env all`

## @env get - Echos the value of a named environment variable to the user interface

Usage: `@env get <name>`

### Arguments:

- &lt;name&gt; - The name of the environment variable. (type: string)

## @open - Shortcut for opening system related folders

Usage: `@open <folder>`

### Arguments:

- &lt;folder&gt; - The name or path of the folder to open (type: string)

## @index list - List indexes

Usage: `@index list`

## @index create - Create a new index

Usage: `@index create <type> <name> <location>`

### Arguments:

- &lt;type&gt; - The type of index to create [image, email, website] (type: string)
- &lt;name&gt; - Name of the index (type: string)
- &lt;location&gt; - Location of the index (type: string)

## @index delete - Delete an index

Usage: `@index delete <name>`

### Arguments:

- &lt;name&gt; - Name of the index to delete (type: string)

## @index info - Show index details

Usage: `@index info <name>`

### Arguments:

- &lt;name&gt; - Name of the index (type: string)

## @settings - Show all persistent user settings

Usage: `@settings`

## @settings show - Show all persistent user settings

Usage: `@settings show`

## @settings reset - Reset all settings to defaults

Usage: `@settings reset`

## @settings server hidden - Set whether the AgentServer starts hidden (true/false)

Usage: `@settings server hidden <value>`

### Arguments:

- &lt;value&gt; - true or false (type: string)

## @settings server idleTimeout - Set idle timeout in seconds (0 to disable)

Usage: `@settings server idleTimeout <seconds>`

### Arguments:

- &lt;seconds&gt; - Timeout in seconds (0 = disabled) (type: number)

## @settings conversation resume - Set whether to resume the last conversation on startup (true/false)

Usage: `@settings conversation resume <value>`

### Arguments:

- &lt;value&gt; - true or false (type: string)

## @settings ui autoComplete - Set whether inline autocompletion is enabled in the CLI (true/false)

Usage: `@settings ui autoComplete <value>`

### Arguments:

- &lt;value&gt; - true or false (type: string)

## @ports - Lists ports registered by agents and the number of clients connected to each.

Usage: `@ports`

## @dispatcher request - Translate and explain a request

Usage: `@dispatcher request [<request>]`

### Arguments:

- &lt;request&gt; - (optional) Request to translate (type: string)

## @dispatcher match - Match a request

Usage: `@dispatcher match <request>`

### Arguments:

- &lt;request&gt; - Request to match (type: string)

## @dispatcher translate - Translate a request

Usage: `@dispatcher translate [--history] <request>`

### Arguments:

- &lt;request&gt; - Request to translate (type: string)

### Flags:

- --history : Use history in translation (default: false)

## @dispatcher reason - Reason about a request

Usage: `@dispatcher reason [--engine <string>] <request>`

### Arguments:

- &lt;request&gt; - Request to reason about (type: string)

### Flags:

- --engine &lt;string&gt; : Reasoning engine to use: claude, copilot, or none (default: )

## @dispatcher reasoning - Reason about a request

Usage: `@dispatcher reasoning [--engine <string>] <request>`

### Arguments:

- &lt;request&gt; - Request to reason about (type: string)

### Flags:

- --engine &lt;string&gt; : Reasoning engine to use: claude, copilot, or none (default: )

## @dispatcher explain - Explain a translated request with action

Usage: `@dispatcher explain [--concurrency <number>] [--filterReference] [--filterValueInRequest] [--repeat <number>] <requestAction>`

### Arguments:

- &lt;requestAction&gt; - Request to explain (type: string)

### Flags:

- --repeat &lt;number&gt; : Number of times to repeat the explanation (default: 1)
- --filterValueInRequest : Filter reference value for the explanation (default: false)
- --filterReference : Filter reference words (default: false)
- --concurrency &lt;number&gt; : Number of concurrent requests (default: 5)

## @browser auto launch hidden - Open a hidden/headless browser instance

Usage: `@browser auto launch hidden`

## @browser auto launch standalone - Open a standalone browser instance

Usage: `@browser auto launch standalone`

## @browser auto close - Close the new Web Content view

Usage: `@browser auto close`

## @browser open - Show a new Web Content view

Usage: `@browser open <site>`

### Arguments:

- &lt;site&gt; - Alias or URL for the site of the open. (type: string)

## @browser close - Close the new Web Content view

Usage: `@browser close`

## @browser external on - Enable external browser control

Usage: `@browser external on`

## @browser external off - Disable external browser control

Usage: `@browser external off`

## @browser resolver list - List all available URL resolvers

Usage: `@browser resolver list`

## @browser resolver keyword - Toggle keyword resolver

Usage: `@browser resolver keyword`

## @browser resolver history - Toggle history resolver

Usage: `@browser resolver history`

## @browser extractKnowledge - Extract knowledge from the current web page

Usage: `@browser extractKnowledge`

## @browser ask - Ask a question about the current web page using extracted knowledge

Usage: `@browser ask <question>`

### Arguments:

- &lt;question&gt; - Question to ask about the page (type: string)

## @browser learn - Learn a new action by demonstrating or describing it

Usage: `@browser learn <goal>`

### Arguments:

- &lt;goal&gt; - The goal to accomplish (what the action should do) (type: string)

## @browser actions match - Discover available actions on the current web page

Usage: `@browser actions match`

## @browser actions infer - Analyze page and infer new actions that can be automated

Usage: `@browser actions infer`

## @browser actions record - Record a new browser action by capturing user interactions

Usage: `@browser actions record <name>`

### Arguments:

- &lt;name&gt; - Name for the action to record (type: string)

## @browser actions stop recording - Stop recording and create a WebFlow

Usage: `@browser actions stop recording [<description>]`

### Arguments:

- &lt;description&gt; - (optional) Description of what the recorded action does (type: string)

## @browser search list - Lists browser agent search providers

Usage: `@browser search list`

## @browser search set - Sets the active search provider

Usage: `@browser search set <provider>`

### Arguments:

- &lt;provider&gt; - The name of the search provider to set as active. (type: string)

## @browser search show - Shows the details of the selected search provider

Usage: `@browser search show <provider>`

### Arguments:

- &lt;provider&gt; - The name of the search provider to show details for. (type: string)

## @browser search add - Adds a new search provider

Usage: `@browser search add <provider> <url>`

### Arguments:

- &lt;provider&gt; - The name of the search provider to add. (type: string)
- &lt;url&gt; - The URL of the search provider to add. '%s' will be replaced with the search parameter. (type: string)

## @browser search remove - Removes the selected search provider

Usage: `@browser search remove <provider>`

### Arguments:

- &lt;provider&gt; - The name of the search provider to remove. (type: string)

## @browser search import - Imports the search providers from the specified browser

Usage: `@browser search import <browser>`

### Arguments:

- &lt;browser&gt; - The name of the browser to import search providers from: [Edge | Chrome]. (type: string)

## @calendar login - Log into calendar service

Usage: `@calendar login`

## @calendar logout - Log out of calendar service

Usage: `@calendar logout`

## @calendar google-auth - Complete Google Calendar OAuth flow with authorization code

Usage: `@calendar google-auth <code>`

### Arguments:

- &lt;code&gt; - Authorization code from Google OAuth redirect (type: string)

## @email login - Log into email service

Usage: `@email login`

## @email logout - Log out of email service

Usage: `@email logout`

## @email google-auth - Complete Google Gmail OAuth flow with authorization code

Usage: `@email google-auth <code>`

### Arguments:

- &lt;code&gt; - Authorization code from Google OAuth redirect (type: string)

## @email index - Build keyword index from inbox emails for fast search

Usage: `@email index`

## @greeting - Have the agent generate a personalized greeting.

Usage: `@greeting [--mock]`

### Flags:

- --mock : Use mock greetings instead of generating. (default: false)

## @localPlayer status - Show local player status

Usage: `@localPlayer status`

## @localPlayer play - Play an audio file or resume playback

Usage: `@localPlayer play [<file>]`

### Arguments:

- &lt;file&gt; - (optional) File name or path to play (optional - plays first file if not specified) (type: string)

## @localPlayer pause - Pause playback

Usage: `@localPlayer pause`

## @localPlayer resume - Resume playback

Usage: `@localPlayer resume`

## @localPlayer stop - Stop playback

Usage: `@localPlayer stop`

## @localPlayer next - Play next track

Usage: `@localPlayer next`

## @localPlayer prev - Play previous track

Usage: `@localPlayer prev`

## @localPlayer folder - Show current music folder

Usage: `@localPlayer folder`

## @localPlayer setfolder - Set the music folder path

Usage: `@localPlayer setfolder <path>`

### Arguments:

- &lt;path&gt; - Path to the music folder (type: string)

## @localPlayer list - List audio files in music folder

Usage: `@localPlayer list`

## @localPlayer queue - Show playback queue

Usage: `@localPlayer queue`

## @localPlayer clear - Clear playback queue

Usage: `@localPlayer clear`

## @localPlayer shuffle - Toggle shuffle mode

Usage: `@localPlayer shuffle`

## @localPlayer volume - Set volume level (0-100)

Usage: `@localPlayer volume <level>`

### Arguments:

- &lt;level&gt; - Volume level (0-100) (type: string)

## @localPlayer mute - Toggle mute

Usage: `@localPlayer mute`

## @mcpfilesystem server - Set the server arguments

Usage: `@mcpfilesystem server <allowedDirectories>...`

### Arguments:

- &lt;allowedDirectories&gt; - Allowed directories for the file system agent to access (type: string)

## @osNotifications sync - Re-emit currently-present OS notifications through the agent pipeline. Windows only — Linux/macOS do not expose existing notifications.

Usage: `@osNotifications sync`

## @osNotifications test - Inject a synthetic notification through the agent pipeline (filters, rate limit, dismiss tracking) — useful for verifying the agent end-to-end without an OS notification source.

Usage: `@osNotifications test [--title <string>] [--app <string>] [<message>]`

### Arguments:

- &lt;message&gt; - (optional) Notification body text (defaults to 'Hello World!') (type: string)

### Flags:

- --app &lt;string&gt; : App name to attach to the synthetic notification (matched against allowList/blockList) (default: test)
- --title &lt;string&gt; : Notification title (defaults to 'Test') (default: Test)

## @package list - List installed agents

Usage: `@package list`

## @package available - List available agents from configured install sources

Usage: `@package available [-r|--refresh] [-s|--source <string>]`

### Flags:

- --source -s &lt;string&gt; : Optional source name to filter by
- --refresh -r : Refresh cache-backed source metadata before listing (default: false)

## @package install - Install an agent

Usage: `@package install [-r|--refresh] [-n|--dry-run] [-s|--source <string>] <target> [<name>]`

### Arguments:

- &lt;target&gt; - One-argument install: a default agent name, a package name, or a filesystem path. Two-argument install: the ref (path or package name) to install. (type: string)
- &lt;name&gt; - (optional) Optional explicit installed agent name. When given, the first argument is resolved only as a ref (path or package name); default agent names are not consulted. (type: string)

### Flags:

- --source -s &lt;string&gt; : Resolve only against this named source, bypassing the order.
- --dry-run -n : Preview how the target would resolve without installing. (default: false)
- --refresh -r : Refresh cache-backed source metadata before resolving. (default: false)

## @package update - Update an installed agent

Usage: `@package update <name> [<range>]`

### Arguments:

- &lt;name&gt; - Name of the agent to update (type: string)
- &lt;range&gt; - (optional) Optional version range for feed agents (e.g. ^1.4, ~2.0, '>=3 <4'). Updates are supported only for feed-sourced agents. (type: string)

## @package uninstall - Uninstall an agent

Usage: `@package uninstall <name>`

### Arguments:

- &lt;name&gt; - Name of the agent (type: string)

## @package source list - List install sources and the resolution order

Usage: `@package source list`

## @package source order - Set the resolution order (a subset is allowed; the named sources move to the front)

Usage: `@package source order <names>...`

### Arguments:

- &lt;names&gt; - Source names in priority order (first wins) (type: string)

## @package source remove - Remove an install source

Usage: `@package source remove [-f|--force] <name>`

### Arguments:

- &lt;name&gt; - Source name to remove (type: string)

### Flags:

- --force -f : Remove even when installed agents still reference this source (default: false)

## @package source add feed - Add a feed (npm-style registry) install source

Usage: `@package source add feed [-s|--scope <string>] [-r|--registry <string>] <name>`

### Arguments:

- &lt;name&gt; - Unique source name (type: string)

### Flags:

- --registry -r &lt;string&gt; : Feed registry URL (https). Optional: omit to use TYPEAGENT_FEED_REGISTRY at runtime
- --scope -s &lt;string&gt; : npm scope to enumerate (repeatable)

## @package source add catalog - Add a catalog (JSON manifest) install source

Usage: `@package source add catalog [-c|--catalog <string>] <name>`

### Arguments:

- &lt;name&gt; - Unique source name (type: string)

### Flags:

- --catalog -c &lt;string&gt; : Path to the catalog JSON file

## @package source add path - Add a filesystem path install source

Usage: `@package source add path [-b|--baseDir <string>] <name>`

### Arguments:

- &lt;name&gt; - Unique source name (type: string)

### Flags:

- --baseDir -b &lt;string&gt; : Optional base directory for relative refs

## @player spotify load - Load spotify user data

Usage: `@player spotify load <file>`

### Arguments:

- &lt;file&gt; - File to load (type: string)

## @player spotify login - Login to Spotify

Usage: `@player spotify login`

## @player spotify logout - Logout from Spotify

Usage: `@player spotify logout`

## @powershell list - List all registered PowerShell flows

Usage: `@powershell list`

## @powershell run - Execute a PowerShell flow by name

Usage: `@powershell run [--flowParametersJson <string>] <flowName>`

### Arguments:

- &lt;flowName&gt; - Name of the PowerShell flow to execute (type: string)

### Flags:

- --flowParametersJson &lt;string&gt; : JSON string of parameters, e.g. '{"path":"C:\\Users"}'

## @powershell delete - Delete a PowerShell flow by name

Usage: `@powershell delete <name>`

### Arguments:

- &lt;name&gt; - Name of the PowerShell flow to delete (type: string)

## @powershell show - Show details of a PowerShell flow

Usage: `@powershell show <flowName>`

### Arguments:

- &lt;flowName&gt; - Name of the PowerShell flow to show (type: string)

## @powershell import - Import a PowerShell script as a reusable PowerShell flow

Usage: `@powershell import [--actionName <string>] <filePath>`

### Arguments:

- &lt;filePath&gt; - Path to the .ps1 file to import (type: string)

### Flags:

- --actionName &lt;string&gt; : Override the generated action name
