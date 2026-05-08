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
            const reg = new PortRegistry();
            try {
                const result = await reg.allocate(Namespaces.Excel, {
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
            const reg = new PortRegistry();
            try {
                const { slotId, ports } = await reg.allocate(
                    Namespaces.Excel,
                    { count: 2 },
                );
                await reg.register(slotId, "Book1.xlsx");
                const got = await reg.lookup(Namespaces.Excel, "Book1.xlsx");
                expect(got.slotId).toBe(slotId);
                expect(got.ports).toEqual(ports);
            } finally {
                await reg.stop();
            }
        });
    });

    it("allocate with key registers the resource atomically", async () => {
        await withTestRegistry(async () => {
            const reg = new PortRegistry();
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
            const reg = new PortRegistry();
            try {
                await reg.ensure();
                const got = await reg.lookup(Namespaces.Excel, "nope.xlsx");
                expect(got.slotId).toBeNull();
                expect(got.ports).toBeNull();
            } finally {
                await reg.stop();
            }
        });
    });

    it("release drops the slot and any registrations on it", async () => {
        await withTestRegistry(async () => {
            const reg = new PortRegistry();
            try {
                const { slotId } = await reg.allocate(Namespaces.Excel, {
                    key: "x.xlsx",
                });
                await reg.release(slotId);
                const got = await reg.lookup(Namespaces.Excel, "x.xlsx");
                expect(got.slotId).toBeNull();
            } finally {
                await reg.stop();
            }
        });
    });

    it("unregister removes the resource but keeps the slot", async () => {
        await withTestRegistry(async () => {
            const reg = new PortRegistry();
            try {
                const { slotId } = await reg.allocate(Namespaces.Excel, {
                    key: "x.xlsx",
                });
                await reg.unregister(slotId, "x.xlsx");
                const got = await reg.lookup(Namespaces.Excel, "x.xlsx");
                expect(got.slotId).toBeNull();
                // slot itself still alive — register a new resource on it
                await reg.register(slotId, "y.xlsx");
                const got2 = await reg.lookup(Namespaces.Excel, "y.xlsx");
                expect(got2.slotId).toBe(slotId);
            } finally {
                await reg.stop();
            }
        });
    });

    it("singleton lookup (no key) returns the first slot in a namespace", async () => {
        await withTestRegistry(async () => {
            const reg = new PortRegistry();
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
            const a = new PortRegistry();
            const b = new PortRegistry();
            try {
                await a.ensure();
                await b.ensure();
                const { slotId, ports } = await a.allocate(Namespaces.Excel, {
                    count: 1,
                    key: "shared.xlsx",
                });
                const got = await b.lookup(Namespaces.Excel, "shared.xlsx");
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
            const a = new PortRegistry();
            const b = new PortRegistry();
            try {
                await a.ensure();
                await b.ensure();
                const { slotId } = await b.allocate(Namespaces.Excel, {
                    count: 1,
                });
                await b.register(slotId, "from-client.xlsx");
                const got = await a.lookup(
                    Namespaces.Excel,
                    "from-client.xlsx",
                );
                expect(got.slotId).toBe(slotId);
            } finally {
                await b.stop();
                await a.stop();
            }
        });
    });
});
