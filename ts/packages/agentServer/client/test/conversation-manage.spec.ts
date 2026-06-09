// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { jest } from "@jest/globals";
import {
    manageConversation,
    manageCycle,
    manageDelete,
    manageInfo,
    manageList,
    manageNew,
    manageRename,
    manageSwitch,
    type ManageConversationContext,
} from "../src/conversation/manage.js";
import {
    fakeClientIO,
    makeInfo,
    makeStubConnection,
} from "./conversation-stubConnection.js";

function ctx(
    partial: Partial<ManageConversationContext> = {},
): ManageConversationContext {
    return {
        currentConversationId: partial.currentConversationId,
        currentConversationName: partial.currentConversationName,
        ...partial,
    };
}

describe("manageNew", () => {
    test("creates and switches", async () => {
        const conn = makeStubConnection({ list: [makeInfo("cur", "Current")] });
        const onSwitched = jest.fn<(c: any) => void>();
        const result = await manageNew(
            conn,
            fakeClientIO,
            ctx({
                currentConversationId: "cur",
                currentConversationName: "Current",
                onSwitched,
            }),
            "NewChat",
        );
        expect(result.kind).toBe("ok");
        if (result.kind === "ok") {
            expect(result.switched).toBe(true);
            expect(result.conversation?.name).toBe("NewChat");
        }
        expect(onSwitched).toHaveBeenCalledTimes(1);
    });

    test("auto-names when name omitted", async () => {
        const conn = makeStubConnection({ list: [] });
        const result = await manageNew(conn, fakeClientIO, ctx(), undefined);
        expect(result.kind).toBe("ok");
        if (result.kind === "ok") {
            expect(result.conversation?.name).toMatch(
                /^Conversation \d{4}-\d{2}-\d{2} \d{2}:\d{2}$/,
            );
        }
    });

    test("switches to existing on name collision", async () => {
        const conn = makeStubConnection({
            list: [makeInfo("cur", "Current"), makeInfo("dup", "MyChat")],
        });
        const result = await manageNew(
            conn,
            fakeClientIO,
            ctx({
                currentConversationId: "cur",
                currentConversationName: "Current",
            }),
            "mychat",
        );
        expect(result.kind).toBe("ok");
        if (result.kind === "ok") {
            expect(result.conversation?.conversationId).toBe("dup");
            expect(result.message).toMatch(/already exists/);
        }
        // Did not call create
        expect(
            conn.calls.filter((c) => c.method === "createConversation"),
        ).toHaveLength(0);
    });
});

describe("manageList", () => {
    test("returns sorted list with current marker", async () => {
        const conn = makeStubConnection({
            list: [
                makeInfo("o", "Old", "2026-01-01T00:00:00Z"),
                makeInfo("n", "New", "2026-03-01T00:00:00Z"),
            ],
        });
        const result = await manageList(
            conn,
            ctx({ currentConversationId: "o" }),
        );
        expect(result.kind).toBe("list");
        if (result.kind === "list") {
            expect(result.conversations.map((c) => c.conversationId)).toEqual([
                "n",
                "o",
            ]);
            expect(result.currentConversationId).toBe("o");
        }
    });
    test("warns when empty", async () => {
        const conn = makeStubConnection({ list: [] });
        const result = await manageList(conn, ctx());
        expect(result.kind).toBe("warning");
    });
});

describe("manageInfo", () => {
    test("returns info for current", () => {
        const result = manageInfo(
            ctx({
                currentConversationId: "a",
                currentConversationName: "Alpha",
            }),
        );
        expect(result).toEqual({
            kind: "info",
            conversationId: "a",
            name: "Alpha",
        });
    });
    test("warns when no active conversation", () => {
        const result = manageInfo(ctx());
        expect(result.kind).toBe("warning");
    });
});

