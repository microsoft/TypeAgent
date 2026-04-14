// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// CLI handler template generator.
// Produces a complete TypeScript action handler that shells out to a CLI tool.
// Called by scaffolderHandler when the API surface contains CLI-sourced actions.

import type { DiscoveredAction } from "../discovery/discoveryHandler.js";

function flagToCamel(flag: string): string {
    return flag
        .replace(/^--?/, "")
        .replace(/-([a-z])/g, (_, c) => c.toUpperCase());
}

export function buildCliHandler(
    name: string,
    pascalName: string,
    cliCommand: string,
    actions: DiscoveredAction[],
): string {
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

    return `// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.
//
// Auto-generated CLI handler for ${name}

import { execFile } from "child_process";
import { promisify } from "util";
import {
    ActionContext,
    AppAgent,
    TypeAgentAction,
} from "@typeagent/agent-sdk";
import {
    createActionResultFromTextDisplay,
} from "@typeagent/agent-sdk/helpers/action";
import { ${pascalName}Actions } from "./${name}Schema.js";

const execFileAsync = promisify(execFile);

async function runCli(...cliArgs: string[]): Promise<string> {
    const { stdout, stderr } = await execFileAsync("${cliCommand}", cliArgs, {
        timeout: 30_000,
    });
    return (stdout || stderr).trim();
}

function buildArgs(action: TypeAgentAction<${pascalName}Actions>): string[] {
    const args: string[] = [];
    const params = action.parameters as Record<string, unknown>;
    switch (action.actionName) {
${cases.join("\n")}
        default:
            throw new Error(\`Unknown action: \${action.actionName}\`);
    }
    return args;
}

export function instantiate(): AppAgent {
    return {
        executeAction: async (
            action: TypeAgentAction<${pascalName}Actions>,
            context: ActionContext<${pascalName}Actions>,
        ) => {
            try {
                const args = buildArgs(action);
                const output = await runCli(...args);
                return createActionResultFromTextDisplay(output);
            } catch (e: unknown) {
                const msg = e instanceof Error ? e.message : String(e);
                return createActionResultFromTextDisplay(\`Error: \${msg}\`);
            }
        },
    };
}
`;
}
