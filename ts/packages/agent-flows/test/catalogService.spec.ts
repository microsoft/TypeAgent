// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
    createAutomationCatalogService,
    type MacroCatalogSource,
    type MacroLike,
} from "../src/catalog/index.js";

function entry(actionName: string, enabled = true) {
    return {
        actionName,
        displayName: actionName,
        description: `${actionName} description`,
        flowPath: `flows/${actionName}.flow.json`,
        scriptPath: `scripts/${actionName}.ps1`,
        grammarRuleText: "",
        parameters: [],
        created: "2026-10-01T00:00:00Z",
        updated: "2026-10-01T00:00:00Z",
        source: "manual",
        usageCount: 0,
        enabled,
    };
}

function macro(state: MacroLike["state"], version = 1): MacroLike {
    return {
        macroId: "m1",
        version,
        name: "M1",
        description: "d",
        state,
        executionClass: "replayable",
        inputs: [],
        steps: [],
        sourceTraceId: "trace-1",
        createdAt: "2026-10-02T00:00:00Z",
        warnings: [],
    };
}

function fakeMacros(initial: MacroLike): MacroCatalogSource & {
    calls: string[];
} {
    let current = initial;
    const calls: string[] = [];
    return {
        calls,
        listMacros: async () => [{ macroId: current.macroId }],
        inspectMacro: async () => current,
        validateMacro: async () => ({
            valid: true,
            issues: [{ severity: "warning", code: "w", message: "m" }],
        }),
        approveMacro: async () => {
            calls.push("approve");
            current = macro("approved", current.version + 1);
        },
        disableMacro: async () => {
            calls.push("disable");
            current = macro("disabled", current.version + 1);
        },
        deleteMacro: async () => {
            calls.push("delete");
        },
    };
}

describe("automation catalog service", () => {
    let dir: string;

    beforeEach(() => {
        dir = mkdtempSync(path.join(os.tmpdir(), "catalog-"));
    });

    afterEach(() => {
        rmSync(dir, { recursive: true, force: true });
    });

    function writeFlowStore(kind: "powershell" | "taskflow") {
        const root = path.join(dir, kind);
        mkdirSync(path.join(root, "flows"), { recursive: true });
        mkdirSync(path.join(root, "scripts"), { recursive: true });
        writeFileSync(
            path.join(root, "index.json"),
            JSON.stringify({
                version: 1,
                flows: { a: entry("a"), b: entry("b", false) },
            }),
        );
        writeFileSync(
            path.join(root, "flows", "a.flow.json"),
            JSON.stringify({
                grammarPatterns: [{ pattern: "run a" }],
                sandbox: { allowedCmdlets: ["Get-Item"] },
            }),
        );
        writeFileSync(path.join(root, "scripts", "a.ps1"), "Get-Item .");
    }

    test("lists flows and macros with provider status", async () => {
        writeFlowStore("powershell");
        const service = createAutomationCatalogService({
            instanceDir: dir,
            macros: fakeMacros(macro("draft")),
        });
        const catalog = await service.list();
        expect(catalog.items.map((i) => i.id).sort()).toEqual([
            "powershell:a",
            "powershell:b",
            "toolMacro:m1",
        ]);
        expect(catalog.items.find((i) => i.id === "powershell:b")?.status).toBe(
            "disabled",
        );
        expect(catalog.providers).toEqual([
            { kind: "powershell", available: true },
            { kind: "taskflow", available: true },
            { kind: "toolMacro", available: true },
        ]);
    });

    test("reports missing macro manager without failing the list", async () => {
        const catalog = await createAutomationCatalogService({
            instanceDir: dir,
        }).list();
        expect(catalog.items).toEqual([]);
        expect(catalog.providers.at(-1)).toMatchObject({
            kind: "toolMacro",
            available: false,
        });
    });

    test("isolates a provider failure", async () => {
        const macros = fakeMacros(macro("draft"));
        macros.listMacros = async () => {
            throw new Error("catalog corrupt");
        };
        const catalog = await createAutomationCatalogService({
            instanceDir: dir,
            macros,
        }).list();
        expect(catalog.providers.at(-1)).toEqual({
            kind: "toolMacro",
            available: false,
            reason: "catalog corrupt",
        });
    });

    test("flow detail includes script and stored sandbox", async () => {
        writeFlowStore("powershell");
        const detail = await createAutomationCatalogService({
            instanceDir: dir,
        }).get("powershell:a");
        expect(detail.body?.text).toBe("Get-Item .");
        expect(detail.triggerPhrases).toEqual(["run a"]);
        expect(detail.safety[0]).toEqual({
            label: "Allowed cmdlets",
            value: "Get-Item",
        });
    });

    test("ignores a stored path that escapes the agent directory", async () => {
        const root = path.join(dir, "taskflow");
        mkdirSync(root, { recursive: true });
        writeFileSync(path.join(dir, "secret.txt"), "secret");
        writeFileSync(
            path.join(root, "index.json"),
            JSON.stringify({
                version: 1,
                flows: {
                    x: { ...entry("x"), scriptPath: "../secret.txt" },
                },
            }),
        );
        const detail = await createAutomationCatalogService({
            instanceDir: dir,
        }).get("taskflow:x");
        expect(detail.body).toBeUndefined();
    });

    test("unknown flow and unsupported actions are errors", async () => {
        writeFlowStore("powershell");
        const service = createAutomationCatalogService({
            instanceDir: dir,
            macros: fakeMacros(macro("draft")),
        });
        await expect(service.get("powershell:missing")).rejects.toThrow(
            "not found",
        );
        await expect(service.approve("powershell:a")).rejects.toThrow(
            "does not support",
        );
        await expect(service.get("bogus")).rejects.toThrow("Unknown");
    });

    test("macro lifecycle calls go through the macro source", async () => {
        const macros = fakeMacros(macro("draft"));
        const service = createAutomationCatalogService({
            instanceDir: dir,
            macros,
        });
        const report = await service.validate("toolMacro:m1");
        expect(report.valid).toBe(true);
        expect((await service.approve("toolMacro:m1")).status).toBe("active");
        expect((await service.disable("toolMacro:m1")).status).toBe("disabled");
        await service.remove("toolMacro:m1");
        expect(macros.calls).toEqual(["approve", "disable", "delete"]);
    });

    test("approval refusals from the manager reach the caller unchanged", async () => {
        const macros = fakeMacros(macro("draft"));
        macros.approveMacro = async () => {
            throw new Error(
                "Macro validation failed; approval was not recorded.",
            );
        };
        await expect(
            createAutomationCatalogService({
                instanceDir: dir,
                macros,
            }).approve("toolMacro:m1"),
        ).rejects.toThrow(
            "Macro validation failed; approval was not recorded.",
        );
    });
});
