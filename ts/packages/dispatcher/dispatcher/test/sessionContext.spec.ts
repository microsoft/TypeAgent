// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createSessionContext } from "../src/execute/sessionContext.js";
import { initializeCommandHandlerContext } from "../src/context/commandHandlerContext.js";

function makeContext(overrides: {
    instanceDir?: string | undefined;
    persistDir?: string | undefined;
    sessionDirPath?: string | undefined;
}) {
    const calls: { name: string; baseDir: string }[] = [];
    const storageProvider = {
        getStorage(name: string, baseDir: string) {
            calls.push({ name, baseDir });
            return {} as any;
        },
    };
    return {
        context: {
            session: {
                getSessionDirPath: () => overrides.sessionDirPath,
                getConfig: () => ({}),
            },
            storageProvider,
            persistDir: overrides.persistDir,
            instanceDir: overrides.instanceDir,
            commandLock: async (fn: any) => fn(),
            agents: {
                getTransientState: () => undefined,
                getSharedLocalHostPort: async () => undefined,
                setLocalHostPort: () => {},
            },
            clientIO: {
                notify: () => {},
                question: async () => 0,
            },
            translatorCache: { clear: () => {} },
            lastActionSchemaName: undefined,
            conversationManager: undefined,
        } as any,
        calls,
    };
}

describe("createSessionContext storage routing", () => {
    test("instanceStorage uses instanceDir when provided", () => {
        const { context, calls } = makeContext({
            instanceDir: "/global/instance",
            persistDir: "/session/persist",
        });
        createSessionContext("myAgent", {}, context, false);
        const instanceCall = calls.find((c) => c.name === "myAgent");
        expect(instanceCall?.baseDir).toBe("/global/instance");
    });

    test("instanceStorage falls back to persistDir when instanceDir is absent", () => {
        const { context, calls } = makeContext({
            instanceDir: undefined,
            persistDir: "/session/persist",
        });
        createSessionContext("myAgent", {}, context, false);
        const instanceCall = calls.find((c) => c.name === "myAgent");
        expect(instanceCall?.baseDir).toBe("/session/persist");
    });

    test("two sessions with the same instanceDir share instanceStorage base path", () => {
        const { context: ctx1, calls: calls1 } = makeContext({
            instanceDir: "/global/instance",
            persistDir: "/session/session-1",
        });
        const { context: ctx2, calls: calls2 } = makeContext({
            instanceDir: "/global/instance",
            persistDir: "/session/session-2",
        });
        createSessionContext("myAgent", {}, ctx1, false);
        createSessionContext("myAgent", {}, ctx2, false);
        expect(calls1.find((c) => c.name === "myAgent")?.baseDir).toBe(
            "/global/instance",
        );
        expect(calls2.find((c) => c.name === "myAgent")?.baseDir).toBe(
            "/global/instance",
        );
    });

    test("instanceStorage is undefined when neither instanceDir nor persistDir is set", () => {
        const { context } = makeContext({
            instanceDir: undefined,
            persistDir: undefined,
        });
        const sessionCtx = createSessionContext("myAgent", {}, context, false);
        expect(sessionCtx.instanceStorage).toBeUndefined();
    });
});

describe("beginAgentThread", () => {
    function makeContextWithClientIO() {
        const calls: any[] = [];
        const ctx = {
            session: {
                getSessionDirPath: () => undefined,
                getConfig: () => ({}),
            },
            storageProvider: { getStorage: () => ({}) as any },
            persistDir: undefined,
            instanceDir: undefined,
            commandLock: async (fn: any) => fn(),
            agents: {
                getTransientState: () => undefined,
                getSharedLocalHostPort: async () => undefined,
                setLocalHostPort: () => {},
            },
            clientIO: {
                setDisplay: (msg: any) => calls.push({ type: "set", msg }),
                appendDisplay: (msg: any, mode: string) =>
                    calls.push({ type: "append", msg, mode }),
                notify: () => {},
                question: async () => 0,
            },
            translatorCache: { clear: () => {} },
            lastActionSchemaName: undefined,
            conversationManager: undefined,
        } as any;
        return { ctx, calls };
    }

    test("setDisplay routes to clientIO with synthetic agent-* clientRequestId and kind", () => {
        const { ctx, calls } = makeContextWithClientIO();
        const sc = createSessionContext("myAgent", {}, ctx, false);
        const thread = sc.beginAgentThread("bubble");
        thread.setDisplay({ type: "text", content: "hi" });

        expect(calls).toHaveLength(1);
        expect(calls[0].type).toBe("set");
        const msg = calls[0].msg;
        expect(msg.source).toBe("myAgent");
        expect(msg.kind).toBe("bubble");
        expect(msg.message).toEqual({ type: "text", content: "hi" });
        expect(msg.requestId.requestId).toBe("");
        expect(msg.requestId.clientRequestId).toMatch(/^agent-myAgent-/);
    });

    test("appendDisplay carries mode through and reuses the same clientRequestId", () => {
        const { ctx, calls } = makeContextWithClientIO();
        const sc = createSessionContext("myAgent", {}, ctx, false);
        const thread = sc.beginAgentThread("toast");
        thread.appendDisplay({ type: "text", content: "a" }, "inline");
        thread.appendDisplay({ type: "text", content: "b" });

        expect(calls).toHaveLength(2);
        expect(calls[0].mode).toBe("inline");
        expect(calls[1].mode).toBe("block");
        expect(calls[0].msg.kind).toBe("toast");
        expect(calls[0].msg.requestId.clientRequestId).toBe(
            calls[1].msg.requestId.clientRequestId,
        );
    });

    test("two threads get distinct clientRequestIds", () => {
        const { ctx, calls } = makeContextWithClientIO();
        const sc = createSessionContext("myAgent", {}, ctx, false);
        sc.beginAgentThread("bubble").setDisplay({
            type: "text",
            content: "1",
        });
        sc.beginAgentThread("bubble").setDisplay({
            type: "text",
            content: "2",
        });
        expect(calls[0].msg.requestId.clientRequestId).not.toBe(
            calls[1].msg.requestId.clientRequestId,
        );
    });

    test("setDisplay/appendDisplay throw after complete()", () => {
        const { ctx } = makeContextWithClientIO();
        const sc = createSessionContext("myAgent", {}, ctx, false);
        const thread = sc.beginAgentThread("inline");
        thread.complete();
        expect(() =>
            thread.setDisplay({ type: "text", content: "x" }),
        ).toThrow(/completed/);
        expect(() =>
            thread.appendDisplay({ type: "text", content: "x" }),
        ).toThrow(/completed/);
    });
});

describe("initializeCommandHandlerContext option validation", () => {
    test("instanceDir without storageProvider throws", async () => {
        await expect(
            initializeCommandHandlerContext("test", {
                instanceDir: "/some/instance/dir",
            }),
        ).rejects.toThrow(
            "persistDir and instanceDir require storageProvider to be set in options.",
        );
    });

    test("persistDir without storageProvider throws", async () => {
        await expect(
            initializeCommandHandlerContext("test", {
                persistDir: "/some/persist/dir",
            }),
        ).rejects.toThrow(
            "persistDir and instanceDir require storageProvider to be set in options.",
        );
    });

    test("persistSession without persistDir throws", async () => {
        await expect(
            initializeCommandHandlerContext("test", {
                persistSession: true,
            }),
        ).rejects.toThrow(
            "Persist session requires persistDir to be set in options.",
        );
    });
});
