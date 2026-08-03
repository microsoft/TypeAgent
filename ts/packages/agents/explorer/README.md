# Explorer TypeAgent

The repository explorer application agent used by the single-tool explore MCP.
It follows the TypeAgent TaskFlow and Browser WebFlow Code Mode pattern:

- `manifest.json` and `schema/explorerActions.ts` define the loadable agent and
  its typed discovery, refinement, and submission actions.
- `actionHandler.ts` executes those actions within one request session.
- `exploreAgent.ts` runs the bounded TypeAgent reasoning loop and telemetry.
- `reasoning/explorerActionDispatcher.ts` registers that session as an
  `AppAgentProvider`, discovers its compiled schema, and executes direct
  schema-validated `@action` commands through the canonical dispatcher. The
  dispatcher receives the session through standard agent initialization
  options and disables unused semantic-schema embeddings.
- `agent-dispatcher/reasoning` supplies the native TypeAgent AI-client
  reasoning session with only `execute_action`.
- `script/sandboxDeclarations.ts` provides the typed `ls`/`glob`/`grep`/`read`
  API and conditionally adds symbol-based LSP navigation.
- `script/scriptValidator.ts` validates and transpiles generated programs with
  `@typeagent/agent-flows`.
- `script/scriptExecutor.ts` executes validated programs against the bounded
  repository API.
- `script/repositoryApi.ts` implements the read-only repository capabilities.

When LSP is enabled, an OpenCode-inspired registry selects a pre-provisioned
language server from the file extension and nearest project root. The registry
covers the same language-server families as OpenCode
`anomalyco/opencode@743f6410`; it never downloads or installs a server at
runtime. Python and TypeScript retain pinned defaults, while every other server
must already be on `PATH` or have an explicit command override. Failed
server/root pairs are suppressed for the rest of the session and the next
matching server is tried. Definition/reference results are navigation hints
only: the model must still ground every submitted location with successful
grep or read evidence, while LSP uses a separate two-call allowance and does
not consume the shared repository evidence-call budget.

Both programs share one repository snapshot, observation ledger, and evidence
call budget. The normal path completes three dependent requests in one Explorer
execution: `discoverRepository`, `refineRepository`, then
`submitExploration`. The final turn sees the accepted results of both Code Mode
programs before selecting locations and read dispositions. The host validates
the model-authored set without narrowing, ranking, adding, or repairing it.
Failed program executions discard their observations; bounded action repairs
remain part of the same fully charged execution. The MCP transport remains in
`packages/mcp/explore`; the benchmark remains separately packaged in
`packages/exploreBench`.
