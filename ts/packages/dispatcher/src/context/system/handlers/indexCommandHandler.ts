// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ActionContext, ParsedCommandParams } from "@typeagent/agent-sdk";
import { CommandHandler, CommandHandlerTable } from "@typeagent/agent-sdk/helpers/command";
import { CommandHandlerContext } from "../../commandHandlerContext.js";
import { displayResult, displaySuccess, displayWarn } from "@typeagent/agent-sdk/helpers/display";
import { IndexData, IndexSource } from "../../indexManager.js";

class IndexListCommandHandler implements CommandHandler {
    public readonly description = "List indexes";
    public readonly parameters = {} as const;

    public async run(
        context: ActionContext<CommandHandlerContext>,
        params: ParsedCommandParams<typeof this.parameters>,
    ) {
        const systemContext = context.sessionContext.agentContext;

        if (systemContext.indexManager.indexes.length > 0) {
            systemContext.indexManager.indexes.forEach((index: IndexData) => {
                displayResult(`Index: ${index.name}, Type: ${index.source}, Location: ${index.location}, Items: ${index.size}`, context);
            });
        } else {
            displayResult("There are no indexes.", context);
        }
    }
}

class IndexCreateCommandHandler implements CommandHandler {
    public readonly description = "Create a new index";
    public readonly parameters = {
        flags: {
            type: {
                description: "The type of index to create (images, email)",
                char: "t",
                type: "string",
                enum: ["image", "email"],
                default: "image",
            }
        },
        args: {
            name: {
                description: "Name of the index",
                type: "string",
                required: true,
            },
            location: {
                description: "Location of the index",
                type: "string",
                required: true,
            },
        }
    } as const;

    public async run(
        context: ActionContext<CommandHandlerContext>,
        params: ParsedCommandParams<typeof this.parameters>,
    ) {
        const systemContext = context.sessionContext.agentContext;

        if (await systemContext.indexManager.createIndex(params.args.name, params.flags.type as IndexSource, params.args.location)) {
            displayResult(`Index ${params.args.name} created successfully.`, context);
        } else {
            displayWarn(`Failed to create index ${params.args.name}.`, context);
        }
    }
}

class IndexDeleteCommandHandler implements CommandHandler {
    public readonly description = "Delete an index";
    public readonly parameters = {
        args: {
            name: {
                description: "Name of the index to delete",
                type: "string",
                required: true,
            },
        }
    } as const;

    public async run(
        context: ActionContext<CommandHandlerContext>,
        params: ParsedCommandParams<typeof this.parameters>,
    ) {
        const systemContext = context.sessionContext.agentContext;

        if (systemContext.indexManager.deleteIndex(params.args.name)) {
            displaySuccess(`Index ${params.args.name} deleted successfully.`, context);
        } else {
            displayWarn(`Failed to delete index with the name '${params.args.name}'.`, context);
        }
    }
}

/*
* Gets all of the available indexing commands
*/
export function getIndexCommandHandlers(): CommandHandlerTable {
    return {
        description: "Indexing commands",
        defaultSubCommand: "status",
        commands: {
            // status: new IndexStatusCommandHandler(),
            list: new IndexListCommandHandler(),
            create: new IndexCreateCommandHandler(),
            delete: new IndexDeleteCommandHandler(),
            // rebuild: new IndexRebuildCommandHandler(),
            // watch: new IndexWatchCommandHandler(),
            // info: new IndexInfoCommandHandler(),
        }
    };
}