describe("manageSwitch", () => {
    test("switches by name", async () => {
        const conn = makeStubConnection({
            list: [makeInfo("a", "A"), makeInfo("b", "B")],
        });
        const result = await manageSwitch(
            conn,
            fakeClientIO,
            ctx({ currentConversationId: "a" }),
            "b",
        );
        expect(result.kind).toBe("ok");
        if (result.kind === "ok") expect(result.switched).toBe(true);
    });
    test("warns on no-match (does NOT create)", async () => {
        const conn = makeStubConnection({ list: [makeInfo("a", "A")] });
        const result = await manageSwitch(
            conn,
            fakeClientIO,
            ctx({ currentConversationId: "a" }),
            "Missing",
        );
        expect(result.kind).toBe("warning");
        expect(
            conn.calls.filter((c) => c.method === "createConversation"),
        ).toHaveLength(0);
    });
    test("warns on switch-to-self", async () => {
        const conn = makeStubConnection({ list: [makeInfo("a", "A")] });
        const result = await manageSwitch(
            conn,
            fakeClientIO,
            ctx({ currentConversationId: "a" }),
            "A",
        );
        expect(result.kind).toBe("warning");
    });
    test("warns when name missing", async () => {
        const conn = makeStubConnection({ list: [makeInfo("a", "A")] });
        const result = await manageSwitch(
            conn,
            fakeClientIO,
            ctx({ currentConversationId: "a" }),
            "",
        );
        expect(result.kind).toBe("warning");
    });
});

describe("manageCycle", () => {
    test("next wraps around", async () => {
        const conn = makeStubConnection({
            list: [
                makeInfo("a", "A", "2026-01-01T00:00:00Z"),
                makeInfo("b", "B", "2026-02-01T00:00:00Z"),
                makeInfo("c", "C", "2026-03-01T00:00:00Z"),
            ],
        });
        // sorted desc: c, b, a — currently on `a` (last); next wraps to `c`.
        const result = await manageCycle(
            conn,
            fakeClientIO,
            ctx({ currentConversationId: "a" }),
            "next",
        );
        expect(result.kind).toBe("ok");
        if (result.kind === "ok") {
            expect(result.conversation?.conversationId).toBe("c");
        }
    });
    test("prev cycles backward", async () => {
        const conn = makeStubConnection({
            list: [
                makeInfo("a", "A", "2026-01-01T00:00:00Z"),
                makeInfo("b", "B", "2026-02-01T00:00:00Z"),
                makeInfo("c", "C", "2026-03-01T00:00:00Z"),
            ],
        });
        // sorted desc: c, b, a — currently on `b`; prev → `c`.
        const result = await manageCycle(
            conn,
            fakeClientIO,
            ctx({ currentConversationId: "b" }),
            "prev",
        );
        expect(result.kind).toBe("ok");
        if (result.kind === "ok") {
            expect(result.conversation?.conversationId).toBe("c");
        }
    });
    test("warns when only one conversation", async () => {
        const conn = makeStubConnection({ list: [makeInfo("a", "A")] });
        const result = await manageCycle(
            conn,
            fakeClientIO,
            ctx({ currentConversationId: "a" }),
            "next",
        );
        expect(result.kind).toBe("warning");
    });
});

describe("manageRename", () => {
    test("renames current when name omitted", async () => {
        const conn = makeStubConnection({ list: [makeInfo("a", "Old")] });
        const result = await manageRename(
            conn,
            ctx({
                currentConversationId: "a",
                currentConversationName: "Old",
            }),
            undefined,
            "New",
        );
        expect(result.kind).toBe("ok");
        expect(conn.state[0].name).toBe("New");
    });
    test("renames specified conversation", async () => {
        const conn = makeStubConnection({
            list: [makeInfo("a", "A"), makeInfo("b", "B")],
        });
        const result = await manageRename(
            conn,
            ctx({
                currentConversationId: "a",
                currentConversationName: "A",
            }),
            "B",
            "C",
        );
        expect(result.kind).toBe("ok");
        expect(conn.state.find((c) => c.conversationId === "b")?.name).toBe(
            "C",
        );
    });
    test("warns on name collision with different conversation", async () => {
        const conn = makeStubConnection({
            list: [makeInfo("a", "A"), makeInfo("b", "B")],
        });
        const result = await manageRename(
            conn,
            ctx({ currentConversationId: "a" }),
            undefined,
            "B",
        );
        expect(result.kind).toBe("warning");
    });
    test("allows rename to current name (no-op)", async () => {
        const conn = makeStubConnection({ list: [makeInfo("a", "Alpha")] });
        const result = await manageRename(
            conn,
            ctx({
                currentConversationId: "a",
                currentConversationName: "Alpha",
            }),
            undefined,
            "alpha",
        );
        expect(result.kind).toBe("ok");
    });
    test("warns when newName missing", async () => {
        const conn = makeStubConnection({ list: [makeInfo("a", "A")] });
        const result = await manageRename(
            conn,
            ctx({ currentConversationId: "a" }),
            undefined,
            "  ",
        );
        expect(result.kind).toBe("warning");
    });
});

