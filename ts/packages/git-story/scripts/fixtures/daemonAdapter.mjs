// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// TEST FIXTURE ONLY. This allow-list discards all real content. It is not a
// production privacy policy, extraction service, or application destination.
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import assert from "node:assert/strict";

const directory = path.dirname(fileURLToPath(import.meta.url));
export function createSessionWatcherDependencies() {
    return {
        privacyFilter(update) {
            if (update.sessionId === "coverage") {
                assert(!JSON.stringify(update).includes("OMITTED"));
                for (const event of update.events) {
                    if (event.id === "proof-answer") {
                        assert.equal(event.parentId, "proof-parent");
                        assert.equal(event.turnId, "proof-turn");
                        assert.deepEqual(event.attachments, [
                            { type: "file", path: "fixture-private-evidence" },
                        ]);
                        assert.deepEqual(event.citations, [
                            { url: "fixture-private-evidence" },
                        ]);
                    }
                    if (event.id === "proof-external") {
                        assert.equal(event.type, "tool-start");
                        assert.equal(event.requestId, "proof-request");
                        assert.equal(event.toolCallId, "proof-tool");
                    }
                    if (event.id === "proof-receipt") {
                        assert.equal(event.type, "session");
                        assert.equal(
                            event.eventType,
                            "external_tool.completed",
                        );
                        assert.deepEqual(event.details, {
                            requestId: "proof-request",
                        });
                        assert.equal(event.success, undefined);
                    }
                    if (event.id === "proof-result") {
                        assert.deepEqual(event.resultMcpMeta, {
                            source: "fixture-private-evidence",
                        });
                        assert.deepEqual(event.mcpMeta, {
                            source: "fixture-private-evidence",
                        });
                    }
                }
            }
            return {
                projectPath: "[fixture-project]",
                sessionId: update.sessionId,
                events: update.events.map((event) => ({
                    id: event.id,
                    ...(event.sourceEventId !== undefined
                        ? { sourceEventId: event.sourceEventId }
                        : {}),
                    type: "message",
                    role: "system",
                    text: "[redacted]",
                    ...(event.turnId === "proof-turn"
                        ? { turnId: "proof-turn" }
                        : {}),
                    ...(event.requestId === "proof-request"
                        ? { requestId: "proof-request" }
                        : {}),
                })),
                metadata: {
                    clientName: "fixture-approved",
                    models: [
                        ...(update.metadata.models.includes("history-model")
                            ? ["history-observed"]
                            : []),
                        ...(update.metadata.models.includes("proof-chosen")
                            ? ["chosen-observed"]
                            : []),
                        ...(update.metadata.models.includes("proof-fallback")
                            ? ["fallback-observed"]
                            : []),
                    ],
                },
            };
        },
        async approvedUpdateDestination(update) {
            const control = JSON.parse(
                await fs.readFile(path.join(directory, "control.json"), "utf8"),
            );
            await fs.appendFile(
                path.join(directory, "attempts.jsonl"),
                JSON.stringify(update) + "\n",
            );
            await delay(control.delayMs ?? 0);
            if (control.fail)
                throw new Error("fixture-private-dependency-error");
            const handle = await fs.open(
                path.join(directory, "sink.jsonl"),
                "a",
                0o600,
            );
            try {
                await handle.writeFile(JSON.stringify(update) + "\n");
                await handle.sync();
            } finally {
                await handle.close();
            }
        },
    };
}
