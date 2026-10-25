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

## Dependency installation settings

`config.local.yaml` is application runtime configuration. It is loaded by
TypeAgent entry points, not by pnpm or dependency install scripts. In particular,
adding `FOUNDRY_LOCAL_NUGET_*` keys under `env:` can configure a running
TypeAgent process, but cannot configure an earlier dependency installation.

For source checkouts, run `node tools/scripts/setupWorktree.mjs` from `ts/`
(or `pnpm run setup` when pnpm is already provisioned). Before installing,
setup derives Foundry's NuGet v3 endpoint from the Azure Artifacts npm registry
in the provisioned `.npmrc` and defaults to credential-aware `dotnet` mode.
This requires a .NET SDK and a configured NuGet credential provider. The feed
must have the required native package versions locally or available upstream;
the first upstream restore requires Collaborator or higher permissions.
npm's token helper does not authenticate NuGet.

Explicit `FOUNDRY_LOCAL_NUGET_FEEDS` and `FOUNDRY_LOCAL_NUGET_MODE`
environment variables take precedence. Setup passes the derived settings only
to its install process; it does not persist machine configuration or credentials.
Setup logs do not include the derived feed URL or environment-provided mode.
Non-Azure npm registries retain the native installer's defaults.

For a direct `pnpm install`, global package installation, or a standalone
native-runtime repair, set these variables in the parent terminal first:

```powershell
$env:FOUNDRY_LOCAL_NUGET_FEEDS = 'https://pkgs.dev.azure.com/ORG/PROJECT/_packaging/FEED/nuget/v3/index.json'
$env:FOUNDRY_LOCAL_NUGET_MODE = 'dotnet'
pnpm install
```

`FOUNDRY_LOCAL_NUGET_FEEDS` replaces the installer's default sources, including
public NuGet. Multiple sources use a semicolon-separated string. If using
`FOUNDRY_LOCAL_NUGET_CONFIG` with `dotnet` mode, that NuGet config file's sources
take precedence over the feed list; it must also use approved sources.
Complete an interactive NuGet restore against the feed if its credential
provider cannot authenticate silently. Azure CLI or npm sign-in alone does
not guarantee that the NuGet provider has credentials.

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

## Embedding capabilities

Embedding configuration is independent of chat configuration. The optional
`embedding.modalities` declaration enables capabilities, rather than inferring
them from model availability. It must contain `text`; omitted declarations retain
legacy text-only behavior. Audio and video are not supported.

```yaml
embedding:
  provider: local
  runtime: embeddinggemma
  model: onnx-community/embeddinggemma-2-ONNX
  modalities: [text, image]
  revision: daa72c51243991dfcaf9f9137d2c573d8f7790c0
  localFilesOnly: true
  size: 768
  maxBatchSize: 4
  maxPending: 32
```

Image opt-in requires `provider: local` and `runtime: embeddinggemma`, or the
exact ONNX model above when runtime is omitted. `runtime: minilm` is text-only.
An explicit local runtime cannot be combined with a hosted provider.
`size`, `maxBatchSize`, and `maxPending` must be positive finite integers.
`revision` must be nonempty when supplied; the Gemma runtime additionally
requires a pinned 40-hex revision. `localFilesOnly` is a strict boolean, including
explicit `false`; omitted fields retain existing defaults.

MiniLM and Gemma share pinned Transformers.js 4.3.1, with CPU FP32 inference.
Select one local embedding model per agent-server process and restart the server
to change models. This does not change the default provider.

For offline MiniLM, set `localFilesOnly: true` and stage `config.json`,
`tokenizer.json`, `tokenizer_config.json`, and `onnx/model.onnx` under
`<cacheDir>\Xenova\all-MiniLM-L6-v2\<revision>`. The legacy unversioned model
directory is supported only for revision `main`; pinned revisions never fall
back to another snapshot. Missing FP32 artifacts fail explicitly without
deleting the offline cache. The 4.3.1 runtime changes MiniLM's embedding identity;
existing indexes need an explicit embedding rebuild, not dimension-only reuse.

The YAML fields round-trip through the importer and compatibility shim as
`TYPEAGENT_EMBEDDING_PROVIDER`, `_MODEL`, `_RUNTIME`, `_MODALITIES`, `_REVISION`,
`_LOCAL_FILES_ONLY`, `_CACHE_DIR`, `_SIZE`, `_MAX_BATCH_SIZE`, and `_MAX_PENDING`
(each suffix has the `TYPEAGENT_EMBEDDING` prefix). Modalities use a JSON array
in the environment, for example `TYPEAGENT_EMBEDDING_MODALITIES='["text","image"]'`.
Boolean env values accept only `true`, `false`, `1`, or `0`. These configuration
values are nonsecret; credentials remain in the hosted provider sections.

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

# Named embedding models

`embeddingModels` is a catalog of embedding spaces, not connections or credentials.
`defaultEmbeddingModel` selects one alias; `none` disables embeddings. Without a
selector, `resolveEmbeddingConfig(config)` returns the legacy `config.embedding`
unchanged (including `undefined`), preserving hosted-provider inference.
The catalog alone does not load weights, access the network, or change selection.
Local defaults `local-minilm` and `local-embeddinggemma` are pinned alternatives.
The inert `copilot-small` default uses `text-embedding-3-small` (1536 dimensions).

```yaml
defaultEmbeddingModel: local-minilm
embeddingModels:
  local-minilm:
    provider: local
    runtime: minilm
    model: Xenova/all-MiniLM-L6-v2
    revision: 751bff37182d3f1213fa05d7196b954e230abad9
    size: 384
    modalities: [text]
    localFilesOnly: true
```

Every definition requires `provider` (local/azure/openai/copilot), `model`, `size`,
and `modalities`. Text is required; image is supported only by the known Gemma
checkpoint. Local models require an immutable 40-character revision and their
known dimensions (MiniLM 384, Gemma 768). Local-only fields are rejected on hosted
profiles. Azure profiles may specify `deployment`, referencing an existing
`azureOpenAI.deployments` key. Omitting it reuses `azureOpenAI.defaultEmbedding`
exactly and requires that default transport to exist; it does not select a named
pool implicitly. Endpoint pools and credentials remain provider-owned. A migrated
opaque model binding such as `model: "azure:"` is preserved pending operator
attestation, rather than inferring an upstream model from a URL.

Catalog layers merge by alias and field; final merged definitions are validated,
including unused profiles. Selection never inherits another alias's fields.
`TYPEAGENT_DEFAULT_EMBEDDING_MODEL` overrides selection and
`TYPEAGENT_EMBEDDING_MODELS` supplies a JSON catalog layer. YAML, flat env, typed
config, shim and importer preserve the full catalog, not just the selected entry.
Do not combine a selector with legacy `embedding:` fields or
`TYPEAGENT_EMBEDDING_*` single-model overrides: migrate those fields into a named
definition and remove the old overrides. Provider connection settings may coexist.
Switching the selected model requires a server restart.
