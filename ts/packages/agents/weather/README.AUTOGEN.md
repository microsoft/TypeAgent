<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=f66bd0f865dbc3c5bfc90702c29af3d5537d08c1d2b266b2f351ee67ad846fe3 -->
<!-- AUTOGEN:DOCS:SOURCE: (no hand-written ./README.md found at last regen) -->

# weather-agent — AI-generated documentation

> 🤖 **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. May lag the working tree by up to 24h — see the staleness footer at the end of this file.

## Overview

The `weather-agent` package is a TypeAgent application agent that provides weather-related information. It supports retrieving current weather conditions, forecasts, and alerts for specified locations. This agent integrates with the TypeAgent ecosystem, allowing users to query weather data through structured actions.

## What it does

The `weather-agent` implements three primary actions to handle weather-related queries:

- **`getCurrentConditions`**: Retrieves the current weather conditions for a specified location. Users can optionally specify the temperature units as `"celsius"` or `"fahrenheit"`.
- **`getForecast`**: Provides a weather forecast for a given location, supporting up to 7 days. Users can specify the number of days for the forecast and the temperature units.
- **`getAlerts`**: Fetches weather alerts for a specific location, such as severe weather warnings or advisories.

These actions enable the agent to provide real-time weather data, making it suitable for applications that require up-to-date weather information.

## Setup

To use the `weather-agent`, you need access to a weather API service. Follow these steps to set up the package:

1. **Obtain an API key**: Register with a weather data provider (e.g., OpenWeatherMap, WeatherAPI) to obtain an API key.
2. **Set environment variables**: Configure the API key as an environment variable. The specific variable name and setup instructions are detailed in the hand-written README.
3. **Install dependencies**: Run `pnpm install` in the package directory to install all required dependencies.

Ensure that the API key is valid and that the environment variable is correctly set before running the agent.

## Key Files

The `weather-agent` package is structured with the following key files:

- **[weatherManifest.json](./src/weatherManifest.json)**: Contains metadata about the agent, including its description, schema, and grammar files.
- **[weatherSchema.ts](./src/weatherSchema.ts)**: Defines the action schema, specifying the types and parameters for the actions `getCurrentConditions`, `getForecast`, and `getAlerts`.
- **[weatherSchema.agr](./src/weatherSchema.agr)**: Contains the action grammar, which defines the patterns and rules for interpreting user queries into structured actions.
- **[weatherActionHandler.ts](./src/weatherActionHandler.ts)**: Implements the logic for processing each action. This file includes functions to handle user requests and interact with the weather API.
- **[testWeather.ts](./src/testWeather.ts)**: A manual test script for verifying the integration with the weather API. It includes sample queries for geocoding and fetching weather data.

These files collectively define the agent's functionality and provide a foundation for further development.

## How to extend

To add new features or actions to the `weather-agent`, follow these steps:

1. **Define new actions**:

   - Extend the action schema in [weatherSchema.ts](./src/weatherSchema.ts) by adding new action types and their parameters.
   - For example, to add an action for retrieving historical weather data, define a new type `GetHistoricalWeatherAction` with parameters such as `location` and `date`.

2. **Update the grammar**:

   - Modify [weatherSchema.agr](./src/weatherSchema.agr) to include new patterns and rules for the new actions.
   - For example, add a rule like:
     ```text
     <getHistoricalWeather> = <Polite>? <HistoricalWeatherPatterns> $(location:<LocationSpec>) $(date:<DateSpec>) -> { actionName: "getHistoricalWeather", parameters: { location, date } };
     ```

3. **Implement the handler**:

   - Extend the logic in [weatherActionHandler.ts](./src/weatherActionHandler.ts) to handle the new action. Add a function, such as `handleGetHistoricalWeather`, to process the action and interact with the weather API.

4. **Test the new functionality**:
   - Update [testWeather.ts](./src/testWeather.ts) to include test cases for the new actions.
   - Run the test script to verify that the new actions work as expected.

By following these steps, you can expand the `weather-agent` to support additional weather-related features, such as historical data, air quality information, or advanced weather analytics.

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

_Auto-generated against commit `44b34a9ac8794b6f90489ff7e55fe57283c34960` on `2026-07-11T08:34:41.338Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter weather-agent docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->
