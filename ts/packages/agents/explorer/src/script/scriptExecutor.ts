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
    runtimeError: boolean;
    result?: unknown;
    error?: string;
    toolTrace: RepositoryToolTrace;
    observations: RepositoryObservation[];
    accept(): void;
    discard(): void;
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
            const execution = tools.startExecution();
            let finalized = false;
            const finalize = (discard: boolean): void => {
                if (finalized) {
                    return;
                }
                finalized = true;
                if (discard) {
                    execution.discard();
                }
                execution.stop();
            };
            try {
                const result = await executor.execute(
                    script,
                    execution.api,
                    { query, maxResults },
                    { timeout },
                );
                if (!result.success) {
                    finalize(true);
                }
                return {
                    ok: result.success,
                    runtimeError: result.runtimeError === true,
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
                    accept: () => finalize(false),
                    discard: () => finalize(true),
                };
            } catch (error) {
                finalize(true);
                throw error;
            }
        },
    };
}
