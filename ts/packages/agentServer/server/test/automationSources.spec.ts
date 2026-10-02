// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { MacroManager } from "@typeagent/copilot-macros";
import {
    createAutomationSources,
    withAutomationSources,
} from "../src/automationSources.js";

// Mirrors the check agent-rpc applies to agent init options: objects must be
// plain, and functions are proxied across the process boundary.
function assertRpcSafe(value: unknown, path = "options"): void {
    if (typeof value !== "object" || value === null) return;
    const proto = Object.getPrototypeOf(value);
    if (proto !== null && proto !== Object.prototype) {
        throw new Error(`${path} is not a plain object`);
    }
    for (const [key, child] of Object.entries(value)) {
        assertRpcSafe(child, `${path}.${key}`);
    }
}

class FakeMacroManager {
    calls: string[] = [];
    async listMacros() {
        this.calls.push("list");
        return [{ macroId: "m1" }];
    }
    async inspectMacro(request: { macroId: string }) {
        this.calls.push(`inspect:${request.macroId}`);
        return {};
    }
    async validateMacro() {
        return { valid: true, issues: [] };
    }
    async approveMacro() {}
    async disableMacro() {}
    async deleteMacro() {}
}

describe("automation sources", () => {
    test("are plain objects that cross the agent process boundary", () => {
        const manager = new FakeMacroManager();
        const sources = createAutomationSources(
            "C:\\instance",
            manager as unknown as MacroManager,
        );
        expect(() =>
            assertRpcSafe(withAutomationSources(undefined, sources)),
        ).not.toThrow();
    });

    test("a macro manager instance would be rejected", () => {
        expect(() => assertRpcSafe({ macros: new FakeMacroManager() })).toThrow(
            "not a plain object",
        );
    });

    test("calls are delegated to the macro manager", async () => {
        const manager = new FakeMacroManager();
        const sources = createAutomationSources(
            "C:\\instance",
            manager as unknown as MacroManager,
        );
        expect(await sources.macros!.listMacros()).toEqual([{ macroId: "m1" }]);
        await sources.macros!.inspectMacro({ macroId: "m1" });
        expect(manager.calls).toEqual(["list", "inspect:m1"]);
    });

    test("merges into existing browser options and wraps a bare control", () => {
        const sources = createAutomationSources(
            "C:\\instance",
            new FakeMacroManager() as unknown as MacroManager,
        );
        const memory = {};
        expect(
            withAutomationSources(
                { browser: { memoryServiceClient: memory }, other: 1 },
                sources,
            ),
        ).toEqual({
            browser: { memoryServiceClient: memory, automations: sources },
            other: 1,
        });
        const control = { getPageUrl: () => "x" };
        expect(
            withAutomationSources({ browser: control }, sources).browser,
        ).toEqual({ browserControl: control, automations: sources });
    });
});
