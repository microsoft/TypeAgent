// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { CommandDescriptorTable } from "@typeagent/agent-sdk";
import child_process from "node:child_process";
import { fileURLToPath } from "node:url";
import { getToggleCommandHandlers } from "agent-dispatcher/helpers/command";
import { isTest } from "../index.js";
import path from "node:path";
import net from "node:net";
import registerDebug from "debug";
export const debugShellPen = registerDebug("typeagent:shell:pen");
export const debugShellPenError = registerDebug("typeagent:shell:pen:error");

const penLauncherPath = new URL(
    "../../../../../../dotnet/penLauncher/bin/Debug/net9.0/penLauncher.exe",
    import.meta.url,
);

async function spawnPenLauncherProcess(args: string) {
    return new Promise<child_process.ChildProcess>((resolve, reject) => {
        const child = child_process.spawn(fileURLToPath(penLauncherPath), [
            args,
        ]);
        child.on("error", (err) => {
            reject(err);
        });
        child.on("spawn", () => {
            resolve(child);
        });
    });
}

export async function initializePen(recognitionCallback: () => void) {
    // On windows, we will spin up a local end point that listens
    // for pen events which will trigger speech reco
    // Don't spin this up during testing
    if (process.platform == "win32" && !isTest) {
        const pipePath = path.join("\\\\.\\pipe\\TypeAgent", "speech");
        const server = net.createServer((stream) => {
            stream.on("data", (c) => {
                if (c.toString() == "triggerRecognitionOnce") {
                    console.log("Pen click note button click received!");
                    recognitionCallback();
                }
            });
            stream.on("error", (e) => {
                console.log(e);
            });
        });

        try {
            const p = Promise.withResolvers<void>();
            server.on("error", (e) => {
                p.reject(e);
            });
            server.listen(pipePath, () => {
                debugShellPen("Listening for pen events on", pipePath);
                p.resolve();
            });
            await p.promise;
        } catch (e) {
            debugShellPenError(`Error creating pipe at ${pipePath}: ${e}`);
        }
    }
}

export const penCommandTable: CommandDescriptorTable = {
    description: "Toggles click note pen handler.",
    defaultSubCommand: "on",
    commands: getToggleCommandHandlers(
        "Surface Pen Click Handler",
        async (_, enable) => {
            if (enable) {
                if (process.platform !== "win32") {
                    throw new Error(
                        "Surface Pen Click Handler is only supported on Windows.",
                    );
                }

                if (isTest) {
                    throw new Error(
                        "Surface Pen Click Handler cannot be enabled in test mode.",
                    );
                }
                spawnPenLauncherProcess("--register");
            } else {
                spawnPenLauncherProcess("--unregister");
            }
        },
    ),
};
