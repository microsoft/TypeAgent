# @typeagent/config

Layered YAML configuration loader for TypeAgent.

## Status

Phase 1 of the YAML config migration. This phase introduces:

- A YAML loader that reads `ts/config.defaults.yaml` (committed) and
  `ts/config.local.yaml` (gitignored).
- A flattener that produces flat `KEY=value` pairs matching the existing
  `EnvVars` enum convention used by `aiclient`, so existing
  `getEnvSetting` / `process.env` consumers keep working unchanged.
- A `.env` fallback (lowest precedence) for backwards compatibility.
- Lightweight schema validation via `zod`.

Live Azure Key Vault fetch, encrypted on-disk caching, and the
`typeagent config` CLI family are added in later phases.

## Merge precedence (low → high)

1. `.env` (legacy fallback, deprecated)
2. `ts/config.defaults.yaml`
3. _Future:_ Key Vault YAML blob (or encrypted cache)
4. `ts/config.local.yaml`
5. `process.env` (caller-provided overrides)

## Flattening rules

YAML maps are flattened into the `EnvVars` flat-key shape used by
[packages/aiclient/src/openai.ts](../aiclient/src/openai.ts):

| YAML path                                          | Flat key                               |
| -------------------------------------------------- | -------------------------------------- |
| `azure.openai.api_key`                             | `AZURE_OPENAI_API_KEY`                 |
| `azure.openai.endpoint`                            | `AZURE_OPENAI_ENDPOINT`                |
| `azure.openai.deployments[].endpoint` (suffix=foo) | `AZURE_OPENAI_ENDPOINT_FOO`            |
| `openai.api_key`                                   | `OPENAI_API_KEY`                       |
| `bing.api_key`                                     | `BING_API_KEY`                         |
| `extra.<KEY>`                                      | `<KEY>` (passthrough for unknown keys) |

See [src/flatten.ts](./src/flatten.ts) for the full mapping.

## `wireApi` (per endpoint)

Optional endpoint field (default `chat_completions`). Maps to aiclient providers:
`chat_completions` → `chatCompletionsWireApiProvider`,
`responses` → `responsesWireApiProvider`,
`messages` → `messagesWireApiProvider`.
Carried on `AZURE_OPENAI_POOL_*`; does not affect pool routing.

## Usage

Implicit chat selection (`createChatModel()`, `DEFAULT`, or
`apiSettingsFromEnv()`) uses the named Azure `gpt_6_luna` deployment and its
regional pool, even when the legacy bare endpoint points to an older model.
Configure that deployment before using Azure chat defaults; a missing Luna
deployment fails instead of silently routing to GPT-4o. Explicit `azure`
continues to select the bare endpoint, and explicit legacy deployment names
remain available. Provider overrides and explicit API settings retain their
provider semantics; configured OpenAI and Copilot model overrides are honored.
When synthesizing a bare endpoint, the config builder prefers Luna.

OpenAI chat defaults to `gpt-6-luna` when no model is configured. For resolved
Azure/OpenAI chat settings identifying exactly `gpt-6-luna`, aiclient supplies
request constraints of 1,050,000 context, 922,000 input, and 128,000 output
tokens ([model documentation](https://developers.openai.com/api/docs/models/gpt-6-luna)).
Explicit request constraints take precedence without merging. Unknown model
IDs receive no guessed limits. Application output caps, conservative serialized
UTF-8 byte accounting, retries, and throttling are unchanged.

```ts
import { loadConfig } from "@typeagent/config";

await loadConfig();
// process.env is now populated from YAML + .env fallback.
// Existing aiclient code works unchanged.
```

## Trademarks

This project may contain trademarks or logos for projects, products, or services. Authorized use of Microsoft
trademarks or logos is subject to and must follow
[Microsoft's Trademark & Brand Guidelines](https://www.microsoft.com/en-us/legal/intellectualproperty/trademarks/usage/general).
Use of Microsoft trademarks or logos in modified versions of this project must not cause confusion or imply Microsoft sponsorship.
Any use of third-party trademarks or logos are subject to those third-party's policies.
