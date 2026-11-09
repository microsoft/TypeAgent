// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createHash } from "node:crypto";
import * as fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { AgentSessionImportReceipt } from "../src/agentSessionTypes.js";

const runtimeJest = import.meta.jest;
const jest = runtimeJest as typeof runtimeJest & {
    unstable_mockModule(
        name: string,
        factory: () => Record<string, unknown>,
    ): void;
};

let stamps = 0;
let entered!: () => void;
let resume!: () => void;
let gate: Promise<void> | undefined;
jest.unstable_mockModule("node:fs/promises", () => ({
    ...fs,
    lstat: async (...args: Parameters<typeof fs.lstat>) => {
        if (String(args[0]).endsWith("session.json")) {
            stamps++;
            const pending = gate;
            gate = undefined;
            if (pending) {
                entered();
                await pending;
            }
        }
        return fs.lstat(...args);
    },
}));
const { AgentSessionStore } = await import("../src/agentSessionStore.js");

test.each([false, true])(
    "receipt reads retain committed metadata during publication (warm=%s)",
    async (warm) => {
        stamps = 0;
        const root = await fs.mkdtemp(
            path.join(os.tmpdir(), "agent-session-stamp-"),
        );
        const request = { corpusId: "corpus", sessionId: "session" };
        const receipt: AgentSessionImportReceipt = {
            ...request,
            schemaVersion: 1,
            importType: "agent-session-jsonl",
            state: "running",
            cursor: 0,
            final: false,
            sourceCount: 0,
            memoryCount: 0,
            duplicates: 0,
            losses: [],
            updatedAt: "2026-10-20T00:00:00Z",
        };
        const id = createHash("sha256")
            .update(JSON.stringify(request.sessionId))
            .digest("hex");
        const directory = path.join(
            root,
            request.corpusId,
            "agent-sessions",
            id,
        );
        await fs.mkdir(directory, { recursive: true });
        await fs.writeFile(
            path.join(directory, "session.json"),
            JSON.stringify({
                schemaVersion: 1,
                scope: {},
                receipt,
                seen: {},
                requests: [],
                sources: [],
                memories: [],
            }),
        );
        const store = new AgentSessionStore(
            root,
            {
                ingestDocument: async () => {
                    throw new Error("Recovery must not ingest evidence");
                },
                getJob: async () => undefined,
                search: async () => {
                    throw new Error("Recovery must not search");
                },
                withEligible: async () => {
                    throw new Error(
                        "Receipt reads must not acquire the checkpoint write lane",
                    );
                },
                withEligibleRead: async (_corpusId, _sources, operation) =>
                    operation(),
            },
            () => {
                throw new Error("Recovery must not invoke a model");
            },
        );
        const started = new Promise<void>((resolve) => {
            entered = resolve;
        });
        if (warm) {
            expect(await store.get(request)).toMatchObject({
                state: "running",
            });
            stamps = 0;
        }
        gate = new Promise<void>((resolve) => {
            resume = resolve;
        });
        const recovery = store.recover(request.corpusId);
        let read: ReturnType<typeof store.get> | undefined;
        try {
            await started;
            read = store.get(request);
            await new Promise<void>((resolve) => setImmediate(resolve));
            expect(stamps).toBe(1);
            if (warm) {
                let timer: ReturnType<typeof setTimeout> | undefined;
                try {
                    expect(
                        await Promise.race([
                            read,
                            new Promise<never>((_, reject) => {
                                timer = setTimeout(
                                    () =>
                                        reject(
                                            new Error(
                                                "Receipt read blocked on publication",
                                            ),
                                        ),
                                    1000,
                                );
                            }),
                        ]),
                    ).toMatchObject({ state: "running", cursor: 0 });
                } finally {
                    clearTimeout(timer);
                }
            }
            resume();
            await recovery;
            expect(warm ? await store.get(request) : await read).toMatchObject({
                state: "failed",
                cursor: 0,
            });
            expect(stamps).toBe(2);
        } finally {
            resume();
            await Promise.allSettled([recovery, read]);
            await store.close();
            await fs.rm(root, { recursive: true, force: true });
        }
    },
);
