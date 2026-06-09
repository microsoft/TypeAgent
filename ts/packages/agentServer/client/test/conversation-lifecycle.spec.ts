// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { jest } from "@jest/globals";
import {
    createEphemeralConversation,
    deleteEphemeralConversation,
    findOrCreateNamedConversation,
    joinNamedOrFallback,
    switchConversationSafe,
    validateConversationNameUnique,
} from "../src/conversation/lifecycle.js";
import {
    fakeClientIO,
    makeInfo,
    makeStubConnection,
} from "./conversation-stubConnection.js";

describe("findOrCreateNamedConversation", () => {
    test("returns existing match without creating", async () => {
        const conn = makeStubConnection({
            list: [makeInfo("a", "Shell"), makeInfo("b", "Other")],
        });
        const result = await findOrCreateNamedConversation(conn, "shell");
        expect(result.conversationId).toBe("a");
        expect(
            conn.calls.filter((c) => c.method === "createConversation"),
        ).toHaveLength(0);
    });

    test("creates when none exists", async () => {
        const conn = makeStubConnection({ list: [] });
        const result = await findOrCreateNamedConversation(conn, "Shell");
        expect(result.name).toBe("Shell");
        expect(
            conn.calls.filter((c) => c.method === "createConversation"),
        ).toHaveLength(1);
    });

    test("recovers from create race by re-listing", async () => {
        // First create throws (peer beat us); the helper must re-list and
        // adopt the peer's entry instead of bubbling the create error.
        const winner = makeInfo("peer", "Shell");
        let listCalls = 0;
        const conn = makeStubConnection({
            list: [],
            intercept: {
                listConversations: () => {
                    listCalls++;
                    // First list (pre-create) sees nothing; second list
                    // (post-create-fail) sees the peer's entry.
                    return listCalls === 1 ? [] : [winner];
                },
                createConversation: () => {
                    throw new Error("name in use");
                },
            },
        });
        const result = await findOrCreateNamedConversation(conn, "Shell");
        expect(result.conversationId).toBe("peer");
    });

    test("propagates create error when retry also misses", async () => {
        const conn = makeStubConnection({
            list: [],
            intercept: {
                listConversations: () => [],
                createConversation: () => {
                    throw new Error("server down");
                },
            },
        });
        await expect(
            findOrCreateNamedConversation(conn, "Shell"),
        ).rejects.toThrow("server down");
    });
});

describe("joinNamedOrFallback", () => {
    test("joins saved id when available", async () => {
        const conn = makeStubConnection({
            list: [makeInfo("saved", "Saved")],
        });
        const result = await joinNamedOrFallback(conn, fakeClientIO, {
            savedConversationId: "saved",
            defaultName: "Shell",
        });
        expect(result.usedSavedId).toBe(true);
        expect(result.conversation.conversationId).toBe("saved");
    });

    test("falls back to default when saved id missing", async () => {
        const onUnavailable = jest.fn<(err: unknown) => void>();
        const conn = makeStubConnection({ list: [makeInfo("shell", "Shell")] });
        const result = await joinNamedOrFallback(conn, fakeClientIO, {
            savedConversationId: "gone-id",
            defaultName: "Shell",
            onSavedConversationUnavailable: onUnavailable,
        });
        expect(result.usedSavedId).toBe(false);
        expect(result.conversation.name).toBe("Shell");
        expect(onUnavailable).toHaveBeenCalledTimes(1);
    });

    test("creates default when neither exists", async () => {
        const conn = makeStubConnection({ list: [] });
        const result = await joinNamedOrFallback(conn, fakeClientIO, {
            defaultName: "Shell",
        });
        expect(result.usedSavedId).toBe(false);
        expect(result.conversation.name).toBe("Shell");
        expect(
            conn.calls.filter((c) => c.method === "createConversation"),
        ).toHaveLength(1);
    });

    test("recovers when list saw default but join races a delete", async () => {
        // listConversations returned the entry; join throws because peer
        // deleted it between the two calls. Helper must create-fresh +
        // join again.
        const conn = makeStubConnection({
            list: [makeInfo("shell", "Shell")],
            intercept: {
                joinConversation: (_io, options, callIndex) => {
                    if (
                        callIndex === 0 &&
                        options?.conversationId === "shell"
                    ) {
                        throw new Error("Conversation not found: shell");
                    }
                    return undefined;
                },
                createConversation: () => makeInfo("fresh-shell", "Shell"),
            },
        });
        const result = await joinNamedOrFallback(conn, fakeClientIO, {
            defaultName: "Shell",
        });
        expect(result.usedSavedId).toBe(false);
        expect(result.conversation.conversationId).toBe("fresh-shell");
    });
});