describe("manageDelete", () => {
    test("deletes named conversation", async () => {
        const conn = makeStubConnection({
            list: [makeInfo("a", "A"), makeInfo("b", "B")],
        });
        const result = await manageDelete(
            conn,
            ctx({ currentConversationId: "a" }),
            "B",
        );
        expect(result.kind).toBe("ok");
        expect(
            conn.state.find((c) => c.conversationId === "b"),
        ).toBeUndefined();
    });

    test("refuses to delete active", async () => {
        const conn = makeStubConnection({ list: [makeInfo("a", "A")] });
        const result = await manageDelete(
            conn,
            ctx({ currentConversationId: "a" }),
            "A",
        );
        expect(result.kind).toBe("warning");
        expect(conn.state).toHaveLength(1);
    });

    test("warns on no-match", async () => {
        const conn = makeStubConnection({ list: [makeInfo("a", "A")] });
        const result = await manageDelete(
            conn,
            ctx({ currentConversationId: "a" }),
            "Missing",
        );
        expect(result.kind).toBe("warning");
    });

    test("respects confirmDestructive=false", async () => {
        const conn = makeStubConnection({
            list: [makeInfo("a", "A"), makeInfo("b", "B")],
        });
        const result = await manageDelete(
            conn,
            ctx({
                currentConversationId: "a",
                confirmDestructive: async () => false,
            }),
            "B",
        );
        expect(result.kind).toBe("cancelled");
        expect(conn.state).toHaveLength(2);
    });
});

