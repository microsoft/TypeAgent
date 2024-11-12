// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { LoggerSink, LogEvent } from "./logger.js";
import { MongoClient } from "mongodb";
import registerDebug from "debug";

const debugMongo = registerDebug("typeagent:logger:mongodb");

const UPLOAD_DELAY = 1000;
class MongoDBLoggerSink implements LoggerSink {
    private pendingEvents: LogEvent[] = [];
    private timeout: NodeJS.Timeout | undefined;
    constructor(
        private readonly dbUrl: string,
        private readonly dbName: string,
        private readonly collectionName: string,
        private readonly isEnabled?: () => boolean,
    ) {}

    public logEvent(event: LogEvent) {
        if (this.isEnabled === undefined || this.isEnabled()) {
            this.pendingEvents.push(event);
        }

        this.scheduleUpload();
    }

    private scheduleUpload() {
        if (!this.timeout) {
            this.timeout = setTimeout(() => this.upload(), UPLOAD_DELAY);
        }
    }

    private async upload() {
        try {
            this.timeout = undefined;
            if (this.dbUrl) {
                const client = await MongoClient.connect(this.dbUrl);
                try {
                    const db = client.db(this.dbName);
                    const collection = db.collection(this.collectionName);
                    await collection.insertMany(this.pendingEvents);
                    debugMongo(`${this.pendingEvents.length} events uploaded`);
                    this.pendingEvents = [];
                } finally {
                    await client.close();
                }
            }
        } catch (e) {
            // TODO: ignore?
            debugMongo(`ERROR: ${e}`);
        }
    }
}

export function createMongoDBLoggerSink(
    dbName: string,
    collectionName: string,
    isEnabled?: () => boolean,
): LoggerSink | undefined {
    const dbUrl = process.env["MONGODB_CONNECTION_STRING"] ?? null;
    if (dbUrl === null || dbUrl === "") {
        throw new Error(
            "MONGODB_CONNECTION_STRING environment variable not set",
        );
    }
    return new MongoDBLoggerSink(dbUrl, dbName, collectionName, isEnabled);
}
