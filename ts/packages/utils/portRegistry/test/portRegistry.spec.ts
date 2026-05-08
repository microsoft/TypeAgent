// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    PortRegistry,
    REGISTRY_PORT_ENV,
    Namespaces,
} from "../src/index.js";
import { reservePorts } from "../src/allocator.js";

/**
 * Each test runs against an isolated registry on a fresh ephemeral port to
 * avoid clashing with any real registry the developer has running locally.
 */
async function withTestRegistry<T>(
    fn: (envPort: number) => Promise<T>,
): Promise<T> {
    const [port] = await reservePorts(1);
    const prev = process.env[REGISTRY_PORT_ENV];
    process.env[REGISTRY_PORT_ENV] = String(port);
    try {
        return await fn(port);
    } finally {
        if (prev === undefined) delete process.env[REGISTRY_PORT_ENV];
        else process.env[REGISTRY_PORT_ENV] = prev;
    }
}

describe("PortRegistry (single process, server mode)", () => {
    it("allocate returns a slotId and the requested number of ports", async () => {
        await withTestRegistry(async () => {
            const reg = new PortRegistry({ serverEligible: true });
            try {
                const result = await reg.allocate("test-ns", {
                    count: 2,
                });
                expect(result.slotId).toMatch(/^[0-9a-f-]+$/);
                expect(result.ports).toHaveLength(2);
            } finally {
                await reg.stop();
            }
        });
    });

    it("register + lookup round-trips", async () => {
        await withTestRegistry(async () => {
            const reg = new PortRegistry({ serverEligible: true });
            try {
                const { slotId, ports } = await reg.allocate(
                    "test-ns",
                    { count: 2 },
                );
                await reg.register(slotId, "resA");
                const got = await reg.lookup("test-ns", "resA");
                expect(got.slotId).toBe(slotId);
                expect(got.ports).toEqual(ports);
            } finally {
                await reg.stop();
            }
        });
    });

    it("allocate with key registers the resource atomically", async () => {
        await withTestRegistry(async () => {
            const reg = new PortRegistry({ serverEligible: true });
            try {
                const { slotId } = await reg.allocate(
                    Namespaces.AgentServer,
                    { key: "default" },
                );
                const got = await reg.lookup(Namespaces.AgentServer, "default");
                expect(got.slotId).toBe(slotId);
            } finally {
                await reg.stop();
            }
        });
    });

    it("lookup of unknown resource returns null", async () => {
        await withTestRegistry(async () => {
            const reg = new PortRegistry({ serverEligible: true });
            try {
                await reg.ensure();
                const got = await reg.lookup("test-ns", "missing");
                expect(got.slotId).toBeNull();
                expect(got.ports).toBeNull();
            } finally {
                await reg.stop();
            }
        });
    });

    it("release drops the slot and any registrations on it", async () => {
        await withTestRegistry(async () => {
            const reg = new PortRegistry({ serverEligible: true });
            try {
                const { slotId } = await reg.allocate("test-ns", {
                    key: "resX",
                });
                await reg.release(slotId);
                const got = await reg.lookup("test-ns", "resX");
                expect(got.slotId).toBeNull();
            } finally {
                await reg.stop();
            }
        });
    });

    it("unregister removes the resource but keeps the slot", async () => {
        await withTestRegistry(async () => {
            const reg = new PortRegistry({ serverEligible: true });
            try {
                const { slotId } = await reg.allocate("test-ns", {
                    key: "resX",
                });
                await reg.unregister(slotId, "resX");
                const got = await reg.lookup("test-ns", "resX");
                expect(got.slotId).toBeNull();
                // slot itself still alive — register a new resource on it
                await reg.register(slotId, "resY");
                const got2 = await reg.lookup("test-ns", "resY");
                expect(got2.slotId).toBe(slotId);
            } finally {
                await reg.stop();
            }
        });
    });

    it("singleton lookup (no key) returns the first slot in a namespace", async () => {
        await withTestRegistry(async () => {
            const reg = new PortRegistry({ serverEligible: true });
            try {
                const { slotId } = await reg.allocate(Namespaces.AgentServer);
                const got = await reg.lookup(Namespaces.AgentServer);
                expect(got.slotId).toBe(slotId);
            } finally {
                await reg.stop();
            }
        });
    });
});

describe("PortRegistry (two processes — same-process simulation)", () => {
    it("second instance enters client mode and shares state with server", async () => {
        await withTestRegistry(async () => {
            const a = new PortRegistry({ serverEligible: true });
            const b = new PortRegistry({ serverEligible: true });
            try {
                await a.ensure();
                await b.ensure();
                const { slotId, ports } = await a.allocate("test-ns", {
                    count: 1,
                    key: "resShared",
                });
                const got = await b.lookup("test-ns", "resShared");
                expect(got.slotId).toBe(slotId);
                expect(got.ports).toEqual(ports);
            } finally {
                await b.stop();
                await a.stop();
            }
        });
    });

    it("client can register and server sees it", async () => {
        await withTestRegistry(async () => {
            const a = new PortRegistry({ serverEligible: true });
            const b = new PortRegistry({ serverEligible: true });
            try {
                await a.ensure();
                await b.ensure();
                const { slotId } = await b.allocate("test-ns", {
                    count: 1,
                });
                await b.register(slotId, "resClient");
                const got = await a.lookup(
                    "test-ns",
                    "resClient",
                );
                expect(got.slotId).toBe(slotId);
            } finally {
                await b.stop();
                await a.stop();
            }
        });
    });
});

describe("PortRegistry client-only mode", () => {
    it("client-only handle never binds the registry port", async () => {
        await withTestRegistry(async () => {
            const c = new PortRegistry();
            try {
                await c.ensure();
                expect(c.isServerEligible()).toBe(false);
                // No server is up — allocate should fail (cannot bind, cannot reach).
                await expect(
                    c.allocate("test-ns", { count: 1 }),
                ).rejects.toBeDefined();
            } finally {
                await c.stop();
            }
        });
    });

    it("client-only handle talks to an existing server but does not promote on failure", async () => {
        await withTestRegistry(async () => {
            const server = new PortRegistry({ serverEligible: true });
            const client = new PortRegistry();
            try {
                await server.ensure();
                await client.ensure();
                expect(client.isServerEligible()).toBe(false);
                const { slotId } = await client.allocate("test-ns", {
                    count: 1,
                });
                expect(slotId).toBeDefined();
                // Kill the server. A subsequent client call must NOT promote.
                await server.stop();
                await expect(
                    client.lookup("test-ns", "missing"),
                ).rejects.toBeDefined();
            } finally {
                await client.stop();
                await server.stop().catch(() => {});
            }
        });
    });

    it("enableServerMode flips a fresh handle to server-eligible", async () => {
        await withTestRegistry(async () => {
            const reg = new PortRegistry();
            expect(reg.isServerEligible()).toBe(false);
            reg.enableServerMode();
            expect(reg.isServerEligible()).toBe(true);
            try {
                await reg.ensure();
                const { slotId } = await reg.allocate("test-ns", {
                    count: 1,
                });
                expect(slotId).toBeDefined();
            } finally {
                await reg.stop();
            }
        });
    });
});
