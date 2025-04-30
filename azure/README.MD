### Azure ARM Templates

The templates in this folder allow you to quickly create all of the necessary Azure resources to use the majority of TypeAgent features.  Please follow [https://learn.microsoft.com/en-us/azure/azure-resource-manager/templates/deploy-portal](these instructions) to deploy these ARM templates.

## Quickstart

To deploy these resources in your Azure subscription into a resource group called *typeagent_demo* run the following command: 'az deployment group create --resource-group typeagent_demo --template-file template.json'

## Features Not Covered

The following features are not automatically created by these ARM tempates:

    - Demo Tenant for Calendar & Email agents
    - Permissions Assignment
    - Identity Management