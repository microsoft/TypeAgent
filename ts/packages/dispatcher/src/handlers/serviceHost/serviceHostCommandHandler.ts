// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { HandlerTable } from "../common/commandHandler.js";
import { CommandHandlerContext } from "../common/commandHandlerContext.js";
import chalk from "chalk";
import { ChildProcess, fork } from "child_process";
import { getPackageFilePath } from "../../utils/getPackageFilePath.js";

export async function createServiceHost() {
    return new Promise<ChildProcess | undefined>((resolve, reject) => {
        const serviceRoot = getPackageFilePath(
            "./dist/handlers/serviceHost/service.js",
        );

        const childProcess = fork(serviceRoot);
        childProcess.on("message", function (message) {
            if (message === "Success") {
                resolve(childProcess);
            } else {
                resolve(undefined);
            }
        });
    });
}

export function getServiceHostCommandHandlers(): HandlerTable {
    return {
        description: "Configure Service Hosting",
        defaultSubCommand: undefined,
        commands: {
            off: {
                description: "Turn off Service hosting integration",
                run: async (
                    request: string,
                    context: CommandHandlerContext,
                ) => {
                    if (context.serviceHost) {
                        context.serviceHost?.kill();
                        context.serviceHost = undefined;
                    }
                },
            },
            on: {
                description: "Turn on Service hosting integration.",
                run: async (
                    request: string,
                    context: CommandHandlerContext,
                ) => {
                    if (context.serviceHost) {
                        return;
                    }
                    context.serviceHost = await createServiceHost();
                    console.log(chalk.blue(`Service hosting enabled.`));
                },
            },
        },
    };
}
