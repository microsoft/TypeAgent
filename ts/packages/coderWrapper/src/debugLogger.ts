// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as fs from "fs";
import * as path from "path";
import * as os from "os";

/**
 * Debug logger that writes to a file
 */
export class DebugLogger {
    private logFilePath: string = "";
    private logStream: fs.WriteStream | null = null;
    private enabled: boolean;

    constructor(enabled: boolean = false) {
        this.enabled = enabled;

        if (enabled) {
            // Use ~/.tmp instead of system temp directory
            const logDir = path.join(
                os.homedir(),
                ".tmp",
                "typeagent-coder-wrapper",
            );
            if (!fs.existsSync(logDir)) {
                fs.mkdirSync(logDir, { recursive: true });
            }
            this.logFilePath = path.join(
                logDir,
                `coder-wrapper-${Date.now()}.log`,
            );
            this.logStream = fs.createWriteStream(this.logFilePath, {
                flags: "a",
            });
            this.log(`Debug log started at: ${new Date().toISOString()}`);
            this.log(`Log file: ${this.logFilePath}`);
            console.log(`[CoderWrapper] Debug log: ${this.logFilePath}`);
        }
    }

    private formatMessage(message: string): string {
        const timestamp = new Date().toISOString();
        return `[${timestamp}] ${message}`;
    }

    log(message: string): void {
        if (!this.enabled || !this.logStream) {
            return;
        }
        this.logStream.write(this.formatMessage(message) + "\n");
    }

    error(message: string, error?: any): void {
        if (!this.enabled || !this.logStream) {
            return;
        }
        const errorDetails = error
            ? ` - ${error instanceof Error ? error.message : String(error)}`
            : "";
        this.logStream.write(
            this.formatMessage(`ERROR: ${message}${errorDetails}`) + "\n",
        );
        if (error?.stack) {
            this.logStream.write(error.stack + "\n");
        }
    }

    getLogFilePath(): string {
        return this.logFilePath;
    }

    close(): void {
        if (this.logStream) {
            this.log(`Debug log ended at: ${new Date().toISOString()}`);
            this.logStream.end();
        }
    }
}
