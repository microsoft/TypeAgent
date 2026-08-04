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

## Multi-provider `apiType`

An Azure OpenAI deployment endpoint may declare an `apiType` selecting the
**wire protocol** it speaks. This lets a single TypeAgent config route to
Azure/OpenAI Chat Completions, the OpenAI Responses API, and the
Anthropic Messages API behind the same endpoint pool.

| `apiType` value      | Wire protocol                             | Default? |
| -------------------- | ----------------------------------------- | -------- |
| `chat_completions`   | OpenAI / Azure OpenAI `/chat/completions` | ✅ yes   |
| `openai_responses`   | OpenAI `/responses`                       | no       |
| `anthropic_messages` | Anthropic `/v1/messages`                  | no       |

**Default & back-compat.** `apiType` is optional. Omitting it is exactly
equivalent to `chat_completions`, so every existing config keeps working
byte-for-byte — the projected flat env is unchanged, and the default value
is never emitted into the legacy `AZURE_OPENAI_POOL_*` override. Set
`apiType` only when an endpoint speaks a non-default protocol.

```yaml
azureOpenAI:
  deployments:
    gpt_4_o: # no apiType ⇒ chat_completions (unchanged)
      endpoints:
        - endpoint: https://my-resource.openai.azure.com/.../chat/completions?api-version=...
    gpt_5_codex:
      endpoints:
        - endpoint: https://api.openai.com/v1/responses
          region: eastus
          apiType: openai_responses
    claude_sonnet:
      endpoints:
        - endpoint: https://api.anthropic.com/v1/messages
          region: eastus
          apiType: anthropic_messages
```

**Precedence.** `apiType` is a per-**endpoint** attribute, resolved on the
same YAML → flat-env → typed-`Config` path as `capacity`/`priority`/`tpm`.
In the flat-env representation it rides the `AZURE_OPENAI_POOL_<DEPLOYMENT>`
override list (`[{suffix:...,apiType:openai_responses}]`), so a
`process.env` override of that key wins over YAML, matching the rest of the
merge precedence above. `apiType` never participates in routing — the pool
still picks _which_ endpoint to call by priority/capacity/cooldown; the
resolved `apiType` then selects the `ProviderAdapter`
([packages/aiclient/src/providerAdapter.ts](../aiclient/src/providerAdapter.ts))
that encodes the request and decodes the response.

This mirrors the shipping multi-provider pattern used elsewhere: opencode's
`shouldUseCopilotResponsesApi`, Copilot-CLI's `copilot_model_api_mode`, and
hermes-agent's `ProviderProfile.api_mode` — one dispatch switch selecting
N wire adapters, rather than a novel design.

## Usage

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
