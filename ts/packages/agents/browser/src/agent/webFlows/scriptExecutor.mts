// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createScriptExecutor, BLOCKED_IDENTIFIERS } from "@typeagent/agent-flows";
import { WebFlowBrowserAPI } from "./webFlowBrowserApi.mjs";
import { WebFlowResult } from "./types.js";

export interface ScriptExecutionOptions {
    timeout: number;
}

const executor = createScriptExecutor({
    apiParamName: "browser",
    defaultTimeout: 180_000,
    blockedIdentifiers: BLOCKED_IDENTIFIERS,
});

export async function executeWebFlowScript(
    scriptSource: string,
    browserApi: WebFlowBrowserAPI,
    params: Record<string, unknown>,
    options: ScriptExecutionOptions = { timeout: 180_000 },
): Promise<WebFlowResult> {
    return executor.execute(
        scriptSource,
        browserApi,
        params,
        options,
    ) as Promise<WebFlowResult>;
}
