// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { HandlerTable } from "../common/commandHandler.js";
import { CommandHandlerContext } from "../common/commandHandlerContext.js";
import chalk from "chalk";
import { ChildProcess, spawn } from "child_process";
import { getPackageFilePath } from "../../utils/getPackageFilePath.js";

export async function createLocalWhisperHost() {
    let timeoutHandle: NodeJS.Timeout;

    const timeoutPromise = new Promise<undefined>((_resolve, reject) => {
        timeoutHandle = setTimeout(() => reject(undefined), 10000);
    });

    const localWhisperPromise = new Promise<ChildProcess | undefined>(
        (resolve, reject) => {
            const serviceRoot = getPackageFilePath(
                "../../../python/whisperService/faster-whisper.py",
            );

            try {
                const childProcess = spawn("python", [serviceRoot]);

                childProcess.stdout?.on("data", (data) => {
                    const line = data.toString();
                    if (
                        line.includes("INFO:     Application startup complete.")
                    ) {
                        console.log(line);
                        resolve(childProcess);
                    }
                });

                childProcess.stderr?.on("data", (data) => {
                    const line = data.toString();
                    if (
                        line.includes("INFO:     Application startup complete.")
                    ) {
                        console.log(line);
                        resolve(childProcess);
                    }
                });

                childProcess.stderr?.on("error", (data) => {
                    console.error(data.toString());
                    resolve(undefined);
                });

                childProcess.on("exit", function (code, signal) {
                    console.log(
                        `Whisper Service exited with code ${code} and signal ${signal}`,
                    );
                    resolve(undefined);
                });
            } catch (e: any) {
                console.log(e);
                resolve(undefined);
            }
        },
    );

    return Promise.race([localWhisperPromise, timeoutPromise]).then(
        (result) => {
            clearTimeout(timeoutHandle);
            return result;
        },
    );
}

export function getLocalWhisperCommandHandlers(): HandlerTable {
    return {
        description: "Configure Local Whisper",
        defaultSubCommand: undefined,
        commands: {
            off: {
                description: "Turn off Local Whisper integration",
                run: async (
                    request: string,
                    context: CommandHandlerContext,
                ) => {
                    if (context.localWhisper) {
                        context.localWhisper?.kill();
                        context.localWhisper = undefined;

                        context.requestIO.result(
                            chalk.blue(`Local Whisper disabled.`),
                        );
                    }
                },
            },
            on: {
                description: "Turn on Local Whisper integration.",
                run: async (
                    request: string,
                    context: CommandHandlerContext,
                ) => {
                    if (context.localWhisper) {
                        return;
                    }

                    try {
                        context.localWhisper = await createLocalWhisperHost();
                        if (context.localWhisper) {
                            context.requestIO.result(
                                chalk.blue(`Local Whisper enabled.`),
                            );
                        }
                    } catch {
                        context.requestIO.warn(
                            `Local Whisper was not enabled.`,
                        );
                    }
                },
            },
        },
    };
}
