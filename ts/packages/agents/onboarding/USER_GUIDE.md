# TypeAgent Onboarding — User Guide

This guide shows how to use an AI assistant (Claude Code, GitHub Copilot, or any MCP client) to onboard a new application or API into TypeAgent from start to finish.

The onboarding agent is itself a TypeAgent agent. Its actions are available in your AI assistant automatically via `discover_agents` — no extra registration required beyond the one-time MCP setup below.

---

## Step 0 — Register TypeAgent as an MCP server

Before you can use the onboarding agent from your AI assistant, you need to register TypeAgent's MCP server (`command-executor`) once. This is a one-time setup per machine.

### What it is

TypeAgent exposes a stdio MCP server at `ts/packages/commandExecutor/dist/server.js`. It provides three tools to your AI assistant:

| Tool              | What it does                                                  |
| ----------------- | ------------------------------------------------------------- |
| `discover_agents` | Lists all TypeAgent agents and their actions                  |
| `execute_action`  | Calls any agent action directly by name with typed parameters |
| `execute_command` | Passes a natural language request to the TypeAgent dispatcher |

The onboarding agent's actions (`startOnboarding`, `crawlDocUrl`, `generateSchema`, etc.) are discovered and called via these tools.

### Prerequisites

- Node.js ≥ 20 installed
- The TypeAgent repo cloned and built: `cd ts && pnpm install && pnpm run build`
- The TypeAgent agent-server running (started automatically on first use, or via `node packages/agentServer/server/dist/server.js` from `ts/`)
- `ts/.env` configured with your Azure OpenAI or OpenAI API keys

---

### Claude Code

Claude Code reads MCP server config from `.mcp.json` in your project root (or `~/.claude/mcp.json` for global config).

The repo already includes `ts/.mcp.json` with the `command-executor` server. **If you open Claude Code from the `ts/` directory, it will be picked up automatically.**

To verify it is active, run inside Claude Code:

```
/mcp
```

You should see `command-executor` listed as connected.

