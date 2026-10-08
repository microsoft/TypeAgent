// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Command } from "commander";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { cliLogger } from "../logger.js";

// Copilot CLI reads repo-level hooks from this file. The `.local` variant is
// per-clone, so init also adds it to `.git/info/exclude`.
const COPILOT_SETTINGS = ".github/copilot/settings.local.json";
// Copilot hook name -> command that handles it.
const COPILOT_HOOKS = {
    userPromptSubmitted: "git story hooks copilot user-prompt-submitted",
    sessionStart: "git story hooks copilot session-start",
    agentStop: "git story hooks copilot agent-stop",
};

// VS Code loads every `*.json` in `.github/hooks`. Preserve user entries even
// when they share this file; exclude it like COPILOT_SETTINGS.
const VSCODE_HOOKS = ".github/hooks/git-story.json";
const VSCODE_HOOKS_CONFIG = {
    hooks: {
        SessionStart: [
            {
                type: "command",
                command: "git story hooks vscode session-start",
            },
        ],
    },
};

// Each git hook gets a shell script that forwards git's args and stdin to
// `git-story hooks git <hook>`. `exec` hands the script's stdin to the
// command, so hooks that receive input (e.g. pre-push) keep it.
// Marks scripts written by init, so init never overwrites a user's own hook.
const GIT_HOOK_MARKER = "# git-story hook";
const GIT_HOOKS = [
    "pre-commit",
    "prepare-commit-msg",
    "post-commit",
    "post-merge",
    "post-rewrite",
    "post-checkout",
];
const SettingsSchema = z
    .object({
        hooks: z
            .record(z.string(), z.array(z.record(z.string(), z.unknown())))
            .optional(),
    })
    .passthrough();
const gitHookScript = (hook: string) =>
    `#!/bin/sh\n${GIT_HOOK_MARKER}\nexec git-story hooks git ${hook} "$@"\n`;

// Recursively sorts object keys so the settings file has a stable order.
// Array order is kept. Example: {b:1,a:{d:2,c:3}} -> {a:{c:3,d:2},b:1}.
function sortKeys(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(sortKeys);
    if (value === null || typeof value !== "object") return value;
    return Object.fromEntries(
        Object.keys(value)
            .sort()
            .map((k) => [k, sortKeys((value as Record<string, unknown>)[k])]),
    );
}

// `init`: registers agent hooks for the current repository.
export const initCommand = new Command("init")
    .description("Register agent hooks for the current repository")
    .action(() => {
        const git = (...args: string[]) =>
            execFileSync("git", args, { encoding: "utf8" }).trim();
        const root = git("rev-parse", "--show-toplevel");
        const settingsPath = path.join(root, COPILOT_SETTINGS);
        let settings: {
            hooks?: Record<string, Record<string, unknown>[]> | undefined;
            [key: string]: unknown;
        } = {};
        if (fs.existsSync(settingsPath)) {
            try {
                settings = SettingsSchema.parse(
                    JSON.parse(fs.readFileSync(settingsPath, "utf8")),
                );
            } catch {
                const message =
                    "Invalid Copilot settings; existing file was not changed";
                process.stderr.write(`${message}\n`);
                cliLogger.error(message);
                process.exitCode = 1;
                return;
            }
        }
        // Update only our hook entries; keep other keys and hooks as they are.
        settings.hooks ??= {};
        for (const [name, command] of Object.entries(COPILOT_HOOKS)) {
            settings.hooks[name] = [
                ...(settings.hooks[name] ?? []).filter(
                    (h) =>
                        !(
                            h.type === "command" &&
                            h.bash === command &&
                            h.powershell === command
                        ),
                ),
                { type: "command", bash: command, powershell: command },
            ];
        }
        fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
        fs.writeFileSync(
            settingsPath,
            JSON.stringify(sortKeys(settings), null, 4) + "\n",
        );

        // `--git-path` is relative to the cwd (not the repo root), so resolve
        // it against the cwd to work from subdirectories.
        const exclude = path.resolve(
            git("rev-parse", "--git-path", "info/exclude"),
        );
        const lines = fs.existsSync(exclude)
            ? fs.readFileSync(exclude, "utf8").split("\n")
            : [];
        for (const file of [COPILOT_SETTINGS, VSCODE_HOOKS]) {
            if (!lines.includes(file)) {
                fs.mkdirSync(path.dirname(exclude), { recursive: true });
                fs.appendFileSync(exclude, `${file}\n`);
            }
        }
        const copilotMessage = `Registered Copilot hooks in ${settingsPath}`;
        process.stdout.write(`${copilotMessage}\n`);
        cliLogger.info(copilotMessage);

        // VS Code hook registration is supported, but native transcript capture
        // fails closed until a format adapter exists.
        const vscodePath = path.join(root, VSCODE_HOOKS);
        let vscodeSettings: z.infer<typeof SettingsSchema> = {};
        if (fs.existsSync(vscodePath)) {
            try {
                vscodeSettings = SettingsSchema.parse(
                    JSON.parse(fs.readFileSync(vscodePath, "utf8")),
                );
            } catch {
                process.stderr.write(
                    "Invalid VS Code hooks; existing file was not changed\n",
                );
                cliLogger.error(
                    "Invalid VS Code hooks; existing file was not changed",
                );
                process.exitCode = 1;
                return;
            }
        }
        vscodeSettings.hooks ??= {};
        const owned = VSCODE_HOOKS_CONFIG.hooks.SessionStart[0]!;
        vscodeSettings.hooks.SessionStart = [
            ...(vscodeSettings.hooks.SessionStart ?? []).filter(
                (entry) =>
                    !(
                        Object.keys(entry).length === 2 &&
                        entry.type === owned.type &&
                        entry.command === owned.command
                    ),
            ),
            owned,
        ];
        fs.mkdirSync(path.dirname(vscodePath), { recursive: true });
        fs.writeFileSync(
            vscodePath,
            JSON.stringify(sortKeys(vscodeSettings), null, 4) + "\n",
        );
        const vscodeMessage = `Registered VS Code hooks in ${vscodePath}`;
        process.stdout.write(`${vscodeMessage}\n`);
        cliLogger.info(vscodeMessage);

        // Writes one git hook script. `--git-path hooks/<hook>` honors
        // `core.hooksPath` and worktrees.
        const registerGitHook = (hook: string) => {
            const hookPath = path.resolve(
                git("rev-parse", "--git-path", `hooks/${hook}`),
            );
            if (
                fs.existsSync(hookPath) &&
                fs.readFileSync(hookPath, "utf8").replaceAll("\r\n", "\n") !==
                    gitHookScript(hook)
            ) {
                const message = `Skipped ${hookPath}: existing hook not owned by git-story`;
                process.stderr.write(`${message}\n`);
                cliLogger.error(message);
                process.exitCode = 1;
                return;
            }
            fs.mkdirSync(path.dirname(hookPath), { recursive: true });
            fs.writeFileSync(hookPath, gitHookScript(hook), { mode: 0o755 });
            const message = `Registered git ${hook} hook in ${hookPath}`;
            process.stdout.write(`${message}\n`);
            cliLogger.info(message);
        };
        for (const hook of GIT_HOOKS) {
            registerGitHook(hook);
        }
    });
