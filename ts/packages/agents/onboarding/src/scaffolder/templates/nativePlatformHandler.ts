// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Pattern: native-platform — OS/device APIs via child_process or SDK.
// No cloud dependency. Handle platform differences in executeCommand().

import {
    ActionContext,
    AppAgent,
    TypeAgentAction,
    ActionResult,
} from "@typeagent/agent-sdk";
import { createActionResultFromTextDisplay } from "@typeagent/agent-sdk/helpers/action";
import { exec } from "child_process";
import { promisify } from "util";
import { __AgentName__Actions } from "./__agentName__Schema.js";

const execAsync = promisify(exec);
const platform = process.platform; // "win32" | "darwin" | "linux"

export function instantiate(): AppAgent {
    return {
        initializeAgentContext,
        executeAction,
    };
}

async function initializeAgentContext(): Promise<unknown> {
    return {};
}

async function executeAction(
    action: TypeAgentAction<__AgentName__Actions>,
    _context: ActionContext<unknown>,
): Promise<ActionResult> {
    try {
        const output = await executeCommand(
            action.actionName,
            action.parameters as Record<string, unknown>,
        );
        return createActionResultFromTextDisplay(output ?? "Done.");
    } catch (err: any) {
        return { error: err?.message ?? String(err) };
    }
}

/**
 * Map a typed action to a platform-specific shell command or SDK call.
 * Add one case per action defined in __AgentName__Actions.
 */
async function executeCommand(
    actionName: string,
    parameters: Record<string, unknown>,
): Promise<string> {
    switch (actionName) {
        // TODO: add cases for each action. Example:
        // case "openFile": {
        //     const cmd = platform === "win32" ? `start "" "${parameters.path}"`
        //               : platform === "darwin" ? `open "${parameters.path}"`
        //               : `xdg-open "${parameters.path}"`;
        //     return (await execAsync(cmd)).stdout;
        // }
        default:
            throw new Error(`Not implemented: ${actionName}`);
    }
}
