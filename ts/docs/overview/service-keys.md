# Service keys & configuration

Multiple services are required to run the TypeAgent scenarios. Configuration is
stored in a YAML file in the repo's `ts/` directory: copy `config.sample.yaml`
to `config.local.yaml` and fill in the keys you need.

> Legacy `.env` files are still supported but **deprecated** and will stop
> working after September 2026 — prefer `config.local.yaml`.

## Minimal configuration

Targeting **Azure OpenAI**:

```yaml
azureOpenAI:
  defaultAuth: <service key or "identity" for keyless>
  deployments:
    default:
      endpoint: <endpoint URL for an LLM model, e.g. GPT-4o>
  responseFormat: true
  endpoints:
    embedding:
      endpoint: <endpoint URL for text-embedding-ada-002 or equivalent>
```

Targeting **OpenAI**:

```yaml
openAI:
  default:
    organization: <organization id>
    apiKey: <service key>
    endpoint: https://api.openai.com/v1/chat/completions
    model: gpt-4o
    responseFormat: true
  embedding:
    endpoint: https://api.openai.com/v1/embeddings
    model: text-embedding-ada-002
```

## What each capability needs

It is possible to use **keyless** configuration for some APIs — see
[Keyless access](#keyless-access).

**Minimum** to try the experience with the
[List](https://github.com/microsoft/TypeAgent/blob/main/ts/packages/agents/list/README.md)
agent:

| Capability                | Functionality                                     | Keyless? |
| ------------------------- | ------------------------------------------------- | -------- |
| LLM (GPT-4 or equivalent) | Request translation                               | Yes      |
| Embeddings                | Conversation memory; Desktop app-name fuzzy match | Yes      |

**Optional:**

| Capability                                                                                                | Functionality                                                                                                                                                        | Keyless? |
| --------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| [Speech-to-text](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/index-speech-to-text) | Voice input (Shell only) — see the [Shell setup](https://github.com/microsoft/TypeAgent/blob/main/ts/packages/shell/README.md#azure-speech-to-text-service-optional) | Yes      |

**Per-agent** (only if you use that agent):

| Agent / service                                                        | Functionality                                                                                                                                                                 | Keyless? |
| ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| Grounding with Bing                                                    | Chat lookup                                                                                                                                                                   | No       |
| GPT-3.5 Turbo                                                          | Fast chat response; [email](https://github.com/microsoft/TypeAgent/tree/main/ts/packages/agents/email) content generation                                                     | Yes      |
| [Spotify Web API](https://developer.spotify.com/documentation/web-api) | [Music player](https://github.com/microsoft/TypeAgent/blob/main/ts/packages/agents/player/README.md#application-keys)                                                         | No       |
| [Microsoft Graph](https://developer.microsoft.com/en-us/graph)         | [Calendar](https://github.com/microsoft/TypeAgent/tree/main/ts/packages/agents/calendar) / [Email](https://github.com/microsoft/TypeAgent/tree/main/ts/packages/agents/email) | No       |
| GPT-4o                                                                 | [Browser](https://github.com/microsoft/TypeAgent/tree/main/ts/packages/agents/browser) crossword page                                                                         | Yes      |

Other examples under
[`ts/examples`](https://github.com/microsoft/TypeAgent/tree/main/ts/examples)
may need additional keys — see each example's README.

## Managing keys with Azure Key Vault

The [`getKeys`](https://github.com/microsoft/TypeAgent/blob/main/ts/tools/scripts/getKeys.mjs)
script manages secrets via Azure Key Vault and writes them to your local
`config.local.yaml`.

Setup:

- Install the [Azure CLI](https://learn.microsoft.com/en-us/cli/azure/install-azure-cli).
- `az login`, then `az account set --subscription <Subscription Id>`.
- [Create a Key Vault](https://learn.microsoft.com/en-us/azure/key-vault/general/quick-create-cli) named `<name>`.

To update keys on the vault:

- Add/change values in `config.local.yaml`.
- Add the new key names in `ts/tools/scripts/getKeys.config.json`.
- `npm run getKeys -- push [--vault <name>]` (the default vault name comes from
  `getKeys.config.json` if `--vault` is omitted), then commit the config change.

To pull keys into `ts/config.local.yaml`:

- `npm run getKeys [--vault <name>]` at the repo root.

> Shared keys don't include Spotify — create those with the
> [Spotify API key instructions](https://github.com/microsoft/TypeAgent/blob/main/ts/packages/agents/player/README.md).

## Keyless access

For additional security you can run a subset of the TypeAgent endpoints
**keyless**, authenticating with Azure Entra user identities. Configure your
services to use [RBAC](https://learn.microsoft.com/en-us/azure/role-based-access-control/overview)
and assign users the correct roles for each endpoint (see the "Keyless?" columns
above).

Then set `defaultAuth: identity` in `config.local.yaml` instead of providing
keys. At runtime, install the
[Azure CLI](https://learn.microsoft.com/en-us/cli/azure/install-azure-cli) and
`az login` with an account that has access (selecting the right subscription).
TypeAgent uses the Azure SDK's
[`DefaultAzureCredential`](https://learn.microsoft.com/en-us/javascript/api/%40azure/identity/defaultazurecredential),
which also supports other runtime authentication methods.

## Just-in-time access

TypeAgent supports a least-privilege approach using
[Azure Entra Privileged Identity Management](https://learn.microsoft.com/en-us/entra/id-governance/privileged-identity-management/pim-configure).
[`elevate.js`](https://github.com/microsoft/TypeAgent/blob/main/ts/tools/scripts/elevate.js)
automates elevation (options in `tools/scripts/elevate.config.json`); a typical
workflow is `npm run elevate` once at the start of each workday.

## Linux / WSL keyring

Agents that operate on Microsoft Graph (e.g.
[Calendar](https://github.com/microsoft/TypeAgent/tree/main/ts/packages/agents/calendar)
and [Email](https://github.com/microsoft/TypeAgent/tree/main/ts/packages/agents/email))
cache credentials on the local machine. On Linux or WSL2, install the GNOME
keyring (then **restart** your shell):

```shell
sudo apt-get update
sudo apt install -y gnome-keyring
```

You will be prompted to set a password to protect the keyring secrets the first
time code needs to persist them.
