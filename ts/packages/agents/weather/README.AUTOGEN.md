<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=b9653de4bfbe1c54d0d30adeb6cf6f89c30b656115deffde919f372ff0129fcf -->
<!-- AUTOGEN:DOCS:SOURCE: (no hand-written ./README.md found at last regen) -->

# weather-agent — AI-generated documentation

> 🤖 **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. May lag the working tree by up to 24h — see the staleness footer at the end of this file.

## Overview

The `weather-agent` package is a TypeAgent application agent designed to provide weather information. It can retrieve current weather conditions, forecasts, and alerts for specified locations.

## What it does

The `weather-agent` package implements three main actions:

- `getCurrentConditions`: Retrieves the current weather conditions for a specified location. Optionally, the units can be specified as either "celsius" or "fahrenheit".
- `getForecast`: Provides a weather forecast for a specified location for up to 7 days. The units can also be specified as either "celsius" or "fahrenheit".
- `getAlerts`: Fetches weather alerts for a specified location.

These actions enable users to obtain detailed weather information, including current conditions, forecasts, and alerts, by specifying the location and optional parameters.

## Setup

To set up the `weather-agent`, ensure you have the necessary environment variables configured. The package requires access to a weather API service, and you need to set the API key in your environment variables. Follow the steps in the hand-written README for detailed instructions on obtaining and configuring the API key.

## Key Files

The `weather-agent` package is structured as follows:

- **Manifest**: The agent's manifest is defined in [weatherManifest.json](./src/weatherManifest.json), which includes metadata and schema information.
- **Schema**: The action schema is defined in [weatherSchema.ts](./src/weatherSchema.ts), specifying the types and parameters for each action.
- **Grammar**: The action grammar is defined in [weatherSchema.agr](./src/weatherSchema.agr), detailing the patterns and rules for parsing user requests.
- **Handler**: The main action handler is implemented in [weatherActionHandler.ts](./src/weatherActionHandler.ts), which contains the logic for executing each action.

The package also includes a test script, [testWeather.ts](./src/testWeather.ts), for manually verifying the weather API integration.

## How to extend

To extend the `weather-agent` package, follow these steps:

1. **Add new actions**: Define new actions in [weatherSchema.ts](./src/weatherSchema.ts) by specifying the action name and parameters.
2. **Update grammar**: Modify [weatherSchema.agr](./src/weatherSchema.agr) to include new patterns and rules for the new actions.
3. **Implement handlers**: Add the logic for the new actions in [weatherActionHandler.ts](./src/weatherActionHandler.ts). Ensure the new actions are handled correctly within the `executeWeatherAction` function.
4. **Test**: Update the test script [testWeather.ts](./src/testWeather.ts) to include tests for the new actions. Run the tests to verify the integration.

By following these steps, you can extend the functionality of the `weather-agent` package to support additional weather-related actions and features.

## Reference

> ⚙️ **Auto-generated, no AI involvement.** Built deterministically from `package.json`, `src/`, and the workspace dependency graph at the commit recorded in the staleness footer at the end of this file. Hand edits to this file will be overwritten on the next run.

### Entry points

- `./agent/manifest` → [./src/weatherManifest.json](./src/weatherManifest.json)
- `./agent/handlers` → [./dist/weatherActionHandler.js](./dist/weatherActionHandler.js)

### Dependencies

Workspace:

- [@typeagent/action-schema-compiler](../../../packages/actionSchemaCompiler/README.md)
- [@typeagent/agent-sdk](../../../packages/agentSdk/README.md)
- [action-grammar-compiler](../../../packages/actionGrammarCompiler/README.md)

External: _None at runtime._

### Used by

- [command-executor-mcp](../../../packages/commandExecutor/README.md)
- [default-agent-provider](../../../packages/defaultAgentProvider/README.md)

### Files of interest

`./src/weatherActionHandler.ts`, `./src/weatherManifest.json`, `./src/weatherSchema.agr`, …and 6 more under `./src/`.

### Agent surface

- Manifest: [./src/weatherManifest.json](./src/weatherManifest.json)
- Schema: [./src/weatherSchema.ts](./src/weatherSchema.ts)
- Grammar: [./src/weatherSchema.agr](./src/weatherSchema.agr)
- Handler: [./src/weatherActionHandler.ts](./src/weatherActionHandler.ts)

### Actions

_3 actions implemented by this agent, parsed deterministically from `./src/weatherSchema.ts`. Sample utterances and parameter shapes are illustrative; consult the schema for the full signature._

| User says | Action |
| --- | --- |
| _(no sample)_ | `getCurrentConditions` → `{ "location": "…" }` |
| _(no sample)_ | `getForecast` → `{ "location": "…" }` |
| _(no sample)_ | `getAlerts` → `{ "location": "…" }` |

---

_Auto-generated against commit `bc2dc7df084977bc3da24a9398fd3a08d55c3e7e` on `2026-05-29T04:54:39.605Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter weather-agent docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->
