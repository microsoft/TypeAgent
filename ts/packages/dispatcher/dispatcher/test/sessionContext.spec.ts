// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createSessionContext } from "../src/execute/sessionContext.js";

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
                popupQuestion: async () => 0,
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
});
