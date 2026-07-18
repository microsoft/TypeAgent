<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=4b8d794165b0271c20f86bdc8debd9b62b93d6a73e4f72fd9f763555904006fc -->
<!-- AUTOGEN:DOCS:SOURCE: (no hand-written ./README.md found at last regen) -->

# weather-agent — AI-generated documentation

> 🤖 **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. May lag the working tree by up to 24h — see the staleness footer at the end of this file.

## Overview

The `weather-agent` package is a TypeAgent application agent designed to provide weather-related information. It enables users to query current weather conditions, forecasts, and alerts for specific locations. This agent integrates with the TypeAgent ecosystem and interacts with external weather APIs to deliver accurate and timely weather data.

## What it does

The `weather-agent` supports three key actions, each tailored to address specific weather-related queries:

- **`getCurrentConditions`**: Retrieves the current weather conditions for a specified location. Users can optionally specify the temperature units as `"celsius"` or `"fahrenheit"`.
- **`getForecast`**: Provides a weather forecast for a given location, supporting up to 7 days. Users can specify the number of days for the forecast and the temperature units.
- **`getAlerts`**: Fetches weather alerts for a specific location, such as severe weather warnings or advisories.

These actions allow the agent to respond to user queries about real-time weather updates, future weather predictions, and potential weather hazards. The agent relies on external weather APIs to fetch the required data and processes it to provide structured responses.

## Setup

To set up the `weather-agent`, follow these steps:

1. **Obtain an API key**: Register with a weather data provider (e.g., OpenWeatherMap or WeatherAPI) to get an API key. This key is required to access the weather data.
2. **Set environment variables**: Add the API key to your environment variables. Refer to the hand-written README for the exact variable name and additional setup details.
3. **Install dependencies**: Run the following command in the package directory to install the required dependencies:
   ```bash
   pnpm install
   ```

Ensure that the API key is valid and the environment variable is correctly configured before running the agent.

## Key Files

The `weather-agent` package is structured around several key files that define its functionality:

- **[weatherManifest.json](./src/weatherManifest.json)**: Contains metadata about the agent, including its description, schema, and grammar files.
- **[weatherSchema.ts](./src/weatherSchema.ts)**: Defines the action schema, specifying the types and parameters for the supported actions: `getCurrentConditions`, `getForecast`, and `getAlerts`.
- **[weatherSchema.agr](./src/weatherSchema.agr)**: Provides the action grammar, which maps user queries to structured actions using defined patterns and rules.
- **[weatherActionHandler.ts](./src/weatherActionHandler.ts)**: Implements the logic for handling each action. This file processes user requests and interacts with the weather API to fetch the required data.
- **[testWeather.ts](./src/testWeather.ts)**: A manual test script for verifying the integration with the weather API. It includes sample queries for geocoding and fetching weather data.

These files collectively define the agent's capabilities and serve as the foundation for its operation and extensibility.

## How to extend

To add new features or actions to the `weather-agent`, follow these steps:

1. **Define new actions**:

   - Extend the action schema in [weatherSchema.ts](./src/weatherSchema.ts) by adding a new action type and its parameters. For example, to add an action for retrieving historical weather data, define a new type `GetHistoricalWeatherAction` with fields like `location` and `date`.

2. **Update the grammar**:

   - Modify [weatherSchema.agr](./src/weatherSchema.agr) to include new grammar rules for the new action. For instance, you can add a rule like:
     ```text
     <getHistoricalWeather> = <Polite>? <HistoricalWeatherPatterns> $(location:<LocationSpec>) $(date:<DateSpec>) -> { actionName: "getHistoricalWeather", parameters: { location, date } };
     ```

3. **Implement the handler**:

   - Extend the `executeWeatherAction` function in [weatherActionHandler.ts](./src/weatherActionHandler.ts) to handle the new action. For example, create a function `handleGetHistoricalWeather` that interacts with the weather API to fetch historical data.

4. **Test the new functionality**:
   - Add test cases for the new action in [testWeather.ts](./src/testWeather.ts). Use sample queries to verify the new functionality.
   - Run the test script using the following command:
     ```bash
     node --loader ts-node/esm src/testWeather.ts
     ```

By following these steps, you can enhance the `weather-agent` to support additional weather-related features, such as historical weather data, air quality indices, or other specialized weather services.

## Reference

> ⚙️ **Auto-generated, no AI involvement.** Built deterministically from `package.json`, `src/`, and the workspace dependency graph at the commit recorded in the staleness footer at the end of this file. Hand edits to this file will be overwritten on the next run.

### Entry points

- `./agent/manifest` → [./src/weatherManifest.json](./src/weatherManifest.json)
- `./agent/handlers` → [./dist/weatherActionHandler.js](./dist/weatherActionHandler.js)

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

_Auto-generated against commit `f928ce70269b7d0f8942977c29147b2c8832b722` on `2026-07-15T22:42:29.947Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter weather-agent docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->
