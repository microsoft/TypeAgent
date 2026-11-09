// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { CommandDefinition } from "@github/copilot-sdk";
import {
    getConfigPath,
    getMacroToolAvailability,
    getMode,
    getModeLabel,
} from "../shared/plugin-config.js";
import {
    getModeDescription,
    handleModeSetting,
} from "../shared/mode-command.js";
import { connectToMacroOwner } from "../shared/macro-owner.js";
import { recipeOwnerSetting } from "../shared/recipe-owner-command.js";
import { cancelMacroWork, learningSetting } from "../shared/macro-learning.js";
import { publishControlMetadata } from "../shared/control-metadata.js";
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, renameSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, basename, join } from "node:path";
import { fileURLToPath } from "node:url";

function controlStatus(): string {
    const extension = publishControlMetadata("native-extension-status");
    if (!extension)
        return JSON.stringify({
            effectiveMode: null,
            source: "control admission missing",
        });
    const moduleDirectory = dirname(fileURLToPath(import.meta.url));
    const root = dirname(dirname(moduleDirectory));
    const hook =
        basename(root) === "dist"
            ? join(root, "hooks", "hook-router.js")
            : join(root, "dist", "hooks", "hook-router.js");
    const child = spawnSync("node", [hook, "--control-metadata"], {
        encoding: "utf8",
        env: process.env,
        timeout: 5000,
        stdio: ["ignore", "pipe", "pipe"],
    });
    if (child.error || child.status !== 0)
        throw new Error("Canonical Node control getter failed");
    const metadata = JSON.parse(child.stdout);
    if (
        metadata.source.pid !== child.pid ||
        metadata.source.parentPid !== process.pid
    )
        throw new Error(
            "Control getter output does not match actual spawned child",
        );
    const getter = {
        ProcessId: child.pid,
        ParentProcessId: process.pid,
        ExecutablePath: metadata.source.executable,
        script: hook,
        scriptHash: createHash("sha256")
            .update(readFileSync(hook))
            .digest("hex"),
        observedAt: new Date().toISOString(),
        provenance: "registered-status-public-spawnSync-result",
    };
    const file = join(extension.dataRoot, "native-control-getter-process.json");
    writeFileSync(`${file}.pending`, JSON.stringify(getter), { flag: "wx" });
    renameSync(`${file}.pending`, file);
    return JSON.stringify({ extension, hook: metadata, getter });
}

function statusText(): string {
    const host = process.env.TYPEAGENT_HOST || "localhost";
    const port = process.env.TYPEAGENT_PORT || "8999";
    return [
        "TypeAgent configuration",
        `Mode: ${getModeLabel()}`,
        `Routing: ${getModeDescription()}`,
        getMode() === "bypass"
            ? "Ordinary prompts: Copilot (no local recipe matching)"
            : "Ordinary prompts: local recipes, then Copilot",
        `Macro tools: ${getMacroToolAvailability()}`,
        `Server: ws://${host}:${port}`,
        `Config: ${getConfigPath()}`,
        "Mode settings are shared by sessions using this config.",
    ].join("\n");
}

export function createExtensionCommands(
    log: (message: string) => Promise<void>,
    sendTask?: (task: string) => Promise<void>,
): CommandDefinition[] {
    return [
        {
            name: "typeagent-recipe-owner",
            description:
                "Show or enable/disable local recipes: plugin, off; restart after changing",
            handler: async ({ args }) => log(recipeOwnerSetting(args)),
        },
        {
            name: "typeagent-status",
            description: "Show TypeAgent configuration and connection details",
            handler: async ({ args }) =>
                args?.trim() === "--control"
                    ? log(controlStatus())
                    : log(statusText()),
        },
        {
            name: "typeagent-mode",
            description:
                "Show or set explicit TypeAgent mode: direct, mcp [delegate|mixed], dev, bypass. Ordinary prompts use local recipes, then Copilot; bypass disables recipe routing.",
            handler: async ({ args }) => {
                await log(handleModeSetting(args, "/typeagent-mode"));
            },
        },
        {
            name: "typeagent-macro-learning",
            description:
                "Show or set workspace macro learning: off, prepare, read-only, all",
            handler: async ({ args, sessionId }) =>
                log(await learningSetting(process.cwd(), args, sessionId)),
        },
        {
            name: "typeagent-macro-status",
            description: "Show recording and background macro learning status",
            handler: async ({ sessionId }) => {
                const connection = await connectToMacroOwner(
                    process.cwd(),
                    sessionId,
                );
                try {
                    const state =
                        await connection.getMacroRecordingState(sessionId);
                    await log(JSON.stringify(state, null, 2));
                } finally {
                    await connection.close();
                }
            },
        },
        {
            name: "typeagent-macro-cancel",
            description:
                "Cancel selected recording or unapproved background preparation",
            handler: async ({ sessionId }) =>
                log(await cancelMacroWork(sessionId)),
        },
        {
            name: "typeagent-macro-record",
            description:
                "Execute and learn a task, or learn the next executed interaction",
            handler: async ({ sessionId, args }) => {
                const task = args.trim();
                if (task && !sendTask) {
                    throw new Error(
                        "Task execution is unavailable in this extension session.",
                    );
                }
                const connection = await connectToMacroOwner(
                    process.cwd(),
                    sessionId,
                );
                try {
                    const token = await connection.armMacroRecording({
                        sessionId,
                        cwd: process.cwd(),
                        learning: true,
                    });
                    await log(
                        `Macro learning armed for ${task ? "this task" : "the next interaction"}. Recording token: ${token.id}`,
                    );
                } finally {
                    await connection.close();
                }
                if (task && sendTask) await sendTask(task);
            },
        },
    ];
}
