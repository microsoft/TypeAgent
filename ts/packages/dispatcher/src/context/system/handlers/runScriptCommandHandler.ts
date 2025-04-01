// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ActionContext, ParsedCommandParams } from "@typeagent/agent-sdk";
import { CommandHandler } from "@typeagent/agent-sdk/helpers/command";
import { CommandHandlerContext } from "../../commandHandlerContext.js";
import { processCommands } from "../../../helpers/console.js";
import { getPrompt, processCommandNoLock } from "../../../command/command.js";
import fs from "node:fs";
import path from "node:path";
import { expandHome } from "../../../utils/fsUtils.js";

export class RunCommandScriptHandler implements CommandHandler {
    public readonly description = "Run a command script file";
    public readonly parameters = {
        args: {
            input: {
                description: "command script file path",
            },
        },
    } as const;
    public async run(
        context: ActionContext<CommandHandlerContext>,
        params: ParsedCommandParams<typeof this.parameters>,
    ) {
        const systemContext = context.sessionContext.agentContext;
        const prevScriptDir = systemContext.currentScriptDir;
        const inputFile = path.resolve(
            prevScriptDir,
            expandHome(params.args.input),
        );
        const content = await fs.promises.readFile(inputFile, "utf8");
        const inputs = content.split(/\r?\n/);
        const prevBatchMode = systemContext.batchMode;
        try {
            // handle nested @run in files
            systemContext.currentScriptDir = path.parse(inputFile).dir;
            systemContext.batchMode = true;

            // Process the commands in the file.
            await processCommands(
                getPrompt,
                processCommandNoLock,
                systemContext,
                inputs,
            );
        } finally {
            // Restore state
            systemContext.batchMode = prevBatchMode;
            systemContext.currentScriptDir = prevScriptDir;
        }
    }
}
