# VSCODE SCHEMA GENERATOR

This example demonstrates how to use the `vscodeSchemaGen` tool to generate typeagent action schema for vscode commands and key bindings. The generated schema can be used by typeagents to route user requests to VSCODE.

The `vscodeSchemaGen` package can be user for the following tasks:

- `-dataprep flag` is used to consolidate the json input files needed for schema generation.
- `-schemagen flag` is used to generate the schema for vscode commands and keybindings.
- `-schemagen-actionprefix=<action prefix>` flag is used to create action schema for a specific vscode commands and generate user request and action embeddings.
- `-statgen -actionreqEmbeddingsFile <file> -statGenFile <file>` is use to generate statistics from the embedding data for the user requests and actions.

## Trademarks

This project may contain trademarks or logos for projects, products, or services. Authorized use of Microsoft
trademarks or logos is subject to and must follow
[Microsoft's Trademark & Brand Guidelines](https://www.microsoft.com/en-us/legal/intellectualproperty/trademarks/usage/general).
Use of Microsoft trademarks or logos in modified versions of this project must not cause confusion or imply Microsoft sponsorship.
Any use of third-party trademarks or logos are subject to those third-party's policies.
