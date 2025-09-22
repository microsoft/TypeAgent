// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { CommandHandlerContext } from "../../../commandHandlerContext.js";
import chalk from "chalk";
import { ChildProcess, fork } from "child_process";
import { getPackageFilePath } from "../../../../utils/getPackageFilePath.js";
import { ActionContext } from "@typeagent/agent-sdk";
import { CommandHandlerTable } from "@typeagent/agent-sdk/helpers/command";

export async function createServiceHost() {
    return new Promise<ChildProcess | undefined>((resolve, reject) => {
        const serviceRoot = getPackageFilePath(
            "./dist/context/system/handlers/serviceHost/service.js",
        );

        const childProcess = fork(serviceRoot);
        childProcess.on("message", function (message) {
            if (message === "Success") {
                resolve(childProcess);
            } else {
                reject(new Error(message as string));
            }
        });
    });
}

export function getServiceHostCommandHandlers(): CommandHandlerTable {
    return {
        description: "Configure Service Hosting",
        commands: {
            off: {
                description: "Turn off Service hosting integration",
                run: async (context: ActionContext<CommandHandlerContext>) => {
                    const systemContext = context.sessionContext.agentContext;
                    if (systemContext.serviceHost) {
                        systemContext.serviceHost?.kill();
                        systemContext.serviceHost = undefined;
                    }
                },
            },
            on: {
                description: "Turn on Service hosting integration.",
                run: async (context: ActionContext<CommandHandlerContext>) => {
                    const systemContext = context.sessionContext.agentContext;
                    if (systemContext.serviceHost) {
                        return;
                    }
                    systemContext.serviceHost = await createServiceHost();
                    console.log(chalk.blue(`Service hosting enabled.`));
                },
            },
        },
    };
}
