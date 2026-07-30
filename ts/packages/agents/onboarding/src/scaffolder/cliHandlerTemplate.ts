// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// CLI handler template generator.
// Produces a complete TypeScript action handler that shells out to a CLI tool.
// Called by scaffolderHandler when the API surface contains CLI-sourced actions.
// The handler skeleton lives in cliHandler.template; this module builds the
// switch-case body and interpolates the placeholders.

import type { DiscoveredAction } from "../discovery/discoveryHandler.js";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Resolve template from src/ relative to the package root.
// At runtime __dirname is dist/scaffolder/, so go up two levels to package root.
function templatePath(): string {
    return path.resolve(__dirname, "../../src/scaffolder/cliHandler.template");
}

function flagToCamel(flag: string): string {
    return flag
        .replace(/^--?/, "")
        .replace(/-([a-z])/g, (_, c) => c.toUpperCase());
}

// The discovered `action.path` is the full command path including the base
// command (e.g. "gh repo create" or "randomstub number"). The runtime handler
// already invokes the base command as the executable via execFile, so the
// switch cases must contribute only the subcommand tokens. Strip a leading
// base-command prefix to avoid emitting it twice (which produced a bogus
// `randomstub randomstub number ...` invocation).
function subcommandTokens(fullPath: string, cliCommand: string): string[] {
    const pathTokens = fullPath.trim().split(/\s+/).filter(Boolean);
    const baseTokens = cliCommand.trim().split(/\s+/).filter(Boolean);
    let i = 0;
    while (
        i < baseTokens.length &&
        i < pathTokens.length &&
        pathTokens[i] === baseTokens[i]
    ) {
        i++;
    }
    return pathTokens.slice(i);
}

function buildSwitchCases(
    actions: DiscoveredAction[],
    cliCommand: string,
): string {
    const cases: string[] = [];
    for (const action of actions) {
        const subCmd = subcommandTokens(action.path ?? action.name, cliCommand);
        const flagLines: string[] = [];
        if (action.parameters) {
            for (const p of action.parameters) {
                const camel = flagToCamel(p.name);
                const flag = p.name.startsWith("-") ? p.name : `--${p.name}`;
                if (p.type === "boolean") {
                    flagLines.push(
                        `            if (params.${camel} === true) args.push("${flag}");`,
                    );
                } else {
                    flagLines.push(
                        `            if (params.${camel} !== undefined && params.${camel} !== null) args.push("${flag}", String(params.${camel}));`,
                    );
                }
            }
        }
        const body =
            flagLines.length > 0
                ? `\n${flagLines.join("\n")}\n            `
                : " ";
        cases.push(
            `        case "${action.name}":\n            args.push(...${JSON.stringify(subCmd)});${body}break;`,
        );
    }
    return cases.join("\n");
}

export async function buildCliHandler(
    name: string,
    pascalName: string,
    cliCommand: string,
    actions: DiscoveredAction[],
): Promise<string> {
    const tpl = await fs.readFile(templatePath(), "utf-8");
    const switchCases = buildSwitchCases(actions, cliCommand);
    return tpl
        .replace(/\{\{NAME\}\}/g, name)
        .replace(/\{\{PASCAL_NAME\}\}/g, pascalName)
        .replace(/\{\{CLI_COMMAND\}\}/g, cliCommand)
        .replace(/\{\{SWITCH_CASES\}\}/g, switchCases);
}
