// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    CommandHandler,
    CommandHandlerNoParams,
    CommandHandlerTable,
} from "@typeagent/agent-sdk/helpers/command";
import { CommandHandlerContext } from "../../commandHandlerContext.js";
import { ActionContext, ParsedCommandParams } from "@typeagent/agent-sdk";
import {
    displayError,
    displayResult,
} from "@typeagent/agent-sdk/helpers/display";

export class EnvCommandHandler implements CommandHandlerNoParams {
    public readonly description =
        "Echos environment variables to the user interface.";
    public async run(context: ActionContext<CommandHandlerContext>) {
        const table: string[][] = [["Variable Name", "Value"]];

        const keys = Object.keys(process.env);
        const values = Object.values(process.env);

        for (let i = 0; i < keys.length; i++) {
            if (values[i] !== undefined) {
                if (
                    (keys[i].toLowerCase().indexOf("key") > -1 &&
                        values[i]?.toLowerCase() != "identity") ||
                    keys[i].toLowerCase().indexOf("secret") > -1
                ) {
                    table.push([keys[i], "__redacted__"]);
                } else {
                    table.push([keys[i], values[i]!]);
                }
            } else {
                table.push([keys[i], ""]);
            }
        }

        displayResult(table, context);
    }
}

export class EnvVarCommandHandler implements CommandHandler {
    public readonly description: string =
        "Echos the value of a named environment variable to the user interface";
    public readonly parameters = {
        args: {
            name: {
                description: "The name of the environment variable.",
            },
        },
    } as const;
    public async run(
        context: ActionContext<CommandHandlerContext>,
        params: ParsedCommandParams<typeof this.parameters>,
    ) {
        if (process.env[params.args.name]) {
            displayResult(process.env[params.args.name]!, context);
        } else {
            displayError(
                `The environment variable ${params.args.name} does not exist.`,
                context,
            );
        }
    }
}

export function getEnvCommandHandlers(): CommandHandlerTable {
    return {
        description: "Environment variable commands",
        defaultSubCommand: "all",
        commands: {
            all: new EnvCommandHandler(),
            get: new EnvVarCommandHandler(),
        },
    };
}
