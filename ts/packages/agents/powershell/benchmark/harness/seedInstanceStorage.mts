// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Seeds powershell flows into instance storage by importing .ps1 scripts
 * through the live dispatcher. This tests the real import pipeline
 * (ScriptAnalyzer LLM analysis) and validates that LLM-generated grammar
 * patterns are good enough for matching.
 *
 * The approach:
 * 1. Create a temporary dispatcher with persistDir + storageProvider
 * 2. Run `@powershell import <path>` for each .ps1 script
 * 3. Close the dispatcher (flows are now in instance storage on disk)
 * 4. The caller creates a fresh dispatcher that loads the flows at startup
 *
 * This avoids the RPC reload issue — flows are written to disk during import,
 * then read back on the second dispatcher startup.
 */

import { readdirSync, readFileSync, existsSync } from "fs";
import { join } from "path";

export interface SeedResult {
    imported: number;
    failed: number;
    errors: string[];
    flowNameMap: Record<string, string>;
}

/**
 * After imports, reads the instance storage index to build a mapping from
 * canonical flow names (used in scenario files) to the actual LLM-generated
 * action names. Maps by matching description keywords to canonical names.
 */
export function buildFlowNameMap(persistDir: string): Record<string, string> {
    const indexPath = join(persistDir, "powershell", "index.json");
    if (!existsSync(indexPath)) return {};

    const index = JSON.parse(readFileSync(indexPath, "utf-8"));
    const flows = index.flows as Record<
        string,
        { actionName: string; description: string }
    >;

    // Map canonical names to description keywords for fuzzy matching
    const canonicalKeywords: Record<string, string[]> = {
        listFiles: ["list files", "directory"],
        findLargeFiles: ["large", "bigger", "size"],
        checkDiskSpace: ["disk", "drive", "space"],
        checkServiceHealth: ["service", "health", "running", "stopped"],
        checkPorts: ["port", "listener", "tcp"],
        scanLogErrors: ["log", "error", "warning", "scan"],
        filterCsv: ["csv", "filter", "transform"],
        staleBranches: ["stale", "branch", "git"],
    };

    const nameMap: Record<string, string> = {};

    for (const [actualName, flow] of Object.entries(flows)) {
        const desc = (flow.description ?? "").toLowerCase();
        const name = actualName.toLowerCase();

        for (const [canonical, keywords] of Object.entries(canonicalKeywords)) {
            if (nameMap[canonical]) continue;
            if (actualName === canonical) {
                nameMap[canonical] = actualName;
                break;
            }
            if (keywords.some((kw) => desc.includes(kw) || name.includes(kw))) {
                nameMap[canonical] = actualName;
                break;
            }
        }
    }

    return nameMap;
}

export async function seedViaImport(
    scriptsDir: string,
    persistDir: string,
    createDispatcherFn: () => Promise<{
        processCommand: (cmd: string) => Promise<unknown>;
        getDisplayText: () => string;
        close: () => Promise<void>;
    }>,
): Promise<SeedResult> {
    if (!existsSync(scriptsDir)) {
        return {
            imported: 0,
            failed: 0,
            errors: [`Scripts directory not found: ${scriptsDir}`],
            flowNameMap: {},
        };
    }

    const scripts = readdirSync(scriptsDir).filter((f) => f.endsWith(".ps1"));
    if (scripts.length === 0) {
        return {
            imported: 0,
            failed: 0,
            errors: ["No .ps1 files found"],
            flowNameMap: {},
        };
    }

    console.log(
        `\nImporting ${scripts.length} script(s) via @powershell import...`,
    );

    const dispatcher = await createDispatcherFn();
    const result: SeedResult = {
        imported: 0,
        failed: 0,
        errors: [],
        flowNameMap: {},
    };

    try {
        for (const script of scripts) {
            const scriptPath = join(scriptsDir, script);
            const cmd = `@powershell import ${scriptPath}`;
            try {
                await dispatcher.processCommand(cmd);
                const display = dispatcher.getDisplayText();
                if (
                    display.includes("Imported script flow") ||
                    display.includes("Created script flow")
                ) {
                    result.imported++;
                    console.log(`  Imported: ${script}`);
                } else if (display.includes("already exists")) {
                    result.imported++;
                    console.log(`  Already exists: ${script}`);
                } else {
                    result.failed++;
                    const errMsg = display.substring(0, 120);
                    result.errors.push(`${script}: ${errMsg}`);
                    console.log(`  Warning: ${script} — ${errMsg}`);
                }
            } catch (err) {
                result.failed++;
                result.errors.push(`${script}: ${err}`);
                console.log(`  Failed: ${script} — ${err}`);
            }
        }
    } finally {
        await dispatcher.close();
    }

    console.log(
        `  Import complete: ${result.imported} imported, ${result.failed} failed`,
    );

    result.flowNameMap = buildFlowNameMap(persistDir);
    if (Object.keys(result.flowNameMap).length > 0) {
        console.log("  Flow name mapping (canonical -> actual):");
        for (const [canonical, actual] of Object.entries(result.flowNameMap)) {
            const label = canonical === actual ? "(exact)" : `-> ${actual}`;
            console.log(`    ${canonical} ${label}`);
        }
    }

    return result;
}
