# Onboarding Agent

A TypeAgent agent that automates the end-to-end process of integrating a new application or API into TypeAgent. Each phase of the onboarding pipeline is a sub-agent with typed actions, enabling AI orchestrators (Claude Code, GitHub Copilot) to drive the process via TypeAgent's MCP interface.

## Overview

Integrating a new application into TypeAgent involves 7 phases:

| Phase | Sub-agent | What it does |
|---|---|---|
| 1 | `onboarding-discovery` | Crawls docs or parses an OpenAPI spec to enumerate the API surface |
| 2 | `onboarding-phrasegen` | Generates natural language sample phrases for each action |
| 3 | `onboarding-schemagen` | Generates TypeScript action schemas from the API surface |
| 4 | `onboarding-grammargen` | Generates `.agr` grammar files from schemas and phrases |
| 5 | `onboarding-scaffolder` | Stamps out the agent package infrastructure |
| 6 | `onboarding-testing` | Generates test cases and runs a phrase→action validation loop |
| 7 | `onboarding-packaging` | Packages the agent for distribution and registration |

Each phase produces **artifacts saved to disk** at `~/.typeagent/onboarding/<integration-name>/`, so work can be resumed across sessions.

## Usage

### Starting a new integration

```
start onboarding for slack
```

### Checking status

```
what's the status of the slack onboarding
```

### Resuming an in-progress integration

```
resume onboarding for slack
```

### Running a specific phase

```
crawl docs at https://api.slack.com/docs for slack
generate phrases for slack
generate schema for slack
run tests for slack
```

## Workspace layout

```
~/.typeagent/onboarding/
  <integration-name>/
    state.json              ← phase status, config, timestamps
    discovery/
      api-surface.json      ← enumerated actions from docs/spec
    phraseGen/
      phrases.json          ← sample phrases per action
    schemaGen/
      schema.ts             ← generated TypeScript action schema
    grammarGen/
      schema.agr            ← generated grammar file
    scaffolder/
      agent/                ← stamped-out agent package files
    testing/
      test-cases.json       ← phrase → expected action test pairs
      results.json          ← latest test run results
    packaging/
      dist/                 ← final packaged output
```

Each phase must be **approved** before the next phase begins. Approval locks the phase's artifacts and advances the current phase pointer in `state.json`.

## Building

```bash
pnpm install
pnpm run build
```

## Architecture

See [AGENTS.md](./AGENTS.md) for details on the agent structure, how to extend it, and how each phase's LLM prompting works.
