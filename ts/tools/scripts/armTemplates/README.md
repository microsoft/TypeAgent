# Azure ARM Templates

The templates in this folder allow you to quickly create all of the necessary Azure resources to use the majority of TypeAgent features. Please follow [these instructions](https://learn.microsoft.com/en-us/azure/azure-resource-manager/templates/deploy-portal) to deploy these ARM templates.

## Quickstart

Before running the ARM template, make sure you have Azure CLI installed. Sign in using `az login` and choose the subscription you want to deploy to as the default.

Then run the follow command to deploy the source necessary for TypeAgent Shell in your Azure subscription into a resource group called `typeagent-eastus`:

`az deployment sub create --template-file template.json --location eastus`

## Services

The ARM template will deploy the following Azure services in a single resource group (default name: `typeagent-eastus`)

- [Speech](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/overview)
- [OpenAI](https://learn.microsoft.com/en-us/azure/ai-services/openai/overview)
- [Maps](https://learn.microsoft.com/en-us/azure/azure-maps/about-azure-maps)
- [Key Vault](https://learn.microsoft.com/en-us/azure/key-vault/secrets/about-secrets)
- [AI Foundry](https://learn.microsoft.com/en-us/azure/ai-foundry/)
- [AI Foundry Project](https://learn.microsoft.com/en-us/azure/ai-foundry/how-to/create-projects?tabs=ai-foundry&pivots=fdp-project)

These resources are set up with RBAC access with Entra ID , the account that is signed into the Azure CLI is automatically add to the RBAC role necessary to access these resource by the ARM template.

## Features Not Covered

The following TypeAgent features/components are not automatically created or configured by this ARM templates:

- Demo Tenant for [Calendar](../ts/packages/agents/calendar) & [Email](../ts/packages/agents/email/) agents
- [Docker](../ts/Dockerfile) endpoint app service
- AI Foundry Agent creation & Grounding with BING resource creation and linking. If you want to use the generic chat agent to do internet lookups ([lookupAndAnswer](../../../packages/dispatcher/src/context/dispatcher/dispatcherAgent.ts)) you must complete some additional manual configuration steps at this time. [Follow these instructions]().
