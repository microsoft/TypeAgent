// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    LoggerSink,
    MultiSinkLogger,
    CosmosContainerClientFactory,
    createDatabaseLoggerSink,
    createDebugLoggerSink,
} from "telemetry";
import { CosmosPartitionKeyBuilderFactory } from "./cosmosDBLoggerSink.js";

import registerDebug from "debug";

const debugPromptLogger = registerDebug("typeagent:telemetry:promptLogger");

export interface PromptLoggerOptions {
    dbName?: string;
    collectionName?: string;
    cosmosContainerFactory?: CosmosContainerClientFactory;
    cosmosPartitionKeyBuilderFactory?: CosmosPartitionKeyBuilderFactory;
}

/**
 * Logger for LLM prompts.
 */
export class PromptLogger {
    private sinkLogger: MultiSinkLogger | undefined;

    constructor(options?: PromptLoggerOptions) {
        this.sinkLogger = this.createSinkLogger(options);
    }

    logModelRequest = (requestContent: any) => {
        this.sinkLogger?.logEvent("modelRequest", { requestContent });
    };

    private createSinkLogger(
        options?: PromptLoggerOptions,
    ): MultiSinkLogger | undefined {
        const debugLoggerSink = createDebugLoggerSink();
        let dbLoggerSink: LoggerSink | undefined;

        try {
            dbLoggerSink = createDatabaseLoggerSink({
                dbName: options?.dbName ?? "telemetrydb",
                collectionName: options?.collectionName ?? "promptLogs",
                cosmosContainerFactory: options?.cosmosContainerFactory,
                cosmosPartitionKeyBuilderFactory:
                    options?.cosmosPartitionKeyBuilderFactory,
            });
        } catch (e) {
            debugPromptLogger(`DB logging disabled. ${e}`);
        }

        return new MultiSinkLogger(
            dbLoggerSink === undefined
                ? [debugLoggerSink]
                : [debugLoggerSink, dbLoggerSink],
        );
    }
}

export function createPromptLogger(
    options?: PromptLoggerOptions,
): PromptLogger {
    return new PromptLogger(options);
}
