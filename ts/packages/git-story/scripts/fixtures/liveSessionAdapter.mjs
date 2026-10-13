// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Fixture-only structural allowlist, NOT a production privacy policy.
import fs from "node:fs/promises";
import path from "node:path";

const safeId = (value) =>
    typeof value === "string" && /^[A-Za-z0-9_.:-]{1,160}$/.test(value)
        ? value
        : undefined;
const marker = (event) =>
    event.type === "message" &&
    event.role === "user" &&
    typeof event.text === "string" &&
    /^LIVE-WATCHER-CHECK-[A-Za-z0-9_-]{1,80}$/.test(event.text.trim())
        ? event.text.trim()
        : undefined;

export function createSessionWatcherDependencies() {
    const log = path.join(process.env.GIT_STORY_LIVE_OUTPUT, "batches.jsonl");
    let batch = 0;
    return {
        privacyFilter(update) {
            return {
                projectPath: "[omitted]",
                sessionId: update.sessionId,
                metadata: {
                    clientName: "fixture-structural-only",
                    models: update.metadata.models.map(() => "[omitted]"),
                },
                events: update.events.map((event) => ({
                    id: safeId(event.id) ?? "[omitted]",
                    ...(safeId(event.sourceEventId)
                        ? { sourceEventId: safeId(event.sourceEventId) }
                        : {}),
                    type: "session",
                    eventType: "fixture.structural",
                    details: {
                        category: [
                            "message",
                            "tool-start",
                            "tool-result",
                            "session",
                        ].includes(event.type)
                            ? event.type
                            : "other",
                        ...(typeof event.timestamp === "string" &&
                        Number.isFinite(Date.parse(event.timestamp))
                            ? {
                                  timestamp: new Date(
                                      event.timestamp,
                                  ).toISOString(),
                              }
                            : {}),
                        ...(marker(event) && safeId(event.sourceEventId)
                            ? { marker: marker(event) }
                            : {}),
                    },
                })),
            };
        },
        async approvedUpdateDestination(update) {
            const receipt = {
                batch: ++batch,
                receivedAt: new Date().toISOString(),
                sessionId: update.sessionId,
                eventCount: update.events.length,
                metadataCounts: { models: update.metadata.models.length },
                events: update.events.map((event) => ({
                    id: event.id,
                    ...(event.sourceEventId
                        ? { nativeId: event.sourceEventId }
                        : {}),
                    ...event.details,
                })),
            };
            const handle = await fs.open(log, "a", 0o600);
            try {
                await handle.writeFile(JSON.stringify(receipt) + "\n");
                await handle.sync();
            } finally {
                await handle.close();
            }
        },
    };
}
