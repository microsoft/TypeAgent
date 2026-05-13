// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    AGENT_SERVER_REGISTRAR_NAME,
    DEFAULT_ROLE,
    PortRegistrar,
    SYSTEM_SESSION_CONTEXT_ID,
} from "../src/context/portRegistrar.js";

describe("PortRegistrar", () => {
    const SID_A = "00000000-0000-0000-0000-00000000000a";
    const SID_B = "00000000-0000-0000-0000-00000000000b";

    describe("register", () => {
        test("returns a registration id and stores the allocation", () => {
            const r = new PortRegistrar();
            const id = r.register("browser", "ws-bridge", 51234, SID_A);
            expect(typeof id).toBe("string");
            expect(id.length).toBeGreaterThan(0);
            expect(r.lookup("browser", "ws-bridge")).toBe(51234);
        });

        test("re-register with the same triple updates port in place and returns same id", () => {
            const r = new PortRegistrar();
            const id1 = r.register("browser", "ws-bridge", 51234, SID_A);
            const id2 = r.register("browser", "ws-bridge", 51235, SID_A);
            expect(id2).toBe(id1);
            expect(r.lookup("browser", "ws-bridge")).toBe(51235);
            expect(r.list()).toHaveLength(1);
        });

        test("different sessions for same (agent, role) get distinct ids", () => {
            const r = new PortRegistrar();
            const id1 = r.register("browser", "ws-bridge", 51234, SID_A);
            const id2 = r.register("browser", "ws-bridge", 51235, SID_B);
            expect(id2).not.toBe(id1);
            expect(r.list()).toHaveLength(2);
        });

        test("different roles for same (agent, session) get distinct ids", () => {
            const r = new PortRegistrar();
            const id1 = r.register("browser", "ws-bridge", 51234, SID_A);
            const id2 = r.register("browser", "http-debug", 51235, SID_A);
            expect(id2).not.toBe(id1);
            expect(r.lookup("browser", "ws-bridge")).toBe(51234);
            expect(r.lookup("browser", "http-debug")).toBe(51235);
        });

        test("rejects port 0 (must pass the OS-assigned port, not the bind hint)", () => {
            const r = new PortRegistrar();
            expect(() => r.register("browser", "ws", 0, SID_A)).toThrow(
                /port 0/,
            );
        });

        test("rejects out-of-range ports", () => {
            const r = new PortRegistrar();
            expect(() => r.register("browser", "ws", -1, SID_A)).toThrow();
            expect(() => r.register("browser", "ws", 65536, SID_A)).toThrow();
            expect(() => r.register("browser", "ws", 1.5, SID_A)).toThrow();
        });

        test("warns but accepts privileged ports (does not throw)", () => {
            const r = new PortRegistrar();
            expect(() => r.register("browser", "ws", 80, SID_A)).not.toThrow();
            expect(r.lookup("browser", "ws")).toBe(80);
        });

        test("warns but accepts the agentServer's own port (does not throw)", () => {
            const r = new PortRegistrar();
            r.register(
                AGENT_SERVER_REGISTRAR_NAME,
                DEFAULT_ROLE,
                8999,
                SYSTEM_SESSION_CONTEXT_ID,
            );
            expect(() =>
                r.register("browser", "ws", 8999, SID_A),
            ).not.toThrow();
            expect(r.lookup("browser", "ws")).toBe(8999);
        });
    });

    describe("system allocation", () => {
        test("agent-server self-port is discoverable via lookup", () => {
            const r = new PortRegistrar();
            r.register(
                AGENT_SERVER_REGISTRAR_NAME,
                DEFAULT_ROLE,
                8999,
                SYSTEM_SESSION_CONTEXT_ID,
            );
            expect(r.lookup(AGENT_SERVER_REGISTRAR_NAME)).toBe(8999);
        });

        test("releaseAllForSession does not release system allocations", () => {
            const r = new PortRegistrar();
            r.register(
                AGENT_SERVER_REGISTRAR_NAME,
                DEFAULT_ROLE,
                8999,
                SYSTEM_SESSION_CONTEXT_ID,
            );
            // Even if a buggy caller passes the system id, it must be a
            // no-op so the agent-server port can't be culled mid-process.
            expect(r.releaseAllForSession(SYSTEM_SESSION_CONTEXT_ID)).toBe(0);
            expect(r.lookup(AGENT_SERVER_REGISTRAR_NAME)).toBe(8999);
        });
    });

    describe("release", () => {
        test("removes the allocation", () => {
            const r = new PortRegistrar();
            const id = r.register("browser", "ws", 51234, SID_A);
            r.release(id);
            expect(r.lookup("browser", "ws")).toBeUndefined();
            expect(r.list()).toHaveLength(0);
        });

        test("is idempotent on unknown id", () => {
            const r = new PortRegistrar();
            expect(() => r.release("not-a-real-id")).not.toThrow();
        });

        test("ownership check: release with mismatched sessionContextId is a no-op", () => {
            const r = new PortRegistrar();
            const id = r.register("browser", "ws", 51234, SID_A);
            r.release(id, SID_B); // wrong owner
            expect(r.lookup("browser", "ws")).toBe(51234);
            r.release(id, SID_A); // correct owner
            expect(r.lookup("browser", "ws")).toBeUndefined();
        });

        test("after release, re-register issues a fresh id", () => {
            const r = new PortRegistrar();
            const id1 = r.register("browser", "ws", 51234, SID_A);
            r.release(id1);
            const id2 = r.register("browser", "ws", 51234, SID_A);
            expect(id2).not.toBe(id1);
        });
    });

    describe("releaseAllForSession", () => {
        test("releases only allocations belonging to the given session", () => {
            const r = new PortRegistrar();
            r.register("browser", "ws", 1, SID_A);
            r.register("code", "ws", 2, SID_A);
            r.register("browser", "http", 3, SID_B);
            const released = r.releaseAllForSession(SID_A);
            expect(released).toBe(2);
            expect(r.lookup("browser", "ws")).toBeUndefined();
            expect(r.lookup("code", "ws")).toBeUndefined();
            expect(r.lookup("browser", "http")).toBe(3);
        });

        test("returns 0 when no allocations match", () => {
            const r = new PortRegistrar();
            r.register("browser", "ws", 1, SID_A);
            expect(r.releaseAllForSession(SID_B)).toBe(0);
            expect(r.lookup("browser", "ws")).toBe(1);
        });
    });

    describe("lookup", () => {
        test("returns undefined for unknown (agent, role)", () => {
            const r = new PortRegistrar();
            expect(r.lookup("nope", "default")).toBeUndefined();
        });

        test("returns most recent registration when multiple sessions overlap", () => {
            const r = new PortRegistrar();
            r.register("browser", "ws", 1, SID_A);
            r.register("browser", "ws", 2, SID_B);
            expect(r.lookup("browser", "ws")).toBe(2);
        });

        test("after the most-recent session releases, lookup falls back to the older one", () => {
            const r = new PortRegistrar();
            r.register("browser", "ws", 1, SID_A);
            const id2 = r.register("browser", "ws", 2, SID_B);
            r.release(id2);
            expect(r.lookup("browser", "ws")).toBe(1);
        });

        test("re-registering an older session moves it to most-recent (regression: insertion-order)", () => {
            // SID_A registers first, then SID_B (newer). Without the
            // delete+reinsert fix, an SID_A re-register would update
            // its port in place but leave SID_B as the most-recent
            // entry by insertion order, so lookup would still return
            // SID_B's port.
            const r = new PortRegistrar();
            r.register("browser", "ws", 1, SID_A);
            r.register("browser", "ws", 2, SID_B);
            r.register("browser", "ws", 99, SID_A); // SID_A re-registers
            expect(r.lookup("browser", "ws")).toBe(99);
        });
    });

    describe("hasActiveAllocations", () => {
        test("false when empty", () => {
            const r = new PortRegistrar();
            expect(r.hasActiveAllocations()).toBe(false);
        });

        test("true with at least one allocation", () => {
            const r = new PortRegistrar();
            r.register("browser", "ws", 1, SID_A);
            expect(r.hasActiveAllocations()).toBe(true);
        });

        test("false again after all releases", () => {
            const r = new PortRegistrar();
            const id = r.register("browser", "ws", 1, SID_A);
            r.release(id);
            expect(r.hasActiveAllocations()).toBe(false);
        });
    });
});
