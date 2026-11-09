// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import fs from "node:fs";
import path from "node:path";
import { spawn, execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { createTrustedNormalHookReader } from "./macro-eval-native-callback.mjs";

const scripts = path.dirname(fileURLToPath(import.meta.url));
const hashFile = (file) => ({
    file,
    sha256: createHash("sha256").update(fs.readFileSync(file)).digest("hex"),
});
const json = (file) =>
    JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/u, ""));

export function stageNativeNormalHook(layout, deadlineMs) {
    const source = path.join(scripts, "macro-eval-native-hook.mjs");
    const wrapper = path.join(layout.plugin, "macro-eval-native-hook.mjs");
    const hooksFile = path.join(layout.plugin, "hooks.json");
    const hooks = json(hooksFile);
    const handlers = hooks.hooks?.userPromptSubmitted;
    if (
        handlers?.length !== 1 ||
        handlers[0].type !== "command" ||
        handlers[0].command !== "node ${PLUGIN_ROOT}/dist/hooks/hook-router.js"
    )
        throw new Error(
            "Unsupported actual staged hook command; no wrapper installed",
        );
    fs.copyFileSync(source, wrapper, fs.constants.COPYFILE_EXCL);
    handlers[0].command = `& "${process.execPath}" "\${PLUGIN_ROOT}/macro-eval-native-hook.mjs"`;
    fs.writeFileSync(hooksFile, JSON.stringify(hooks, null, 2) + "\n");
    const pipe = `typeagent-native-${randomUUID()}`;
    const policyFile = path.join(
        layout.plugin,
        "native-normal-hook-config.json",
    );
    fs.writeFileSync(
        policyFile,
        JSON.stringify(
            {
                protocol: "native-normal-hook-owned-launch-v1",
                owner: layout.owner,
                pipe,
                deadlineMs,
                ownedRoot: layout.run,
                pluginData: layout.pluginData,
                dataRoot: layout.data,
                workspace: layout.workspace,
            },
            null,
            2,
        ) + "\n",
        { flag: "wx" },
    );
    return {
        pipe,
        policy: hashFile(policyFile),
        wrapper: hashFile(wrapper),
        router: hashFile(
            path.join(layout.plugin, "dist", "hooks", "hook-router.js"),
        ),
        node: {
            executable: process.execPath,
            sha256: hashFile(process.execPath).sha256,
        },
        command: handlers[0].command,
        serverSource: hashFile(
            path.join(scripts, "macro-eval-native-pipe.ps1"),
        ),
    };
}

export async function startNativeNormalHookReader({
    layout,
    staged,
    budget,
    probe,
    cli,
    index = 0,
}) {
    const directory = path.join(
        layout.run,
        index === 0 ? "normal-hook" : `normal-hook-${index}`,
    );
    fs.mkdirSync(directory);
    const pipe = staged.pipe;
    const deadlineMs = Date.now() + budget.remaining();
    const child = spawn(
        "powershell.exe",
        [
            "-NoProfile",
            "-File",
            staged.serverSource.file,
            "-Directory",
            directory,
            "-PipeName",
            pipe,
            "-DeadlineMs",
            String(deadlineMs),
        ],
        { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] },
    );
    let stderr = "";
    child.stderr.on("data", (value) => {
        stderr += value.toString();
    });
    const server = probe(child.pid);
    if (!server) {
        child.kill();
        throw new Error("Owned normal-hook OS reader identity missing");
    }
    const stop = () => {
        const current = probe(child.pid);
        if (
            current?.StartedMs === server.StartedMs &&
            current.ExecutablePath === server.ExecutablePath
        )
            execFileSync(
                "powershell.exe",
                [
                    "-NoProfile",
                    "-Command",
                    `Stop-Process -Id ${child.pid} -Force -ErrorAction Stop`,
                ],
                { stdio: "ignore" },
            );
    };
    try {
        const readyFile = path.join(directory, "ready.json");
        const until = Date.now() + Math.min(15000, budget.remaining());
        while (
            !fs.existsSync(readyFile) &&
            Date.now() < until &&
            child.exitCode === null
        ) {
            budget.check();
            await delay(50);
        }
        if (!fs.existsSync(readyFile))
            throw new Error(
                `Owned normal-hook receiver startup failed: ${stderr}`,
            );
        const ready = json(readyFile);
        if (
            ready.serverPid !== child.pid ||
            ready.pipe !== pipe ||
            ready.api !== "GetNamedPipeClientProcessId/SafePipeHandle"
        )
            throw new Error("Owned normal-hook receiver readiness mismatch");
        const identity = probe(child.pid);
        if (identity?.StartedMs !== server.StartedMs)
            throw new Error("Owned reader PID lifetime changed at readiness");
        fs.writeFileSync(
            path.join(directory, "owned-reader.json"),
            JSON.stringify(
                {
                    owner: layout.owner,
                    server,
                    pipe,
                    source: staged.serverSource,
                    osApi: ready.api,
                    deadlineMs,
                    observedAt: new Date().toISOString(),
                },
                null,
                2,
            ) + "\n",
            { flag: "wx" },
        );
        const state = { accepted: new Set(), seenPeers: new Set() };
        return {
            pipe,
            deadlineMs,
            server,
            stop,
            bind(mode, configDigest) {
                return createTrustedNormalHookReader({
                    directory,
                    probe,
                    state,
                    binding: {
                        owner: layout.owner,
                        ownedRoot: layout.run,
                        pipe,
                        server,
                        cli,
                        ...staged,
                        mode,
                        configDigest,
                    },
                });
            },
        };
    } catch (error) {
        stop();
        throw error;
    }
}
