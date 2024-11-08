// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    LoggerSink,
    MultiSinkLogger,
    createMongoDBLoggerSink,
    createDebugLoggerSink        
} from "common-utils";

import registerDebug from "debug";
import { PromptSection } from "typechat";

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
            PromptLogger.instance.sinkLogger = PromptLogger.instance.createSinkLogger();
        }

        return PromptLogger.instance;
    };

    logModelRequest(promptContent : PromptSection[]) {
        this.sinkLogger?.logEvent("modelRequest", {
            prompt: promptContent
        });       
    }

    createSinkLogger() : MultiSinkLogger {
        const debugLoggerSink = createDebugLoggerSink();
        let dbLoggerSink: LoggerSink | undefined;
    
        try {
            dbLoggerSink = createMongoDBLoggerSink(
                "telemetrydb",
                "modelPromptLogs"
            );
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