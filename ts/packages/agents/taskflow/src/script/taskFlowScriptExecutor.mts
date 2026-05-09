// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createScriptExecutor, BLOCKED_IDENTIFIERS } from "@typeagent/agent-flows";
import { TaskFlowScriptAPI } from "./taskFlowScriptApi.mjs";
import { TaskFlowScriptResult } from "./types.mjs";

export interface ScriptExecutionOptions {
    timeout: number;
}

const executor = createScriptExecutor({
    apiParamName: "api",
    defaultTimeout: 300_000,
    blockedIdentifiers: BLOCKED_IDENTIFIERS,
});

export async function executeTaskFlowScript(
    scriptSource: string,
    api: TaskFlowScriptAPI,
    params: Record<string, unknown>,
    options: ScriptExecutionOptions = { timeout: 300_000 },
): Promise<TaskFlowScriptResult> {
    return executor.execute(
        scriptSource,
        api,
        params,
        options,
    ) as Promise<TaskFlowScriptResult>;
}
