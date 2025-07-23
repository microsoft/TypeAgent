// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { LoggerSink, LogEvent } from "./logger.js";
import { MongoClient } from "mongodb";
import registerDebug from "debug";

const debugMongo = registerDebug("typeagent:logger:mongodb");

const UPLOAD_DELAY = 1000;
const MAX_RETRY = 3;
class MongoDBLoggerSink implements LoggerSink {
    private pendingEvents: LogEvent[] = [];
    private timeout: NodeJS.Timeout | undefined;
    private disabled = false;
    constructor(
        private readonly dbUrl: string,
        private readonly dbName: string,
        private readonly collectionName: string,
        private readonly isEnabled?: () => boolean,
        private readonly onErrorDisable?: (error: string) => void,
    ) {}

    public logEvent(event: LogEvent) {
        if (this.dbUrl && !this.disabled && this.isEnabled?.() !== false) {
            this.pendingEvents.push(event);
            if (this.timeout === undefined) {
                this.timeout = setTimeout(() => this.upload(), UPLOAD_DELAY);
            }
        }
    }

    private async upload() {
        let attempt = 0;
        while (attempt < MAX_RETRY) {
            attempt++;
            try {
                await this.drain();
                break;
            } catch (e: any) {
                if (
                    typeof e.message === "string" &&
                    e.message.includes("Invalid key")
                ) {
                    // Disable
                    if (this.onErrorDisable) {
                        this.onErrorDisable(
                            `DB Logging disabled: ${e.toString()}`,
                        );
                    } else {
                        console.error(`DB Logging disabled: ${e.toString()}`);
                    }

                    this.disabled = true;
                    break;
                }

                // Retry
                debugMongo(`ERROR: ${e}`);
            }
        }
        // Clear the timeout so it can schedule after the next log event.
        this.timeout = undefined;
    }

    private async drain() {
        const client = await MongoClient.connect(this.dbUrl);
        try {
            const db = client.db(this.dbName);
            const collection = db.collection(this.collectionName);
            while (true) {
                const events = this.pendingEvents;
                if (events.length === 0) {
                    // done
                    return;
                }
                this.pendingEvents = [];

                try {
                    await collection.insertMany(events);
                    debugMongo(`${events.length} events uploaded`);
                } catch (e: any) {
                    if (this.pendingEvents.length !== 0) {
                        events.push(...this.pendingEvents);
                    }
                    this.pendingEvents = events;
                    throw e;
                }
            }
        } finally {
            await client.close();
        }
    }
}

export function createMongoDBLoggerSink(
    dbName: string,
    collectionName: string,
    isEnabled?: () => boolean,
    onErrorDisable?: (error: string) => void,
): LoggerSink | undefined {
    const dbUrl = process.env["MONGODB_CONNECTION_STRING"] ?? null;
    if (dbUrl === null || dbUrl === "") {
        throw new Error(
            "MONGODB_CONNECTION_STRING environment variable not set",
        );
    }
    return new MongoDBLoggerSink(
        dbUrl,
        dbName,
        collectionName,
        isEnabled,
        onErrorDisable,
    );
}
