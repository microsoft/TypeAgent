// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { EventEmitter } from "node:events";

import { closeAgentProcess } from "../src/agentProvider/process/agentProcessShim.js";

class FakeChildProcess extends EventEmitter {
    connected = true;
    exitCode: number | null = null;
    disconnectCount = 0;
    killCount = 0;

    disconnect = () => {
        this.disconnectCount++;
        this.connected = false;
    };
    kill = () => {
        this.killCount++;
        return true;
    };
}

function createChildProcess(): FakeChildProcess {
    return new FakeChildProcess();
}

describe("closeAgentProcess", () => {
    test("forces exit after graceful and telemetry deadlines", async () => {
        const child = createChildProcess();
        let exitRequests = 0;
        const closePromise = closeAgentProcess(
            child,
            () => exitRequests++,
            10,
            20,
        );

        expect(exitRequests).toBe(1);
        await new Promise((resolve) => setTimeout(resolve, 15));
        expect(child.disconnectCount).toBe(1);
        expect(child.killCount).toBe(0);

        await new Promise((resolve) => setTimeout(resolve, 20));
        expect(child.killCount).toBe(1);

        child.emit("exit", null, "SIGTERM");
        await closePromise;
    });

    test("cancels forced exit when the child exits gracefully", async () => {
        const child = createChildProcess();
        const closePromise = closeAgentProcess(child, () => {}, 10, 20);

        child.exitCode = 0;
        child.emit("exit", 0, null);
        await closePromise;
        await new Promise((resolve) => setTimeout(resolve, 35));

        expect(child.disconnectCount).toBe(0);
        expect(child.killCount).toBe(0);
    });
});
