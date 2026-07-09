<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=f66bd0f865dbc3c5bfc90702c29af3d5537d08c1d2b266b2f351ee67ad846fe3 -->
<!-- AUTOGEN:DOCS:SOURCE: (no hand-written ./README.md found at last regen) -->

# weather-agent — AI-generated documentation

> 🤖 **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. May lag the working tree by up to 24h — see the staleness footer at the end of this file.

## Overview

The `weather-agent` package is a TypeAgent application agent that provides weather-related information. It supports retrieving current weather conditions, forecasts, and alerts for specified locations. This agent is designed to integrate with the broader TypeAgent ecosystem, enabling users to query weather data through defined actions.

## What it does

The `weather-agent` implements three primary actions, each designed to provide specific weather-related information:

- **`getCurrentConditions`**: Fetches the current weather conditions for a given location. Users can specify the location and optionally choose the units for temperature (either "celsius" or "fahrenheit").
- **`getForecast`**: Provides a weather forecast for a specified location for up to 7 days. Users can specify the location, the number of days (1–7), and the temperature units.
- **`getAlerts`**: Retrieves weather alerts for a specified location, such as severe weather warnings or advisories.

These actions allow the agent to serve as a weather information provider, making it suitable for integration into applications that require real-time weather data or alerts.

## Setup

To use the `weather-agent`, you need to configure access to a weather API service. This involves obtaining an API key from the weather service provider and setting it as an environment variable. Refer to the hand-written README for detailed instructions on acquiring the API key and configuring your environment.

Once the API key is set, install the package dependencies using the following command:

```bash
pnpm install
```

After completing these steps, the `weather-agent` will be ready for use.

## Key Files

The `weather-agent` package is organized into several key files that define its functionality:

- **[weatherManifest.json](./src/weatherManifest.json)**: Contains metadata about the agent, including its description, schema, and grammar file references.
- **[weatherSchema.ts](./src/weatherSchema.ts)**: Defines the action schema, including the types and parameters for each action (`getCurrentConditions`, `getForecast`, and `getAlerts`).
- **[weatherSchema.agr](./src/weatherSchema.agr)**: Specifies the grammar rules for parsing user input into actionable requests. This file maps user intents to the defined actions.
- **[weatherActionHandler.ts](./src/weatherActionHandler.ts)**: Implements the logic for handling the defined actions. This file includes functions to process each action and interact with the weather API.
- **[testWeather.ts](./src/testWeather.ts)**: A test script for manually verifying the integration with the weather API. It includes sample tests for geocoding locations and fetching weather data.

These files collectively define the agent's behavior, from understanding user input to executing the corresponding actions.

## How to extend

To add new features or actions to the `weather-agent`, follow these steps:

1. **Define new actions**:

   - Add the new action type and its parameters to [weatherSchema.ts](./src/weatherSchema.ts).
   - Ensure the new action is included in the `WeatherAction` union type.

2. **Update the grammar**:

   - Modify [weatherSchema.agr](./src/weatherSchema.agr) to include new grammar rules for parsing user input related to the new action.
   - Define patterns and rules that map user intents to the new action.

3. **Implement the action handler**:

   - Add a new function in [weatherActionHandler.ts](./src/weatherActionHandler.ts) to handle the logic for the new action.
   - Update the `executeWeatherAction` function to include a case for the new action.

4. **Test the new functionality**:
   - Update [testWeather.ts](./src/testWeather.ts) to include test cases for the new action.
   - Run the test script to ensure the new action works as expected.

By following these steps, you can extend the `weather-agent` to support additional weather-related capabilities, such as air quality data, historical weather data, or other specialized weather services.

## Reference

> ⚙️ **Auto-generated, no AI involvement.** Built deterministically from `package.json`, `src/`, and the workspace dependency graph at the commit recorded in the staleness footer at the end of this file. Hand edits to this file will be overwritten on the next run.

### Entry points

- `./agent/manifest` → [./src/weatherManifest.json](./src/weatherManifest.json)
- `./agent/handlers` → `./dist/weatherActionHandler.js` _(not found on disk)_

### Dependencies

Workspace:

- [@typeagent/action-grammar-compiler](../../../packages/actionGrammarCompiler/README.md)
- [@typeagent/action-schema-compiler](../../../packages/actionSchemaCompiler/README.md)
- [@typeagent/agent-sdk](../../../packages/agentSdk/README.md)

External: _None at runtime._

### Used by

- [command-executor-mcp](../../../packages/commandExecutor/README.md)
- [default-agent-provider](../../../packages/defaultAgentProvider/README.md)

### Files of interest

`./src/weatherActionHandler.ts`, `./src/weatherManifest.json`, `./src/weatherSchema.agr`, …and 7 more under `./src/`.

### Agent surface

- Manifest: [./src/weatherManifest.json](./src/weatherManifest.json)
- Schema: [./src/weatherSchema.ts](./src/weatherSchema.ts)
- Grammar: [./src/weatherSchema.agr](./src/weatherSchema.agr)
- Handler: [./src/weatherActionHandler.ts](./src/weatherActionHandler.ts)

### Actions

_3 actions implemented by this agent, parsed deterministically from `./src/weatherSchema.ts`. Sample utterances and parameter shapes are illustrative; consult the schema for the full signature._

| User says     | Action                                         |
| ------------- | ---------------------------------------------- |
| _(no sample)_ | `getCurrentConditions` → `{ "location": "…" }` |
| _(no sample)_ | `getForecast` → `{ "location": "…" }`          |
| _(no sample)_ | `getAlerts` → `{ "location": "…" }`            |

---

_Auto-generated against commit `656444843518fd1f9bb1b157b6dbf6dcbcde3999` on `2026-07-09T09:05:44.186Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter weather-agent docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->