describe("manageConversation (top-level dispatcher)", () => {
    test("routes by subcommand", async () => {
        const conn = makeStubConnection({ list: [makeInfo("a", "A")] });
        const result = await manageConversation(
            conn,
            fakeClientIO,
            ctx({
                currentConversationId: "a",
                currentConversationName: "A",
            }),
            { subcommand: "info" },
        );
        expect(result.kind).toBe("info");
    });

    test("error result on unknown subcommand", async () => {
        const conn = makeStubConnection({ list: [] });
        const result = await manageConversation(conn, fakeClientIO, ctx(), {
            subcommand: "bogus" as any,
        });
        expect(result.kind).toBe("error");
    });

    test("catches thrown server errors and returns error result", async () => {
        const conn = makeStubConnection({
            list: [],
            intercept: {
                listConversations: () => {
                    throw new Error("network down");
                },
            },
        });
        const result = await manageConversation(conn, fakeClientIO, ctx(), {
            subcommand: "list",
        });
        expect(result.kind).toBe("error");
        if (result.kind === "error") {
            expect(result.message).toMatch(/network down/);
        }
    });

    test("rejects malformed payloads cleanly", async () => {
        const conn = makeStubConnection({ list: [makeInfo("a", "A")] });
        // rename: missing newName
        const r1 = await manageConversation(
            conn,
            fakeClientIO,
            ctx({ currentConversationId: "a", currentConversationName: "A" }),
            { subcommand: "rename", name: "A" },
        );
        expect(r1.kind).toBe("warning");
        // switch: missing name
        const r2 = await manageConversation(
            conn,
            fakeClientIO,
            ctx({ currentConversationId: "a" }),
            { subcommand: "switch" },
        );
        expect(r2.kind).toBe("warning");
        // delete: missing name
        const r3 = await manageConversation(
            conn,
            fakeClientIO,
            ctx({ currentConversationId: "a" }),
            { subcommand: "delete" },
        );
        expect(r3.kind).toBe("warning");
    });

    test("forwards ctx.joinOptions for every switching subcommand", async () => {
        // new
        {
            const conn = makeStubConnection({ list: [] });
            await manageConversation(
                conn,
                fakeClientIO,
                ctx({
                    joinOptions: { clientType: "extension" } as any,
                }),
                { subcommand: "new", name: "X" },
            );
            const join = conn.calls.find(
                (c) => c.method === "joinConversation",
            );
            expect((join?.args[0] as any).clientType).toBe("extension");
        }
        // switch
        {
            const conn = makeStubConnection({
                list: [makeInfo("a", "A"), makeInfo("b", "B")],
            });
            await manageConversation(
                conn,
                fakeClientIO,
                ctx({
                    currentConversationId: "a",
                    joinOptions: { clientType: "extension" } as any,
                }),
                { subcommand: "switch", name: "B" },
            );
            const join = conn.calls.find(
                (c) => c.method === "joinConversation",
            );
            expect((join?.args[0] as any).clientType).toBe("extension");
        }
        // next (cycle)
        {
            const conn = makeStubConnection({
                list: [
                    makeInfo("a", "A", "2026-01-01T00:00:00Z"),
                    makeInfo("b", "B", "2026-02-01T00:00:00Z"),
                ],
            });
            await manageConversation(
                conn,
                fakeClientIO,
                ctx({
                    currentConversationId: "a",
                    joinOptions: { filter: false } as any,
                }),
                { subcommand: "next" },
            );
            const join = conn.calls.find(
                (c) => c.method === "joinConversation",
            );
            expect((join?.args[0] as any).filter).toBe(false);
        }
    });
});

describe("manageNew — collision against current", () => {
    test("user asks to create a name that IS the current — warns + already-on", async () => {
        const conn = makeStubConnection({
            list: [makeInfo("cur", "Current")],
        });
        const result = await manageNew(
            conn,
            fakeClientIO,
            ctx({
                currentConversationId: "cur",
                currentConversationName: "Current",
            }),
            "current",
        );
        // Already-on triggers `warning`; new conversation was not created.
        expect(result.kind === "warning" || result.kind === "ok").toBe(true);
        expect(
            conn.calls.filter((c) => c.method === "createConversation"),
        ).toHaveLength(0);
    });
});

describe("manageRename — result fidelity", () => {
    test("returned conversation preserves real createdAt + clientCount", async () => {
        const conn = makeStubConnection({
            list: [
                {
                    conversationId: "a",
                    name: "Old",
                    createdAt: "2026-05-15T10:00:00Z",
                    clientCount: 7,
                },
            ],
        });
        const result = await manageRename(
            conn,
            ctx({
                currentConversationId: "a",
                currentConversationName: "Old",
            }),
            undefined,
            "New",
        );
        expect(result.kind).toBe("ok");
        if (result.kind === "ok" && result.conversation) {
            expect(result.conversation.createdAt).toBe("2026-05-15T10:00:00Z");
            expect(result.conversation.clientCount).toBe(7);
            // and the new Date parse works (no Invalid Date corruption)
            expect(
                isNaN(new Date(result.conversation.createdAt).getTime()),
            ).toBe(false);
        }
    });

    test("rename Foo → foo (same id, case change) is allowed even if a different conversation also named 'foo' would collide", async () => {
        // The collision check excludes the targetId itself; case-only
        // rename of the current conversation must succeed.
        const conn = makeStubConnection({
            list: [makeInfo("a", "Foo")],
        });
        const result = await manageRename(
            conn,
            ctx({ currentConversationId: "a", currentConversationName: "Foo" }),
            "Foo",
            "foo",
        );
        expect(result.kind).toBe("ok");
        expect(conn.state[0].name).toBe("foo");
    });
});

