# Dispatcher Internet Lookup Configuration

The dispatcher can lookup information on the internet to provide you with answers to queries. In order to use this functionality you must setup a [Grounding with Bing](https://www.microsoft.com/en-us/bing/apis/grounding-pricing?msockid=03598722967c6ae20c3f93af97c66bd7) Azure resource. 
If you have used the [proviced ARM templates and azureDeploy script](/tools/scripts/armTemplates/README.md) you may skip to step 2.

# Instructions

Best Practice: You typically want to create the following resources in the same resource group where your other TypeAgent resources are.

1. Create an [AI Foundry](https://learn.microsoft.com/en-us/azure/ai-foundry/) resource in your Azure subscription.
2. Create a [Grounding with Bing](https://learn.microsoft.com/en-us/azure/ai-services/agents/how-to/tools/bing-grounding) resource in your Azure subscription. 
3. Once both resources have been created, navigate to the [AI Foundry Portal](https://ai.azure.com).  On your first visit it will prompt you to create a new project. If you already have a project you may use that, or create a new "Azure AI Foundry resource". Users who used the [ARM templates](/tools/scripts/armTemplates/) will already have a project created.
4. Next, navigate to the "[Agents](https://ai.azure.com/resource/agentsList)" page.
5. Create a new Agent and give it a name: "TypeAgentDemo".  The recommended options for this agent are: 
    - Deployment gpt-4o
    - Temperature 1
    - Top P 1
6. On the Agent configuration page click "Add" under the "Knowledge" section and select "Bing with Grounding" and select the resource you created from Step 2.
7. Use the "Try in Playground" on the Agent configuration tab to ensure the connection is working and the Agent is responding.
8. You must now update the BING_WITH_GROUNDING_ENDPOINT and BING_WITH_GROUNDING_AGENT_ID in your Azure Key vault and/or .env file to reflect the resources you setup in steps 2 & 5.