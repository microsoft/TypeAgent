// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import {
    compileGrammarToNFA,
    loadGrammarRulesNoThrow,
    matchNFA,
} from "@typeagent/action-grammar";
import type {
    CommandDescriptor,
    CommandDescriptorTable,
} from "@typeagent/agent-sdk";
import { instantiate } from "../src/actionHandler.mjs";
import { formatPowerShellFlowDetails } from "../src/flowDetails.mjs";
import {
    PowerShellStore,
    type PowerShellFlowDefinition,
} from "../src/store/powerShellStore.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const grammarPath = path.resolve(
    here,
    "..",
    "..",
    "src",
    "powershellSchema.agr",
);

function makeMatcher() {
    const errors: string[] = [];
    const grammar = loadGrammarRulesNoThrow(
        "powershellSchema.agr",
        fs.readFileSync(grammarPath, "utf8"),
        errors,
    );
    if (grammar === undefined || errors.length > 0) {
        throw new Error(
            `Failed to parse PowerShell grammar: ${errors.join("; ")}`,
        );
    }
    const nfa = compileGrammarToNFA(grammar, "powershell");
    return (input: string) => {
        const result = matchNFA(nfa, input.toLowerCase().split(/\s+/), false);
        return result.matched ? result.actionValue : undefined;
    };
}

function makeFlow(): PowerShellFlowDefinition {
    return {
        version: 1,
        actionName: "cleanup",
        displayName: "Cleanup",
        description: "Remove temporary files",
        parameters: [
            {
                name: "path",
                type: "path",
                required: true,
                description: "Directory to clean",
                default: "$env:TEMP",
            },
        ],
        scriptRef: "scripts/cleanup.ps1",
        expectedOutputFormat: "text",
        grammarPatterns: [
            {
                pattern: "clean temporary files",
                isAlias: true,
                examples: [],
            },
        ],
        sandbox: {
            allowedCmdlets: ["Get-ChildItem", "Remove-Item"],
            allowedPaths: ["$env:TEMP"],
            allowedModules: ["Microsoft.PowerShell.Management"],
            maxExecutionTime: 30,
            networkAccess: false,
        },
        source: { type: "manual", timestamp: "2026-07-31T00:00:00.000Z" },
    };
}

describe("showPowerShellFlow", () => {
    it("matches an anchored natural-language request", () => {
        const match = makeMatcher();

        expect(match("show powershell flow cleanup")).toEqual({
            actionName: "showPowerShellFlow",
            parameters: { flowName: "cleanup" },
        });
    });

    it("formats the same details used by command and action paths", () => {
        const text = formatPowerShellFlowDetails(
            makeFlow(),
            "param($path)\nGet-ChildItem $path",
            4,
        );

        expect(text).toMatch(/Flow: cleanup/);
        expect(text).toMatch(/Usage Count: 4/);
        expect(text).toMatch(
            /path \(path, required\).*\[default: \$env:TEMP\]/,
        );
        expect(text).toMatch(/"clean temporary files" \(alias\)/);
        expect(text).toMatch(/Cmdlets: Get-ChildItem, Remove-Item/);
        expect(text).toMatch(/```powershell\nparam\(\$path\)/);
    });

    it("links the show command to the action", async () => {
        const descriptors = (await instantiate().getCommands!({} as any)) as
            | CommandDescriptor
            | CommandDescriptorTable;
        expect("commands" in descriptors).toBe(true);
        const table = descriptors as CommandDescriptorTable;
        expect((table.commands.show as CommandDescriptor).action).toBe(
            "showPowerShellFlow",
        );
    });

    it("keeps show and execute actions in the runtime-generated schema", () => {
        const store = Object.create(
            PowerShellStore.prototype,
        ) as PowerShellStore;
        (store as any).index = { flows: {} };

        const schema = store.generateDynamicSchemaText();

        expect(schema).toMatch(/export type ShowPowerShellFlow/);
        expect(schema).toMatch(/export type ExecutePowerShellFlow/);
        expect(schema).toMatch(
            /PowerShellActions[\s\S]*ShowPowerShellFlow[\s\S]*ExecutePowerShellFlow/,
        );
    });
});