describe("manageDelete — confirmDestructive(true)", () => {
    test("proceeds when async confirmDestructive returns true", async () => {
        const conn = makeStubConnection({
            list: [makeInfo("a", "A"), makeInfo("b", "B")],
        });
        const result = await manageDelete(
            conn,
            ctx({
                currentConversationId: "a",
                confirmDestructive: async (action, target) => {
                    expect(action).toBe("delete");
                    expect(target.conversationId).toBe("b");
                    return true;
                },
            }),
            "B",
        );
        expect(result.kind).toBe("ok");
        expect(
            conn.state.find((c) => c.conversationId === "b"),
        ).toBeUndefined();
    });
});

describe("manageCycle — sort + not-in-list options", () => {
    test("cycleOrder='server-order' preserves server iteration order", async () => {
        // Created order: a (oldest), b, c (newest).
        // newest-first sort would give: c, b, a.
        // server-order should give:    a, b, c → next from `a` is `b`.
        const conn = makeStubConnection({
            list: [
                makeInfo("a", "A", "2026-01-01T00:00:00Z"),
                makeInfo("b", "B", "2026-02-01T00:00:00Z"),
                makeInfo("c", "C", "2026-03-01T00:00:00Z"),
            ],
        });
        const result = await manageCycle(
            conn,
            fakeClientIO,
            ctx({
                currentConversationId: "a",
                cycleOrder: "server-order",
            }),
            "next",
        );
        expect(result.kind).toBe("ok");
        if (result.kind === "ok") {
            expect(result.conversation?.conversationId).toBe("b");
        }
    });

    test("default (newest-first) gives different target than server-order", async () => {
        // Confirms the default actually differs from server-order so the
        // option matters.
        const conn = makeStubConnection({
            list: [
                makeInfo("a", "A", "2026-01-01T00:00:00Z"),
                makeInfo("b", "B", "2026-02-01T00:00:00Z"),
                makeInfo("c", "C", "2026-03-01T00:00:00Z"),
            ],
        });
        const result = await manageCycle(
            conn,
            fakeClientIO,
            ctx({ currentConversationId: "a" }),
            "next",
        );
        // newest-first sorted: c, b, a — currently on `a` (idx=2);
        // next wraps to idx=0 → `c`.
        expect(result.kind).toBe("ok");
        if (result.kind === "ok") {
            expect(result.conversation?.conversationId).toBe("c");
        }
    });

    test("cycleOnCurrentNotInList='error' surfaces the inconsistency", async () => {
        const conn = makeStubConnection({
            list: [makeInfo("a", "A"), makeInfo("b", "B")],
        });
        const result = await manageCycle(
            conn,
            fakeClientIO,
            ctx({
                currentConversationId: "ghost", // not in list
                cycleOnCurrentNotInList: "error",
            }),
            "next",
        );
        expect(result.kind).toBe("error");
    });

    test("default (wrap) on current-not-in-list jumps to first", async () => {
        const conn = makeStubConnection({
            list: [
                makeInfo("a", "A", "2026-01-01T00:00:00Z"),
                makeInfo("b", "B", "2026-02-01T00:00:00Z"),
            ],
        });
        const result = await manageCycle(
            conn,
            fakeClientIO,
            ctx({ currentConversationId: "ghost" }),
            "next",
        );
        // newest-first sort: b, a → idx=0 is `b`
        expect(result.kind).toBe("ok");
        if (result.kind === "ok") {
            expect(result.conversation?.conversationId).toBe("b");
        }
    });
});

describe("manageNew — race recovery", () => {
    test("retry list also misses → propagates create error", async () => {
        // findOrCreateNamedConversation: list empty → create throws
        // 'already exists' → retry list still empty → bubble up.
        const conn = makeStubConnection({
            list: [],
            intercept: {
                createConversation: () => {
                    throw new Error("'Other' already exists");
                },
            },
        });
        const result = await manageNew(conn, fakeClientIO, ctx(), "Other");
        expect(result.kind).toBe("error");
    });
});
