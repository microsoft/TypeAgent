#!/usr/bin/env node

// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { randomBytes } from "node:crypto";
import { loadMemoryServerConfig } from "./config.js";
import {
    HmacPacketContinuationCodec,
    WorkingMemoryPacketAssembler,
} from "./packet/index.js";
import { SqliteMemoryRepository } from "./repository/index.js";
import { startMemoryServer } from "./server.js";
import {
    MemoryGetService,
    MemoryQueryService,
    RecordTurnService,
} from "./services/index.js";

async function main(): Promise<void> {
    const config = loadMemoryServerConfig(process.argv.slice(2));
    const repository = SqliteMemoryRepository.open(config.databasePath);
    const recordTurn = new RecordTurnService(repository);
    const continuationCodec = new HmacPacketContinuationCodec(
        config.cursorSecret ?? randomBytes(32),
    );
    const query = new MemoryQueryService(
        repository,
        new WorkingMemoryPacketAssembler({ continuationCodec }),
        {
            ...(config.allowedScope === undefined
                ? {}
                : { allowedScope: config.allowedScope }),
        },
    );
    const get = new MemoryGetService(repository, {
        ...(config.allowedScope === undefined
            ? {}
            : { allowedScope: config.allowedScope }),
    });
    const server = await startMemoryServer({
        status: repository,
        recordTurn,
        query,
        get,
    });

    const close = async () => {
        await server.close();
        repository.close();
        process.exitCode = 0;
    };

    process.once("SIGINT", close);
    process.once("SIGTERM", close);
}

main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Failed to start agent-memory MCP server: ${message}`);
    process.exitCode = 1;
});
