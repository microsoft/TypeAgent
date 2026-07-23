// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createScriptExecutor } from "@typeagent/agent-flows";
import {
    type RepositoryObservation,
    type RepositoryTools,
    type RepositoryToolTrace,
} from "./repositoryApi.js";

export interface ExploreScriptExecution {
    ok: boolean;
    result?: unknown;
    error?: string;
    toolTrace: RepositoryToolTrace;
    observations: RepositoryObservation[];
}

export function createExploreScriptExecutor(defaultTimeout: number): {
    execute(
        script: string,
        tools: RepositoryTools,
        query: string,
        maxResults: number,
        timeout?: number,
    ): Promise<ExploreScriptExecution>;
} {
    const executor = createScriptExecutor({
        apiParamName: "repo",
        defaultTimeout,
    });

    return {
        async execute(
            script,
            tools,
            query,
            maxResults,
            timeout = defaultTimeout,
        ) {
            const result = await executor.execute(
                script,
                tools.api,
                { query, maxResults },
                { timeout },
            );
            return {
                ok: result.success,
                result,
                ...(result.success
                    ? {}
                    : {
                          error:
                              result.error ??
                              result.message ??
                              "Generated explore program failed",
                      }),
                toolTrace: tools.trace,
                observations: tools.observations,
            };
        },
    };
}
