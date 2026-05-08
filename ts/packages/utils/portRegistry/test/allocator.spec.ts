// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { reservePorts } from "../src/allocator.js";
import { createServer } from "net";

describe("reservePorts", () => {
    it("returns the requested number of ports", async () => {
        const ports = await reservePorts(3);
        expect(ports).toHaveLength(3);
        for (const p of ports) {
            expect(typeof p).toBe("number");
            expect(p).toBeGreaterThan(0);
            expect(p).toBeLessThan(65536);
        }
    });

    it("returns distinct ports across calls", async () => {
        const a = await reservePorts(5);
        const b = await reservePorts(5);
        const overlap = a.filter((p) => b.includes(p));
        // OS may occasionally reuse a recently-closed port; allow at most one.
        expect(overlap.length).toBeLessThanOrEqual(1);
    });

    it("returned ports can actually be bound", async () => {
        const [port] = await reservePorts(1);
        await new Promise<void>((resolve, reject) => {
            const srv = createServer();
            srv.on("error", reject);
            srv.listen(port, "127.0.0.1", () => {
                srv.close(() => resolve());
            });
        });
    });

    it("rejects when count < 1", async () => {
        await expect(reservePorts(0)).rejects.toThrow();
    });
});
