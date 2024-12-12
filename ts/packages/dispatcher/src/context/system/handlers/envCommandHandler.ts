// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    CommandHandlerNoParams,
    CommandHandlerTable,
} from "@typeagent/agent-sdk/helpers/command";
import { CommandHandlerContext } from "../../commandHandlerContext.js";
import { ActionContext } from "@typeagent/agent-sdk";
import { displayResult } from "@typeagent/agent-sdk/helpers/display";
import dotenv from "dotenv";

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
