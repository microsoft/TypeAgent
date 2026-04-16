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

function buildSwitchCases(actions: DiscoveredAction[]): string {
    const cases: string[] = [];
    for (const action of actions) {
        const subCmd = action.path ?? action.name;
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
            `        case "${action.name}":\n            args.push(...${JSON.stringify(subCmd.split(" "))});${body}break;`,
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
    const switchCases = buildSwitchCases(actions);
    return tpl
        .replace(/\{\{NAME\}\}/g, name)
        .replace(/\{\{PASCAL_NAME\}\}/g, pascalName)
        .replace(/\{\{CLI_COMMAND\}\}/g, cliCommand)
        .replace(/\{\{SWITCH_CASES\}\}/g, switchCases);
}
