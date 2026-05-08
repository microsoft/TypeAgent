// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createServer, Server } from "node:http";
import { getBoundPort } from "../src/boundPort.js";

function listenOn(server: Server, port: number): Promise<void> {
    return new Promise((resolve, reject) => {
        const onError = (err: Error) => {
            server.off("listening", onListening);
            reject(err);
        };
        const onListening = () => {
            server.off("error", onError);
            resolve();
        };
        server.once("error", onError);
        server.once("listening", onListening);
        server.listen(port);
    });
}

describe("getBoundPort", () => {
    it("returns the OS-assigned port after binding to 0", async () => {
        const server = createServer();
        try {
            await listenOn(server, 0);
            const port = getBoundPort(server);
            expect(typeof port).toBe("number");
            expect(port).toBeGreaterThan(0);
            expect(port).toBeLessThan(65536);
        } finally {
            await new Promise<void>((r) => server.close(() => r()));
        }
    });

    it("returns the same port that the server is listening on", async () => {
        const server = createServer();
        try {
            await listenOn(server, 0);
            const port = getBoundPort(server);
            // Round-trip: address() should still report the same port.
            const addr = server.address();
            expect(addr).not.toBeNull();
            expect(typeof addr).toBe("object");
            expect((addr as { port: number }).port).toBe(port);
        } finally {
            await new Promise<void>((r) => server.close(() => r()));
        }
    });

    it("throws when the server has not been bound", () => {
        const server = createServer();
        expect(() => getBoundPort(server)).toThrow(/not listening/i);
    });

    it("throws when the address is a string (Unix socket / pipe)", () => {
        const fakeServer = {
            address: () => "/tmp/fake.sock",
        };
        expect(() => getBoundPort(fakeServer)).toThrow(/not bound to a TCP/i);
    });
});
