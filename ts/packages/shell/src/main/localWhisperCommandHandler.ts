// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ChildProcessWithoutNullStreams, spawn } from "child_process";
import { CommandHandlerTable } from "@typeagent/agent-sdk/helpers/command";
import { displayWarn } from "@typeagent/agent-sdk/helpers/display";
import { ActionContext } from "@typeagent/agent-sdk";
import type { ShellContext } from "./agent.js";

import registerDebug from "debug";
import { fileURLToPath } from "url";

const debug = registerDebug("shell:localWhisper");
const debugError = registerDebug("shell:localWhisper:error");

const localWhisperPythonScriptPath = fileURLToPath(
    new URL(
        "../../../../../python/stt/whisperService/faster-whisper.py",
        import.meta.url,
    ),
);
async function createLocalWhisperHost(): Promise<ChildProcessWithoutNullStreams> {
    let timeoutHandle: NodeJS.Timeout | undefined;

    const serviceRoot = localWhisperPythonScriptPath;
    debug(`Starting local whisper service at ${serviceRoot}`);
    const childProcess = spawn("python", [serviceRoot]);

    const timeoutPromise = new Promise<ChildProcessWithoutNullStreams>(
        (_resolve, reject) => {
            timeoutHandle = setTimeout(
                () => reject(new Error("Timeout")),
                10000,
            );
        },
    );
    const localWhisperPromise = new Promise<ChildProcessWithoutNullStreams>(
        (resolve, reject) => {
            childProcess.stderr.on("data", (data) => {
                const line = data.toString();
                debug(line);
                if (line.includes("INFO:     Application startup complete.")) {
                    childProcess.removeAllListeners();
                    resolve(childProcess);
                }
            });
            childProcess.on("error", (err: Error) => {
                reject(err);
            });
            childProcess.on("exit", function (code, signal) {
                reject(
                    new Error(
                        `Whisper Service exited with code ${code} and signal ${signal}`,
                    ),
                );
            });
        },
    );

    try {
        return await Promise.race([localWhisperPromise, timeoutPromise]);
    } catch (e) {
        childProcess.removeAllListeners();
        childProcess.kill();
        throw e;
    } finally {
        if (timeoutHandle !== undefined) {
            clearTimeout(timeoutHandle);
        }
    }
}

let localWhisperProcess: ChildProcessWithoutNullStreams | undefined;

export function isLocalWhisperEnabled() {
    return localWhisperProcess !== undefined;
}

export async function ensureLocalWhisper() {
    if (localWhisperProcess === undefined) {
        localWhisperProcess = await createLocalWhisperHost();
        localWhisperProcess.on("exit", function (code, signal) {
            debugError(
                "Local Whisper exited with code %d and signal %s",
                code,
                signal,
            );
            localWhisperProcess = undefined;
        });

        localWhisperProcess.stdout.on("data", (data) => {
            debug(data.toString());
        });
        localWhisperProcess.stderr.on("data", (data) => {
            debugError(data.toString());
        });
    }
    return localWhisperProcess;
}

export function closeLocalWhisper() {
    if (localWhisperProcess) {
        localWhisperProcess.removeAllListeners();
        localWhisperProcess.kill();
        localWhisperProcess = undefined;
        return true;
    }
    return false;
}

export function getLocalWhisperCommandHandlers(
    selectProvider: (
        context: ActionContext<ShellContext>,
        provider: "azure" | "whisper",
    ) => Promise<void>,
): CommandHandlerTable {
    return {
        description: "Configure Local Whisper",
        commands: {
            off: {
                description: "Turn off Local Whisper integration",
                run: async (context: ActionContext<ShellContext>) => {
                    displayWarn(
                        "Deprecated: use @shell speechProvider azure.",
                        context,
                    );
                    await selectProvider(context, "azure");
                },
            },
            on: {
                description: "Turn on Local Whisper integration.",
                run: async (context: ActionContext<ShellContext>) => {
                    displayWarn(
                        "Deprecated: use @shell speechProvider whisper.",
                        context,
                    );
                    await selectProvider(context, "whisper");
                },
            },
        },
    };
}
