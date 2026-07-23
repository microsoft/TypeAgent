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
only: the model must still ground every submitted location with `repo.read`,
and each LSP request consumes the shared repository-call budget.

Both programs share one repository snapshot, observation ledger, call budget,
and bounded TypeAgent reasoning session. The model sees the compact grounded
result of discovery before generating refinement, then sees refinement evidence
before invoking the typed `submitExploration` action. Final locations are
validated against that ledger; an invalid submission receives bounded observed
ranges so the same session can repair it. The MCP transport remains in
`packages/mcp/explore`; the benchmark remains separately packaged in
`packages/exploreBench`.