describe("switchConversationSafe", () => {
    test("no-ops when target equals current", async () => {
        const conn = makeStubConnection({ list: [makeInfo("a", "A")] });
        const result = await switchConversationSafe(
            conn,
            fakeClientIO,
            "a",
            "a",
        );
        expect(result.kind).toBe("already-on");
        expect(
            conn.calls.filter((c) => c.method === "joinConversation"),
        ).toHaveLength(0);
    });

    test("joins new, fires hooks, leaves old", async () => {
        const conn = makeStubConnection({
            list: [makeInfo("a", "A"), makeInfo("b", "B")],
        });
        const onJoined = jest.fn<(c: any) => void>();
        const onPersist = jest.fn<(id: string) => void>();
        const onLeftOld = jest.fn<(id: string, err: unknown) => void>();
        const result = await switchConversationSafe(
            conn,
            fakeClientIO,
            "a",
            "b",
            { onJoined, onPersist, onLeftOld },
        );
        expect(result.kind).toBe("switched");
        expect(onJoined).toHaveBeenCalledTimes(1);
        expect(onPersist).toHaveBeenCalledWith("b");
        expect(onLeftOld).toHaveBeenCalledWith("a", undefined);
        // join-before-leave: join first, then leave
        const order = conn.calls
            .filter(
                (c) =>
                    c.method === "joinConversation" ||
                    c.method === "leaveConversation",
            )
            .map((c) => c.method);
        expect(order).toEqual(["joinConversation", "leaveConversation"]);
    });

    test("does not leave old when join fails", async () => {
        const conn = makeStubConnection({
            list: [makeInfo("a", "A")],
            intercept: {
                joinConversation: () => {
                    throw new Error("permission denied");
                },
            },
        });
        const result = await switchConversationSafe(
            conn,
            fakeClientIO,
            "a",
            "b",
        );
        expect(result.kind).toBe("join-failed");
        if (result.kind === "join-failed") {
            expect(result.targetConversationId).toBe("b");
        }
        expect(
            conn.calls.filter((c) => c.method === "leaveConversation"),
        ).toHaveLength(0);
    });

    test("does not roll back switch when onPersist throws", async () => {
        const conn = makeStubConnection({
            list: [makeInfo("a", "A"), makeInfo("b", "B")],
        });
        const onPersist = jest.fn<(id: string) => void>(() => {
            throw new Error("disk full");
        });
        const result = await switchConversationSafe(
            conn,
            fakeClientIO,
            "a",
            "b",
            { onPersist },
        );
        expect(result.kind).toBe("switched");
        expect(
            conn.calls.filter((c) => c.method === "leaveConversation"),
        ).toHaveLength(1);
    });

    test("invokes onLeftOld with error when leave fails (best-effort)", async () => {
        const conn = makeStubConnection({
            list: [makeInfo("a", "A"), makeInfo("b", "B")],
            intercept: {
                leaveConversation: () => {
                    throw new Error("already gone");
                },
            },
        });
        const onLeftOld = jest.fn<(id: string, err: unknown) => void>();
        const result = await switchConversationSafe(
            conn,
            fakeClientIO,
            "a",
            "b",
            { onLeftOld },
        );
        expect(result.kind).toBe("switched");
        expect(onLeftOld).toHaveBeenCalledTimes(1);
        const [, errArg] = onLeftOld.mock.calls[0];
        expect((errArg as Error).message).toBe("already gone");
    });
});

describe("ephemeral conversation helpers", () => {
    test("creates a uniquely-named conversation and joins it", async () => {
        const conn = makeStubConnection({ list: [] });
        const { conversation, ephemeralConversationId, name } =
            await createEphemeralConversation(conn, fakeClientIO, "cli");
        expect(name.startsWith("cli-")).toBe(true);
        expect(name.length).toBeGreaterThan("cli-".length);
        expect(conversation.conversationId).toBe(ephemeralConversationId);
    });

    test("delete swallows errors (best-effort)", async () => {
        const conn = makeStubConnection({
            list: [],
            intercept: {
                deleteConversation: () => {
                    throw new Error("already gone");
                },
            },
        });
        await expect(
            deleteEphemeralConversation(conn, "nonexistent"),
        ).resolves.toBeUndefined();
    });
});

describe("validateConversationNameUnique", () => {
    test("returns undefined when name is free", async () => {
        const conn = makeStubConnection({
            list: [makeInfo("a", "Alpha"), makeInfo("b", "Beta")],
        });
        expect(
            await validateConversationNameUnique(conn, "Gamma"),
        ).toBeUndefined();
    });
    test("returns colliding entry case-insensitively", async () => {
        const conn = makeStubConnection({
            list: [makeInfo("a", "Alpha")],
        });
        const collision = await validateConversationNameUnique(conn, "alpha");
        expect(collision?.conversationId).toBe("a");
    });
    test("excludes a specified id (used by rename-self)", async () => {
        const conn = makeStubConnection({
            list: [makeInfo("a", "Alpha")],
        });
        expect(
            await validateConversationNameUnique(conn, "Alpha", "a"),
        ).toBeUndefined();
    });
});
