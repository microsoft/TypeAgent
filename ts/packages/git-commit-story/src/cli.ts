#!/usr/bin/env node
// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// CLI entry point. On PATH as `git-commit-story`, so git also runs it as
// `git commit-story <command>`.
import { Command } from "commander";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

// Copilot CLI reads repo-level hooks from this file. The `.local` variant is
// per-clone, so init also adds it to `.git/info/exclude`.
const COPILOT_SETTINGS = ".github/copilot/settings.local.json";
const PROMPT_HOOK = "git commit-story hooks copilot user-prompt-submitted";

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

const program = new Command("git-commit-story")
    .description("Attach agent session stories to git commits")
    .version("0.0.1");

// Registers agent hooks for the current repository.
program
    .command("init")
    .description("Register agent hooks for the current repository")
    .action(() => {
        const git = (...args: string[]) =>
            execFileSync("git", args, { encoding: "utf8" }).trim();
        const root = git("rev-parse", "--show-toplevel");
        const settingsPath = path.join(root, COPILOT_SETTINGS);
        const settings = fs.existsSync(settingsPath)
            ? JSON.parse(fs.readFileSync(settingsPath, "utf8"))
            : {};
        // Update only our hook entry; keep other keys and hooks as they are.
        const hook = {
            type: "command",
            bash: PROMPT_HOOK,
            powershell: PROMPT_HOOK,
        };
        settings.hooks ??= {};
        settings.hooks.userPromptSubmitted = [
            ...(settings.hooks.userPromptSubmitted ?? []).filter(
                (h: { bash?: string }) => h.bash !== PROMPT_HOOK,
            ),
            hook,
        ];
        fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
        fs.writeFileSync(
            settingsPath,
            JSON.stringify(sortKeys(settings), null, 4) + "\n",
        );

        const exclude = path.resolve(
            root,
            git("rev-parse", "--git-path", "info/exclude"),
        );
        const lines = fs.existsSync(exclude)
            ? fs.readFileSync(exclude, "utf8").split("\n")
            : [];
        if (!lines.includes(COPILOT_SETTINGS)) {
            fs.mkdirSync(path.dirname(exclude), { recursive: true });
            fs.appendFileSync(exclude, `${COPILOT_SETTINGS}\n`);
        }
        process.stdout.write(`Registered Copilot hooks in ${settingsPath}\n`);
    });

// Agent hook handlers. Placeholder output until story capture exists.
program
    .command("hooks")
    .description("Agent hook handlers")
    .command("copilot")
    .description("Copilot CLI hook handlers")
    .command("user-prompt-submitted")
    .description("Handle the Copilot userPromptSubmitted hook")
    .action(() => {
        process.stdout.write("Hello World\n");
    });

program.parse();
