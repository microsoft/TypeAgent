// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    LoggerSink,
    MultiSinkLogger,
    createMongoDBLoggerSink,
    createDebugLoggerSink,
} from "telemetry";

import registerDebug from "debug";

const debugPromptLogger = registerDebug("typeagent:promptLogger");

/**
 *  Logger for LLM prompts.
 */
export class PromptLogger {
    private static instance: PromptLogger;
    private sinkLogger: MultiSinkLogger | undefined;

    public static getInstance = (): PromptLogger => {
        if (!PromptLogger.instance) {
            PromptLogger.instance = new PromptLogger();
            PromptLogger.instance.sinkLogger =
                PromptLogger.instance.createSinkLogger();
        }

        return PromptLogger.instance;
    };

    logModelRequest(requestContent: any) {
        this.sinkLogger?.logEvent("modelRequest", { requestContent });
    }

    createSinkLogger(): MultiSinkLogger {
        const debugLoggerSink = createDebugLoggerSink();
        let dbLoggerSink: LoggerSink | undefined;

        try {
            dbLoggerSink = createMongoDBLoggerSink("telemetrydb", "promptLogs");
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
