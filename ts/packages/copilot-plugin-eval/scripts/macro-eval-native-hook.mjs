// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import net from "node:net";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const chunks = [];
let length = 0;
for await (const chunk of process.stdin) {
    length += chunk.length;
    if (length > 65536)
        throw new Error("Native hook stdin exceeds owned bound");
    chunks.push(chunk);
}
const stdin = Buffer.concat(chunks).toString("utf8");
const input = JSON.parse(stdin);
const policy = JSON.parse(
    fs.readFileSync(
        fileURLToPath(
            new URL("./native-normal-hook-config.json", import.meta.url),
        ),
        "utf8",
    ),
);
if (policy.protocol !== "native-normal-hook-owned-launch-v1")
    throw new Error("Owned staged normal-hook policy unavailable");
const ownedRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const samePhysical = (actual, expected) =>
    typeof actual === "string" &&
    path.isAbsolute(actual) &&
    fs.realpathSync(actual) === fs.realpathSync(expected);
const owner = JSON.parse(
    fs.readFileSync(path.join(ownedRoot, "evaluation-owner.json"), "utf8"),
);
if (
    policy.owner !== owner.owner ||
    !samePhysical(policy.ownedRoot, ownedRoot) ||
    !samePhysical(policy.pluginData, path.join(ownedRoot, "plugin-data")) ||
    !samePhysical(policy.dataRoot, path.join(ownedRoot, "data")) ||
    !samePhysical(policy.workspace, path.join(ownedRoot, "workspace")) ||
    !samePhysical(input.cwd, policy.workspace) ||
    !samePhysical(process.env.TYPEAGENT_USER_DATA_DIR, policy.dataRoot)
)
    throw new Error(
        "Native hook launch policy differs from physical owned input/config roots",
    );
const nativePluginData = fs.realpathSync(process.env.CLAUDE_PLUGIN_DATA);
const nativeRelative = path.relative(ownedRoot, nativePluginData);
if (nativeRelative.startsWith("..") || path.isAbsolute(nativeRelative))
    throw new Error("Native hook inherited an unowned plugin-data directory");
const router = fileURLToPath(
    new URL("./dist/hooks/hook-router.js", import.meta.url),
);
const deadline = policy.deadlineMs;
if (!Number.isFinite(deadline) || deadline <= Date.now())
    throw new Error("Owned native hook execution deadline unavailable");
// Keep the real router waiting on stdin while the OS reader associates both processes.
const child = spawn(process.execPath, [router], {
    env: { ...process.env, CLAUDE_PLUGIN_DATA: policy.pluginData },
    stdio: ["pipe", "pipe", "inherit"],
});
child.stdout.pipe(process.stdout);
const completion = new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => {
        if (signal) reject(new Error("Owned compiled hook terminated"));
        else resolve(code ?? 1);
    });
});
const executionTimer = setTimeout(
    () => child.kill(),
    Math.min(300000, deadline - Date.now()),
);
try {
    const ordinary =
        typeof input.prompt === "string" &&
        input.prompt.length > 0 &&
        !/^\s*(?:\/|@typeagent\b)/iu.test(input.prompt);
    if (ordinary) {
        const pipe = policy.pipe;
        if (!/^typeagent-native-[a-f0-9-]{36}$/u.test(pipe ?? ""))
            throw new Error("Owned normal-hook receiver unavailable");
        await new Promise((resolve, reject) => {
            const socket = net.createConnection(`\\\\.\\pipe\\${pipe}`);
            const timer = setTimeout(() => {
                socket.destroy();
                reject(new Error("Owned normal-hook association deadline"));
            }, 15000);
            let reply = "";
            socket.on("error", reject);
            socket.on("connect", () => {
                socket.write(
                    JSON.stringify({
                        protocol: "native-hook-stdin-v1",
                        stdin,
                    }) + "\n",
                );
            });
            socket.on("data", (chunk) => {
                reply += chunk.toString("utf8");
                if (reply === "associated\n") {
                    clearTimeout(timer);
                    socket.end();
                    resolve();
                } else if (reply.length > 64) {
                    clearTimeout(timer);
                    socket.destroy();
                    reject(
                        new Error("Unexpected owned hook association reply"),
                    );
                }
            });
            socket.on("close", () => {
                clearTimeout(timer);
                if (reply !== "associated\n")
                    reject(
                        new Error(
                            "Owned hook association closed without receipt",
                        ),
                    );
            });
        });
    }
    child.stdin.end(stdin);
    process.exitCode = await completion;
} finally {
    clearTimeout(executionTimer);
    if (child.exitCode === null && child.signalCode === null) child.kill();
}
