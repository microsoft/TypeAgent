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

## Usage

```ts
import { loadConfig } from "@typeagent/config";

await loadConfig();
// process.env is now populated from YAML + .env fallback.
// Existing aiclient code works unchanged.
```
