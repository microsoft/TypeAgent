# VSCODE Automation Extension

The code agent is sample code to demonstrate how to automate vscode.

The code dispatcher agent is not enabled by default. It is integrated to work with the vscode extension [coda](../../coda/README.md). Please deploy the vscode extension to see the code agent in action.

You can enable all the sub-agents as part of the code agent by running the following commands on the typeagent cli or shell:

```
@config agent code*
```

Please look at the agent [manifest](./src/codeManifest.json) file to look at other sub-agents that are part of the code agent. The code agent shows how to extend an agent to handle a hierarchical set of actions. For instance if you want to run different commands related to debugging an application on vscode, you will want to run these commands:

```
@config agent code.code-debug
```

## Trademarks

This project may contain trademarks or logos for projects, products, or services. Authorized use of Microsoft
trademarks or logos is subject to and must follow
[Microsoft's Trademark & Brand Guidelines](https://www.microsoft.com/en-us/legal/intellectualproperty/trademarks/usage/general).
Use of Microsoft trademarks or logos in modified versions of this project must not cause confusion or imply Microsoft sponsorship.
Any use of third-party trademarks or logos are subject to those third-party's policies.
