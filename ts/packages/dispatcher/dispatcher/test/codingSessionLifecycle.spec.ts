// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    getCodingSessionMaxAgeMs,
    isStaleTypeAgentCodingSession,
    pruneStaleCodingSessions,
} from "../src/reasoning/codingSessionLifecycle.js";

describe("coding session lifecycle", () => {
    test("uses a bounded persisted-session age and accepts an override", () => {
        expect(getCodingSessionMaxAgeMs({})).toBe(7 * 24 * 60 * 60 * 1000);
        expect(
            getCodingSessionMaxAgeMs({
                TYPEAGENT_CODING_SESSION_MAX_AGE_DAYS: "2",
            }),
        ).toBe(2 * 24 * 60 * 60 * 1000);
    });

    test("only considers old TypeAgent coding sessions stale", () => {
        const now = Date.now();
        const maxAge = 1000;
        expect(
            isStaleTypeAgentCodingSession(
                {
                    sessionId: "typeagent-code-conversation-1",
                    modifiedTime: new Date(now - 2000),
                },
                now,
                maxAge,
            ),
        ).toBe(true);
        expect(
            isStaleTypeAgentCodingSession(
                {
                    sessionId: "user-session",
                    modifiedTime: new Date(now - 2000),
                },
                now,
                maxAge,
            ),
        ).toBe(false);
    });

    test("deletes only stale TypeAgent coding sessions", async () => {
        const now = Date.now();
        const deleted: string[] = [];
        const count = await pruneStaleCodingSessions(
            {
                listSessions: async () =>
                    [
                        {
                            sessionId: "typeagent-code-old",
                            modifiedTime: new Date(now - 2000),
                        },
                        {
                            sessionId: "typeagent-code-current",
                            modifiedTime: new Date(now),
                        },
                        {
                            sessionId: "other-old",
                            modifiedTime: new Date(now - 2000),
                        },
                    ] as any,
                deleteSession: async (sessionId: string) => {
                    deleted.push(sessionId);
                },
            },
            1000,
            now,
        );
        expect(count).toBe(1);
        expect(deleted).toEqual(["typeagent-code-old"]);
    });
});