**If you need to register it manually** (e.g. you're working from a different directory), add this to your `.mcp.json`:

```json
{
  "mcpServers": {
    "typeagent": {
      "command": "node",
      "args": [
        "<absolute-path-to-repo>/ts/packages/commandExecutor/dist/server.js"
      ],
      "env": {}
    }
  }
}
```

Replace `<absolute-path-to-repo>` with the full path to your TypeAgent clone, for example:

- Windows: `C:/repos/TypeAgent/ts/packages/commandExecutor/dist/server.js`
- Mac/Linux: `/home/you/repos/TypeAgent/ts/packages/commandExecutor/dist/server.js`

Then restart Claude Code.

---

### GitHub Copilot (VS Code)

GitHub Copilot uses VS Code's MCP configuration. Add the TypeAgent server via the VS Code settings UI or directly in `settings.json`.

**Via settings.json** — open your VS Code `settings.json` (`Ctrl+Shift+P` → "Open User Settings (JSON)") and add:

```json
{
  "github.copilot.chat.mcpServers": {
    "typeagent": {
      "command": "node",
      "args": [
        "<absolute-path-to-repo>/ts/packages/commandExecutor/dist/server.js"
      ],
      "type": "stdio"
    }
  }
}
```

**Via the VS Code UI** — open the Command Palette (`Ctrl+Shift+P`), run **"MCP: Add MCP Server"**, choose **"Command (stdio)"**, and enter:

- Command: `node`
- Args: `<absolute-path-to-repo>/ts/packages/commandExecutor/dist/server.js`
- Name: `typeagent`

After saving, open a Copilot Chat panel. You should see the TypeAgent tools listed under the MCP tools icon (the plug icon in the chat input bar).

---

### Verify the connection

Once registered, ask your AI assistant:

```
> Discover TypeAgent agents
```

or

```
> What TypeAgent agents are available?
```

The assistant will call `discover_agents` and return a list that includes `onboarding` (among others). If you see the list, you're ready to start onboarding.

**Troubleshooting:**

- If the server isn't found, check that `ts/packages/commandExecutor/dist/server.js` exists — run `pnpm run build` from `ts/` if not
- If tools don't appear, restart your AI assistant or reload the VS Code window
- Logs are written to `~/.tmp/typeagent-mcp/` — check there for connection errors

---

## Prerequisites (after MCP setup)

- TypeAgent MCP server registered with your AI assistant (see above)
- Your `ts/.env` configured with API keys (the same ones TypeAgent already uses)
- The application you want to integrate is either documented online or has an OpenAPI spec

---

## How it works

You talk to your AI assistant in plain English. The assistant calls the onboarding agent's actions to do the work. Each phase produces artifacts saved to `~/.typeagent/onboarding/<name>/` so you can pause and come back anytime.

```
You (natural language)
    ↓
AI assistant (Claude Code / Copilot)
    ↓  MCP → list_commands → TypeAgent
Onboarding agent actions
    ↓
Artifacts on disk (schemas, phrases, grammar, agent package)
```

---

## Complete walkthrough: onboarding a REST API

Below is a realistic session. Lines starting with `>` are things you'd say to your AI assistant.

---

### Step 1 — Start the onboarding

```
> Start onboarding for Slack
```

The assistant calls `startOnboarding` and creates a workspace at `~/.typeagent/onboarding/slack/`.

---

### Step 2 — Discover the API surface

**From documentation URL:**

```
> Crawl the Slack API docs at https://api.slack.com/methods for slack
```

**From an OpenAPI spec file:**

```
> Parse the OpenAPI spec at C:\specs\slack-openapi.json for slack
```

**From an OpenAPI spec URL:**

```
> Parse the OpenAPI spec at https://raw.githubusercontent.com/slackapi/slack-api-specs/master/web-api/slack_web_openapi_v2.json for slack
```

After crawling, review what was found:

```
> List the discovered actions for slack
```

You'll see a table of all API actions with names and descriptions. Trim down to what you actually want:

```
> Approve the API surface for slack, excluding: listAllUsers, adminCreateWorkspace, deleteTeam
```

Or include only specific actions:

```
> Approve the API surface for slack, including only: postMessage, listChannels, getUserInfo, addReaction, uploadFile
```

---

### Step 3 — Generate sample phrases

```
> Generate phrases for slack
```

The assistant calls `generatePhrases` and asks the LLM to produce 5 natural language samples per action. You can tune the count:

```
> Generate 8 phrases per action for slack
```

Review the output. Add or remove specific phrases:

```
> Add phrase "DM John about the meeting" for action postMessage in slack
> Remove phrase "send a slack" from action postMessage in slack
```

When satisfied:

```
> Approve phrases for slack
```

---

### Step 4 — Generate the TypeScript action schema

```
> Generate the action schema for slack
```

The LLM produces a TypeScript file with union types and JSDoc comments mapping each action to the Slack API. Review the output in the response.

If you want changes:

```
> Refine the slack schema to make the channelId parameter optional and add a threadTs parameter to postMessage
```

```
> Refine the slack schema to split postMessage into postChannelMessage and postDirectMessage
```

When happy:

```
> Approve the slack schema
```

---

### Step 5 — Generate the grammar

```
> Generate the grammar for slack
```

The LLM produces a `.agr` file with natural language patterns for each action. Then validate it compiles:

```
> Compile the slack grammar
```

If compilation fails, the error message will tell you which rule is invalid. You can ask:

```
> Generate the grammar for slack
```

again after the schema is adjusted, or manually edit the grammar file at `~/.typeagent/onboarding/slack/grammarGen/schema.agr`.

When the grammar compiles cleanly:

```
> Approve the slack grammar
```

---

### Step 6 — Scaffold the agent package

```
> Scaffold the slack agent
```

This stamps out a complete TypeAgent agent package at `ts/packages/agents/slack/` with:

- `slackManifest.json`
- `slackSchema.ts` (the approved schema)
- `slackSchema.agr` (the approved grammar)
- `slackActionHandler.ts` (stub — ready for your implementation)
- `package.json`, `tsconfig.json`, `src/tsconfig.json`

If your integration talks to Slack over REST, scaffold the bridge too:

```
> Scaffold the slack rest-client plugin
```

For a WebSocket-based integration (like Excel or VS Code agents):

```
> Scaffold the slack websocket-bridge plugin
```

For an Office add-in:

```
> Scaffold the slack office-addin plugin
```

See what templates are available:

```
> List templates
```

---

### Step 7 — Package and register

```
> Package the slack agent
```

This runs `pnpm install` and `pnpm run build` in the agent directory.

To also register it with the local TypeAgent dispatcher immediately:

```
> Package the slack agent and register it
```

Then restart TypeAgent so it picks up the new agent.

---

### Step 8 — Run the tests

After TypeAgent has restarted with the agent registered:

```
> Generate tests for slack
> Run tests for slack
```

You'll get a pass/fail table. If tests fail:

```
> Get the failing test results for slack
> Propose a repair for slack
```

The LLM analyzes the failures and suggests specific changes to the schema and/or grammar. Review the proposal, then:

```
> Approve the repair for slack
```

Then re-run:

```
> Run tests for slack
```

Repeat until pass rate is satisfactory. A common target is >90% before handing off to users.

---

## Checking in on progress

At any point:

```
> What's the status of the slack onboarding?
```

You'll see a phase-by-phase table like:

```
| Phase       | Status     |
|-------------|------------|
| discovery   | ✅ approved |
| phraseGen   | ✅ approved |
| schemaGen   | ✅ approved |
| grammarGen  | 🔄 in-progress |
| scaffolder  | ⏳ pending |
| testing     | ⏳ pending |
| packaging   | ⏳ pending |
```

---

## Resuming an interrupted onboarding

If you close your session and come back later:

```
> Resume onboarding for slack
```

This tells you the current phase and what to do next. All artifacts are on disk — nothing is lost.

List all integrations in progress:

```
> List my integrations
> List integrations in progress
```

---

## Implementing the action handler

After scaffolding, you'll have a stub handler at `ts/packages/agents/slack/src/slackActionHandler.ts`. The stub looks like:

```typescript
async function executeAction(
  action: TypeAgentAction<SlackActions>,
  context: ActionContext<unknown>,
): Promise<ActionResult> {
  // TODO: implement action handlers
  return createActionResultFromTextDisplay(
    `Executing ${action.actionName} — not yet implemented.`,
  );
}
```

Fill in the cases using the Slack Web API client. For example:

```typescript
switch (action.actionName) {
  case "postMessage": {
    const result = await slackClient.chat.postMessage({
      channel: action.parameters.channelId,
      text: action.parameters.message,
    });
    return createActionResultFromTextDisplay(
      `Message sent to ${action.parameters.channelId}`,
    );
  }
  // ...
}
```

After implementing, rebuild:

```bash
cd ts/packages/agents/slack
pnpm run build
```

Then re-run tests:

```
> Run tests for slack
```

---

## Sample session: rapid onboarding via AI assistant

Here's a compressed example of what a full session looks like from the AI assistant's perspective:

```
You: I want to add a Jira integration to TypeAgent. It should support creating
     issues, searching issues, updating issue status, and adding comments.

AI: I'll kick off the Jira onboarding. Let me start by discovering the API surface.

    [calls startOnboarding for jira]
    [calls parseOpenApiSpec from https://developer.atlassian.com/cloud/jira/platform/swagger-v3.v3.json]
    Found 147 API actions. Here are a few:
      - createIssue: Creates a new issue
      - searchIssues: Searches for issues using JQL
      - transitionIssue: Transitions an issue to a new status
      - addComment: Adds a comment to an issue
      ...

    I'll approve just the 4 you specified.
    [calls approveApiSurface with includeActions: [createIssue, searchIssues, transitionIssue, addComment]]
    [calls generatePhrases]
    [calls approvePhrases]
    [calls generateSchema]

    Here's the generated schema — looks good, I'll approve it.
    [calls approveSchema]
    [calls generateGrammar]
    [calls compileGrammar] ✓ Compiled successfully
    [calls approveGrammar]
    [calls scaffoldAgent]

    The Jira agent is scaffolded at ts/packages/agents/jira/. Now I'll package
    and register it so we can run tests.

    [calls packageAgent with register: true]

    TypeAgent needs a restart to pick up the new agent. Once you've restarted:

    [calls generateTests]
    [calls runTests]

    Pass rate: 87% (35/40). Proposing repair for the 5 failing tests...
    [calls proposeRepair]
    [calls approveRepair]
    [calls runTests]

    Pass rate: 97% (39/40). One edge case remaining in searchIssues — acceptable.
    Onboarding complete! Implement slackActionHandler.ts to wire up the Jira API calls.
```

---

## Tips

**Start narrow.** Onboard 4–6 actions first, get them working end-to-end, then add more. You can re-run `generatePhrases`, `generateSchema`, and `generateGrammar` incrementally.

**Inspect artifacts directly.** All generated files are in `~/.typeagent/onboarding/<name>/`. You can edit them by hand before approving if the LLM output isn't quite right.

**Grammar failures are normal.** The `.agr` compiler is strict. If `compileGrammar` fails, ask the AI to regenerate the grammar, or read the error and fix the specific rule. Common issues are ambiguous wildcards and missing required words before captures.

**Test failures drive improvement.** A 70% pass rate on first run is typical. Two rounds of `proposeRepair` → `runTests` usually gets to 90%+. The LLM is good at diagnosing pattern mismatches.

**Re-use grows over time.** The second integration you onboard will reuse the doc crawler, phrase generator, and schema generator — only the integration-specific configuration changes.
