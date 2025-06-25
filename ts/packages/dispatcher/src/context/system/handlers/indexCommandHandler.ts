// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ActionContext, ParsedCommandParams } from "@typeagent/agent-sdk";
import {
    CommandHandler,
    CommandHandlerTable,
} from "@typeagent/agent-sdk/helpers/command";
import { CommandHandlerContext } from "../../commandHandlerContext.js";
import {
    displayResult,
    displaySuccess,
    displayWarn,
} from "@typeagent/agent-sdk/helpers/display";
import { IndexData, IndexSource } from "image-memory";
import fileSize from "file-size";
import { expandHome } from "../../../utils/fsUtils.js";

class IndexListCommandHandler implements CommandHandler {
    public readonly description = "List indexes";
    public readonly parameters = {} as const;

    public async run(
        context: ActionContext<CommandHandlerContext>,
        params: ParsedCommandParams<typeof this.parameters>,
    ) {
        const systemContext = context.sessionContext.agentContext;

        const indexes = systemContext.indexManager.indexes;
        const iiPrint: string[][] = [];
        if (indexes.length > 0) {
            iiPrint.push(["Name", "Type", "Status", "Location", "Image Count"]);
            systemContext.indexManager.indexes.forEach((index: IndexData) => {
                iiPrint.push([
                    index.name,
                    index.source,
                    index.state,
                    index.location,
                    index.size.toString(),
                ]);
            });
            displayResult(iiPrint, context);
        } else {
            displayResult("There are no indexes.", context);
        }
    }
}

class IndexInfoCommandHandler implements CommandHandler {
    public readonly description = "Show index details";
    public readonly parameters = {
        flags: {},
        args: {
            name: {
                description: "Name of the index",
                type: "string",
                required: true,
            },
        },
    } as const;

    public async run(
        context: ActionContext<CommandHandlerContext>,
        params: ParsedCommandParams<typeof this.parameters>,
    ) {
        const systemContext = context.sessionContext.agentContext;

        let found = false;
        let output: string = "";
        systemContext.indexManager.indexes.forEach(async (value: IndexData) => {
            if (value.name === params.args.name) {
                found = true;
                output = `${JSON.stringify(value, null, 2)}`;
                output += `\nSize on Disk: ${fileSize(value.sizeOnDisk).human("si")}\n\n`;

                if (value.state != "finished") {
                    output +=
                        "Indexing is incomplete, reported size may change!";
                }
            }
        });

        if (!found) {
            output = `There are no indexes with the name ${params.args.name}.`;
        }

        displayResult(output, context);
    }
}

class IndexCreateCommandHandler implements CommandHandler {
    public readonly description = "Create a new index";
    public readonly parameters = {
        flags: {},
        args: {
            type: {
                description:
                    "The type of index to create [image, email, website]",
                char: "t",
                type: "string",
                enum: ["image", "email", "website"],
                default: "image",
            },
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
        },
    } as const;

    public async run(
        context: ActionContext<CommandHandlerContext>,
        params: ParsedCommandParams<typeof this.parameters>,
    ) {
        const systemContext = context.sessionContext.agentContext;

        const filtered = systemContext.indexManager.indexes.filter((value) => {
            return value.name === params.args.name;
        });

        if (filtered.length > 0) {
            displayWarn(
                `There is already an index with the name '${params.args.name}'.  Please specify a different name.`,
                context,
            );
            return;
        }

        if (
            await systemContext.indexManager.createIndex(
                params.args.name,
                params.args.type as IndexSource,
                expandHome(params.args.location),
            )
        ) {
            // save the index by saving the session
            systemContext.session.save();

            displayResult(
                `Index ${params.args.name} created successfully.`,
                context,
            );
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
        },
    } as const;

    public async run(
        context: ActionContext<CommandHandlerContext>,
        params: ParsedCommandParams<typeof this.parameters>,
    ) {
        const systemContext = context.sessionContext.agentContext;

        if (systemContext.indexManager.deleteIndex(params.args.name)) {
            // save the index by saving the session
            systemContext.session.save();

            displaySuccess(
                `Index ${params.args.name} deleted successfully.`,
                context,
            );
        } else {
            displayWarn(
                `Failed to delete index with the name '${params.args.name}'.`,
                context,
            );
        }
    }
}

/*
 * Gets all of the available indexing commands
 */
export function getIndexCommandHandlers(): CommandHandlerTable {
    return {
        description: "Indexing commands",
        defaultSubCommand: "list",
        commands: {
            list: new IndexListCommandHandler(),
            create: new IndexCreateCommandHandler(),
            delete: new IndexDeleteCommandHandler(),
            info: new IndexInfoCommandHandler(),
            // TODO: implement
            // rebuild: new IndexRebuildCommandHandler(), // is this necessary?
            // watch: new IndexWatchCommandHandler(),     // Toggle file watching
        },
    };
}
