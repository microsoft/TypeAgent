// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Tests for the code agent's readiness/setup wiring.
 *
 * Pure functions only — `evaluateCodeReadiness` (decision) and
 * `resolveCodePort` (env parse) — plus `runLaunchAndWait` exercised with
 * an injected `launchImpl` so we don't actually spawn `code --new-window`
 * during tests.
 */

import {
    evaluateCodeReadiness,
    resolveCodePort,
    runLaunchAndWait,
} from "../src/readiness.js";
import type { ActionContext } from "@typeagent/agent-sdk";

describe("evaluateCodeReadiness", () => {
    test("ready when a client is connected (state of the CLI doesn't matter)", () => {
        // CLI absence is irrelevant when we have a live connection — the
        // user clearly has VS Code working. Spec'd explicitly so we don't
        // accidentally regress the order of checks.
        expect(
            evaluateCodeReadiness({
                clientConnected: true,
                vsCodeCliInstalled: true,
                port: 8082,
            }),
        ).toEqual({ state: "ready" });
        expect(
            evaluateCodeReadiness({
                clientConnected: true,
                vsCodeCliInstalled: false,
                port: 8082,
            }),
        ).toEqual({ state: "ready" });
    });

    test("setup-required (NOT-INSTALLED branch) when no client AND no `code` on PATH", () => {
        // Real configuration gap — the user hasn't set up VS Code.
        const r = evaluateCodeReadiness({
            clientConnected: false,
            vsCodeCliInstalled: false,
            port: 8082,
        });
        expect(r.state).toBe("setup-required");
        expect(r.message).toMatch(/not installed/i);
        expect(r.message).toMatch(/`code` is not on PATH/);
        expect(r.details).toMatch(/code\.visualstudio\.com/);
        expect(r.details).toMatch(/Coda extension/);
        expect(r.details).toMatch(/@config agent refresh code/);
    });

    test("setup-required (NOT-RUNNING branch) when CLI is on PATH but no client connected", () => {
        // Transient runtime state — VS Code is configured fine, just not
        // currently open. Message must NOT frame this as a config problem.
        const r = evaluateCodeReadiness({
            clientConnected: false,
            vsCodeCliInstalled: true,
            port: 8082,
        });
        expect(r.state).toBe("setup-required");
        expect(r.message).toMatch(/currently running/i);
        expect(r.message).not.toMatch(/not installed/i);
        expect(r.details).toMatch(/@config agent setup code/);
    });

    test("port flows into the not-running branch's message", () => {
        const r = evaluateCodeReadiness({
            clientConnected: false,
            vsCodeCliInstalled: true,
            port: 9999,
        });
        expect(r.message).toMatch(/port 9999/);
    });
});

describe("resolveCodePort", () => {
    test("defaults to 8082 when CODE_WEBSOCKET_PORT is unset", () => {
        expect(resolveCodePort({} as NodeJS.ProcessEnv)).toBe(8082);
    });

    test("parses a valid integer override", () => {
        expect(
            resolveCodePort({
                CODE_WEBSOCKET_PORT: "9100",
            } as NodeJS.ProcessEnv),
        ).toBe(9100);
    });

    test("falls back to default when CODE_WEBSOCKET_PORT is non-numeric", () => {
        // Defensive: parseInt on garbage returns NaN. Without the
        // Number.isFinite guard we'd return NaN as the port and the
        // listener would explode.
        expect(
            resolveCodePort({
                CODE_WEBSOCKET_PORT: "abc",
            } as NodeJS.ProcessEnv),
        ).toBe(8082);
    });

    test("falls back to default for zero / negative values", () => {
        expect(
            resolveCodePort({
                CODE_WEBSOCKET_PORT: "0",
            } as NodeJS.ProcessEnv),
        ).toBe(8082);
        expect(
            resolveCodePort({
                CODE_WEBSOCKET_PORT: "-1",
            } as NodeJS.ProcessEnv),
        ).toBe(8082);
    });
});

describe("runLaunchAndWait", () => {
    function makeActionContext(): ActionContext<unknown> {
        const appended: any[] = [];
        return {
            sessionContext: {
                agentContext: undefined,
                notify: () => {},
            } as any,
            actionIO: {
                appendDisplay: (content: any) => appended.push(content),
                setDisplay: () => {},
                takeAction: () => {},
            } as any,
            _appended: appended,
        } as any;
    }

    // Hand-rolled launch stub — `jest.fn()` requires importing from
    // @jest/globals under --experimental-vm-modules, and a counter is
    // enough for what these tests assert.
    function makeLaunch(opts?: { error?: Error }) {
        const stub = {
            calls: 0,
            async run() {
                stub.calls++;
                if (opts?.error) throw opts.error;
            },
        };
        return stub;
    }

    test("returns success when isConnected flips to true within timeout", async () => {
        let calls = 0;
        const isConnected = () => {
            calls++;
            return calls >= 2; // false on first poll, true thereafter
        };
        const launch = makeLaunch();
        const result = await runLaunchAndWait(
            makeActionContext(),
            isConnected,
            8082,
            { timeoutMs: 5_000, launchImpl: () => launch.run() },
        );
        expect(result.error).toBeUndefined();
        expect(launch.calls).toBe(1);
    });

    test("returns failure when timeout expires without a connection", async () => {
        const launch = makeLaunch();
        const result = await runLaunchAndWait(
            makeActionContext(),
            () => false,
            8082,
            // Short timeout to keep the test fast — the polling step is
            // 500ms, so 700ms gives one or two iterations.
            { timeoutMs: 700, launchImpl: () => launch.run() },
        );
        expect(result.error).toBeDefined();
        expect(result.error).toMatch(/No connection after/);
    });

    test("returns failure when launchImpl throws", async () => {
        const launch = makeLaunch({
            error: new Error("code: command not found"),
        });
        const result = await runLaunchAndWait(
            makeActionContext(),
            () => false,
            8082,
            { timeoutMs: 5_000, launchImpl: () => launch.run() },
        );
        expect(result.error).toBeDefined();
        expect(result.error).toMatch(/Failed to launch VS Code/);
        expect(result.error).toMatch(/code: command not found/);
    });

    test("short-circuits when isConnected is already true on entry", async () => {
        const launch = makeLaunch();
        const start = Date.now();
        const result = await runLaunchAndWait(
            makeActionContext(),
            () => true,
            8082,
            { timeoutMs: 30_000, launchImpl: () => launch.run() },
        );
        // We still call launchImpl (the choice flow committed to launching);
        // the short-circuit is the lack of polling, not skipping the spawn.
        expect(result.error).toBeUndefined();
        expect(Date.now() - start).toBeLessThan(2_000);
    });
});
