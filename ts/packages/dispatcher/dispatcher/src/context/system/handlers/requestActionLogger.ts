// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import fs from "fs";
import path from "path";
import { RequestAction } from "agent-cache";

/**
 * Logger for capturing request/action pairs for explanation system testing
 */
export class RequestActionLogger {
    private logFilePath: string | undefined;
    private isEnabled: boolean = false;

    constructor() {
        // Check if logging is enabled via environment variable
        const logDir = process.env.TYPEAGENT_REQUEST_ACTION_LOG_DIR;
        if (logDir) {
            this.isEnabled = true;
            // Create log directory if it doesn't exist
            if (!fs.existsSync(logDir)) {
                fs.mkdirSync(logDir, { recursive: true });
            }
            // Create log file with timestamp
            const timestamp = new Date()
                .toISOString()
                .replace(/[:.]/g, "-")
                .replace("T", "_")
                .split("Z")[0];
            this.logFilePath = path.join(
                logDir,
                `request_actions_${timestamp}.jsonl`,
            );
        }
    }

    /**
     * Log a request/action pair to file
     * Format: One JSON object per line (JSONL format)
     */
    public log(requestAction: RequestAction): void {
        if (!this.isEnabled || !this.logFilePath) {
            return;
        }

        try {
            const logEntry = {
                timestamp: new Date().toISOString(),
                request: requestAction.request,
                actions: requestAction.actions.map((ea) => ({
                    schemaName: ea.action.schemaName,
                    actionName: ea.action.actionName,
                    parameters: ea.action.parameters,
                })),
                // Include history if present for context
                hasHistory: requestAction.history !== undefined,
            };

            // Append to file as JSONL (one JSON object per line)
            fs.appendFileSync(
                this.logFilePath,
                JSON.stringify(logEntry) + "\n",
                "utf8",
            );
        } catch (error) {
            console.error(
                `[RequestActionLogger] Failed to log request/action:`,
                error,
            );
        }
    }

    public isLoggingEnabled(): boolean {
        return this.isEnabled;
    }

    public getLogFilePath(): string | undefined {
        return this.logFilePath;
    }
}

// Singleton instance
let loggerInstance: RequestActionLogger | undefined;

export function getRequestActionLogger(): RequestActionLogger {
    if (!loggerInstance) {
        loggerInstance = new RequestActionLogger();
    }
    return loggerInstance;
}
