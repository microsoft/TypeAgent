// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
    compileGrammarToNFA,
    loadGrammarRulesNoThrow,
    matchNFA,
} from "@typeagent/action-grammar";
import type {
    CommandDescriptor,
    CommandDescriptorTable,
} from "@typeagent/agent-sdk";
import type {
    PowerShellFlowDefinition,
    PowerShellStore as PowerShellStoreType,
} from "../src/store/powerShellStore.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(here, "..", "..");
const { instantiate } = await import(
    pathToFileURL(path.join(packageRoot, "dist", "actionHandler.mjs")).href
);
const { formatPowerShellFlowDetails } = await import(
    pathToFileURL(path.join(packageRoot, "dist", "flowDetails.mjs")).href
);
const { PowerShellStore } = await import(
    pathToFileURL(
        path.join(packageRoot, "dist", "store", "powerShellStore.mjs"),
    ).href
);
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

        assert.deepEqual(match("show powershell flow cleanup"), {
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

        assert.match(text, /Flow: cleanup/);
        assert.match(text, /Usage Count: 4/);
        assert.match(text, /path \(path, required\).*\[default: \$env:TEMP\]/);
        assert.match(text, /"clean temporary files" \(alias\)/);
        assert.match(text, /Cmdlets: Get-ChildItem, Remove-Item/);
        assert.match(text, /```powershell\nparam\(\$path\)/);
    });

    it("links the show command to the action", async () => {
        const descriptors = (await instantiate().getCommands!({} as any)) as
            | CommandDescriptor
            | CommandDescriptorTable;
        assert.ok("commands" in descriptors);
        assert.equal(
            (descriptors.commands.show as CommandDescriptor).action,
            "showPowerShellFlow",
        );
    });

    it("keeps show and execute actions in the runtime-generated schema", () => {
        const store = Object.create(
            PowerShellStore.prototype,
        ) as PowerShellStoreType;
        (store as any).index = { flows: {} };

        const schema = store.generateDynamicSchemaText();

        assert.match(schema, /export type ShowPowerShellFlow/);
        assert.match(schema, /export type ExecutePowerShellFlow/);
        assert.match(
            schema,
            /PowerShellActions[\s\S]*ShowPowerShellFlow[\s\S]*ExecutePowerShellFlow/,
        );
    });
});
