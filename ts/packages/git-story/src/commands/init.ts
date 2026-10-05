// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Command } from "commander";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { cliLogger } from "../logger.js";

// Copilot CLI reads repo-level hooks from this file. The `.local` variant is
// per-clone, so init also adds it to `.git/info/exclude`.
const COPILOT_SETTINGS = ".github/copilot/settings.local.json";
// Copilot hook name -> command that handles it.
const COPILOT_HOOKS = {
    userPromptSubmitted: "git story hooks copilot user-prompt-submitted",
    sessionStart: "git story hooks copilot session-start",
    preToolUse: "git story hooks copilot pre-tool-use",
    postToolUse: "git story hooks copilot post-tool-use",
    postToolUseFailure: "git story hooks copilot post-tool-use-failure",
    agentStop: "git story hooks copilot agent-stop",
    sessionEnd: "git story hooks copilot session-end",
};

// Each Git hook forwards its arguments and stdin. Story capture is
// observational, so its failure never blocks a commit.
// Marks scripts written by init, so init never overwrites a user's own hook.
const GIT_HOOK_MARKER = "# git-story hook";
const gitHookScript = (hook: string) =>
    `#!/bin/sh\n${GIT_HOOK_MARKER}\ngit-story hooks git ${hook} "$@" || true\n`;

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
            hooks?: Record<string, Record<string, unknown>[]>;
            [key: string]: unknown;
        } = {};
        if (fs.existsSync(settingsPath)) {
            try {
                settings = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
            } catch (e) {
                const message = `Failed to parse ${settingsPath}: ${(e as Error).message}`;
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
                    (h) => h.bash !== command,
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
        if (!lines.includes(COPILOT_SETTINGS)) {
            fs.mkdirSync(path.dirname(exclude), { recursive: true });
            fs.appendFileSync(exclude, `${COPILOT_SETTINGS}\n`);
        }
        const copilotMessage = `Registered Copilot hooks in ${settingsPath}`;
        process.stdout.write(`${copilotMessage}\n`);
        cliLogger.info(copilotMessage);

        // Writes one git hook script. `--git-path hooks/<hook>` honors
        // `core.hooksPath` and worktrees.
        const registerGitHook = (hook: string) => {
            const hookPath = path.resolve(
                git("rev-parse", "--git-path", `hooks/${hook}`),
            );
            if (
                fs.existsSync(hookPath) &&
                !fs.readFileSync(hookPath, "utf8").includes(GIT_HOOK_MARKER)
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
        registerGitHook("pre-commit");
        registerGitHook("prepare-commit-msg");
        registerGitHook("post-commit");
    });
