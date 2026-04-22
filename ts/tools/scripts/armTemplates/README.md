# Azure ARM Templates

The templates in this folder allow you to quickly create all of the necessary Azure resources to use the majority of TypeAgent features. Please follow [these instructions](https://learn.microsoft.com/en-us/azure/azure-resource-manager/templates/deploy-portal) to deploy these ARM templates.

## Quickstart

Before running the ARM template, make sure you have Azure CLI installed. Sign in using `az login` and choose the subscription you want to deploy to as the default.

Then run the follow command to deploy the source necessary for TypeAgent Shell in your Azure subscription into a resource group called `typeagent-eastus-rg`:

`az deployment sub create --template-file template.json --location eastus`

Prefer the wrapper for multi-region work: `node ../azureDeploy.mjs create --location eastus --regions swedencentral,westus3 --commit`. The wrapper is dry-run by default — drop `--commit` to preview. See [../README.md](../README.md) for details.

## Services

The ARM template will deploy the following Azure services in a single resource group (default name: `typeagent-<region>-rg`)

- [Speech](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/overview) _(primary region only)_
- [OpenAI](https://learn.microsoft.com/en-us/azure/ai-services/openai/overview)
- [Maps](https://learn.microsoft.com/en-us/azure/azure-maps/about-azure-maps) _(primary region only)_
- [Key Vault](https://learn.microsoft.com/en-us/azure/key-vault/secrets/about-secrets) _(primary region only)_
- [AI Foundry](https://learn.microsoft.com/en-us/azure/ai-foundry/) _(primary region only)_
- [AI Foundry Project](https://learn.microsoft.com/en-us/azure/ai-foundry/how-to/create-projects?tabs=ai-foundry&pivots=fdp-project) _(primary region only)_

These resources are set up with RBAC access with Entra ID , the account that is signed into the Azure CLI is automatically add to the RBAC role necessary to access these resource by the ARM template.

## Parameters

- `region` _(string, default: deployment location)_ — Azure region to deploy into.
- `prefix` _(string, default: `typeagent`)_ — Resource name prefix. Override to match your subscription's naming convention.
- `primaryRegion` _(bool, default: `true`)_ — Controls whether to deploy the global / shared resources. When `true` (the default), the full stack above is created. When `false`, only the OpenAI account and its deployments are created so the region can serve as a pool member for [aiclient's endpoint pool](../../../packages/aiclient/README.md#multi-region-endpoint-pools). Maps, Speech, Key Vault, AI Foundry, and the Logic App are skipped via ARM `condition` expressions. Use `primaryRegion=false` for every region after the first in a multi-region fleet; the primary region's Key Vault and globally unique services stay in place. The `azureDeploy.mjs --regions` wrapper sets this automatically.

## Features Not Covered

The following TypeAgent features/components are not automatically created or configured by this ARM templates:

- Demo Tenant for [Calendar](../ts/packages/agents/calendar) & [Email](../ts/packages/agents/email/) agents
- [Docker](../ts/Dockerfile) endpoint app service
- AI Foundry Agent creation & Grounding with BING resource creation and linking. If you want to use the generic chat agent to do internet lookups ([lookupAndAnswer](../../../packages/dispatcher/src/context/dispatcher/dispatcherAgent.ts)) you must complete some additional manual configuration steps at this time. [Follow these instructions]().
