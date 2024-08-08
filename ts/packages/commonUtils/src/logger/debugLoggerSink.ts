// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { LoggerSink, LogEvent } from "./logger.js";
import registerDebug from "debug";

class DebugLoggerSink implements LoggerSink {
    public logEvent(event: LogEvent) {
        const logger = registerDebug(`typeagent:logger:${event.eventName}`);
        logger(JSON.stringify(event.event));
    }
}

export function createDebugLoggerSink() {
    return new DebugLoggerSink();
}
