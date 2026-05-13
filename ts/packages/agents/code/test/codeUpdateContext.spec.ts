// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Integration-style tests for the code agent's shared-server lifecycle
 * and per-session port registration. These tests actually bind a
 * WebSocket server on a random free port (port=0) per the design — they
 * exercise the real `CodeAgentWebSocketServer.start` + `close` paths
 * plus the per-session `registerPort` accounting end-to-end.
 *
 * Coverage matrix (per the PR 2 plan's test list):
 *   - enable A: shared server bound, A's registerPort called.
 *   - enable A + B: both sessions register, lookup returns same port.
 *   - A disables: A's registration released; server still up; B's
 *     registration intact.
 *   - both disable: server closed, no live registrations.
 *   - non-owner disable: shared server stays up under the other session.
 *   - skipping disable (backstop simulation): manually release A's
 *     registration; B still works.
 *
 * The shared server is module-scoped state, so tests run serially via
 * Jest's default sequential mode for a single suite.
 */

import { instantiate, getSharedCodePort } from "../src/codeActionHandler.js";
import type { SessionContext } from "@typeagent/agent-sdk";

// Minimal stub of SessionContext — only the surface the code agent uses
// during updateAgentContext. registerPort records every call so we can
// assert per-session accounting; the returned handle's release is real
// (no-op default; tests override when they want to inspect release).
type RegisterCall = { role: string; port: number };
type StubContext = {
    sessionContext: SessionContext<any>;
    registerCalls: RegisterCall[];
    releaseSpy: () => void;
    releaseCount: number;
};

function makeStubContext(agentContext: any): StubContext {
    const registerCalls: RegisterCall[] = [];
    let releaseCount = 0;
    const releaseSpy = () => {
        releaseCount++;
    };
    const sessionContext = {
        agentContext,
        registerPort(role: string, port: number) {
            registerCalls.push({ role, port });
            return { release: releaseSpy };
        },
        // The rest of SessionContext isn't touched by updateCodeContext.
    } as unknown as SessionContext<any>;
    return {
        sessionContext,
        registerCalls,
        get releaseCount() {
            return releaseCount;
        },
        releaseSpy,
    } as any;
}

describe("code agent shared server + per-session registration", () => {
    const agent = instantiate();

    async function newSession(): Promise<StubContext> {
        const agentContext = await agent.initializeAgentContext!();
        return makeStubContext(agentContext);
    }

    afterEach(async () => {
        // Defensive: if a test left the shared server up, calling
        // updateAgentContext(false, ...) on a synthetic session won't
        // close it (refcount stays positive). Reach into the module's
        // close path by exhausting any sessions via the public API —
        // but since we control all stubs in each test, the per-test
        // cleanup handles it. Leaving this hook as a placeholder.
    });

    test("enable on a fresh session binds the shared server and registers under (code, default)", async () => {
        const s = await newSession();
        await agent.updateAgentContext!(true, s.sessionContext, "code");
        try {
            // Bind happened — getSharedCodePort returns the bound port.
            const port = getSharedCodePort();
            expect(port).toBeDefined();
            expect(port).toBeGreaterThan(0);
            // Exactly one register call for the session's first schema.
            expect(s.registerCalls).toEqual([{ role: "default", port }]);
            // Web socket server is wired into the per-session agentContext.
            expect(s.sessionContext.agentContext.webSocketServer).toBeDefined();
        } finally {
            await agent.updateAgentContext!(false, s.sessionContext, "code");
            // After last session disables, shared server is torn down.
            expect(getSharedCodePort()).toBeUndefined();
        }
    });

    test("two sessions enabling produce two registrations on the SAME port", async () => {
        const a = await newSession();
        const b = await newSession();
        await agent.updateAgentContext!(true, a.sessionContext, "code");
        const portAfterA = getSharedCodePort();
        await agent.updateAgentContext!(true, b.sessionContext, "code");
        const portAfterB = getSharedCodePort();
        try {
            expect(portAfterA).toBeDefined();
            expect(portAfterB).toBe(portAfterA);
            expect(a.registerCalls).toEqual([
                { role: "default", port: portAfterA },
            ]);
            expect(b.registerCalls).toEqual([
                { role: "default", port: portAfterA },
            ]);
        } finally {
            await agent.updateAgentContext!(false, a.sessionContext, "code");
            await agent.updateAgentContext!(false, b.sessionContext, "code");
        }
    });

    test("disabling one session releases only its own registration; server stays up under the other", async () => {
        const a = await newSession();
        const b = await newSession();
        await agent.updateAgentContext!(true, a.sessionContext, "code");
        await agent.updateAgentContext!(true, b.sessionContext, "code");
        const port = getSharedCodePort();
        expect(port).toBeDefined();

        // A disables — its release runs; B is untouched.
        await agent.updateAgentContext!(false, a.sessionContext, "code");
        expect((a as any).releaseCount).toBe(1);
        expect((b as any).releaseCount).toBe(0);
        // Shared server still bound to the same port (B keeps it alive).
        expect(getSharedCodePort()).toBe(port);

        // B disables — server closes.
        await agent.updateAgentContext!(false, b.sessionContext, "code");
        expect((b as any).releaseCount).toBe(1);
        expect(getSharedCodePort()).toBeUndefined();
    });

    test("multiple schemas on one session only register once and release once", async () => {
        const s = await newSession();
        // updateCodeContext is called per schema; with refcount
        // bookkeeping based on `enabled.size === 0`, the registration is
        // only created on the FIRST schema and released on the LAST.
        await agent.updateAgentContext!(true, s.sessionContext, "code");
        await agent.updateAgentContext!(true, s.sessionContext, "code-editor");
        try {
            expect(s.registerCalls).toHaveLength(1);
        } finally {
            // Disable one schema — server stays up because the session
            // still has another schema enabled.
            await agent.updateAgentContext!(
                false,
                s.sessionContext,
                "code-editor",
            );
            expect((s as any).releaseCount).toBe(0);
            expect(getSharedCodePort()).toBeDefined();
            // Disable the last schema — release fires, server closes.
            await agent.updateAgentContext!(false, s.sessionContext, "code");
            expect((s as any).releaseCount).toBe(1);
            expect(getSharedCodePort()).toBeUndefined();
        }
    });

    test("backstop simulation: releasing A's handle externally still leaves B's registration intact", async () => {
        // Simulates closeSessionContext's finally backstop running for A
        // (which calls portRegistrar.releaseAllForSession bypassing the
        // agent's updateAgentContext(false, ...) path) while B remains
        // active. The agent must tolerate this — its own state assumes
        // the registration may already be released.
        const a = await newSession();
        const b = await newSession();
        await agent.updateAgentContext!(true, a.sessionContext, "code");
        await agent.updateAgentContext!(true, b.sessionContext, "code");
        const port = getSharedCodePort();

        // Pretend the backstop released A's handle directly.
        a.sessionContext.agentContext.portRegistration?.release();

        // Now drive A's disable explicitly. The release call inside
        // updateCodeContext should be a no-op (idempotent stub),
        // bookkeeping must still complete cleanly.
        await agent.updateAgentContext!(false, a.sessionContext, "code");
        // Server still up under B.
        expect(getSharedCodePort()).toBe(port);

        await agent.updateAgentContext!(false, b.sessionContext, "code");
        expect(getSharedCodePort()).toBeUndefined();
    });
});
