// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import registerDebug from "debug";
import { createRequire } from "node:module";

export interface AgentDebugModule {
    readonly debug: typeof registerDebug;
    readonly path: string;
}

export function loadAgentDebug(
    modulePath: string,
    hostDebug: typeof registerDebug,
): AgentDebugModule | undefined {
    try {
        const require = createRequire(modulePath);
        const debugPath = require.resolve("debug");
        const agentDebug = require(debugPath) as typeof registerDebug;
        return agentDebug === hostDebug
            ? undefined
            : { debug: agentDebug, path: debugPath };
    } catch {
        return undefined;
    }
}
