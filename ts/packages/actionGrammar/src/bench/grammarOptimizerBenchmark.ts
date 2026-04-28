// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Optimizer benchmark — informational only.
 *
 * Measures matcher-time impact of each grammar optimization pass on real
 * grammars (player, list, calendar, browser, ...).  Each configuration is
 * compared against the unoptimized baseline.
 *
 * Run with: `pnpm run bench:real` (from this package directory).
 */

import * as path from "path";
import * as fs from "fs";
import { fileURLToPath } from "url";
import { registerBuiltInEntities } from "../builtInEntities.js";
import { runScenarios, Scenario } from "./benchUtil.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function fileExists(p: string): boolean {
    try {
        fs.accessSync(p, fs.constants.R_OK);
        return true;
    } catch {
        return false;
    }
}

/**
 * Try to load `grammarPath` and return a ready Scenario, or
 * `undefined` (with a `[skip]` log) if the file can't be read.
 * Mirrors the previous `benchmarkFile` skip behavior so a missing
 * agent grammar doesn't abort the whole run.
 */
function loadScenario(
    label: string,
    grammarPath: string,
    requests: string[],
): Scenario | undefined {
    if (!fileExists(grammarPath)) {
        console.log(`[skip] ${label}: grammar not found at ${grammarPath}`);
        return undefined;
    }
    return {
        label,
        grammarName: path.basename(grammarPath),
        grammarText: fs.readFileSync(grammarPath, "utf-8"),
        requests,
    };
}

function main(): void {
    registerBuiltInEntities();

    // Grammar paths are resolved relative to this file's compiled
    // location (`dist/bench/`).  They point at sibling agent packages
    // via `../../../agents/<name>/...` and assume the standard
    // `packages/` layout in the workspace.  If an agent grammar moves
    // or the dist layout changes, the `[skip]` branch in `loadScenario`
    // keeps the script running and prints a clear diagnostic.
    const candidates: (Scenario | undefined)[] = [
        loadScenario(
            "player",
            path.resolve(
                __dirname,
                "../../../agents/player/src/agent/playerSchema.agr",
            ),
            [
                "pause",
                "resume",
                "play Shake It Off by Taylor Swift",
                "select kitchen",
                "set volume to 50",
                "play the first track",
                "skip to the next track",
                "play some music",
            ],
        ),
        loadScenario(
            "list",
            path.resolve(__dirname, "../../../agents/list/src/listSchema.agr"),
            [
                "add apples to grocery list",
                "remove milk from grocery list",
                "create list shopping",
                "clear grocery list",
            ],
        ),
        loadScenario(
            "calendar",
            path.resolve(
                __dirname,
                "../../../agents/calendar/src/calendarSchema.agr",
            ),
            [
                "schedule meeting tomorrow at 3pm",
                "cancel my 2pm meeting",
                "show my calendar",
            ],
        ),
    ];
    const scenarios = candidates.filter((s): s is Scenario => s !== undefined);
    runScenarios(scenarios);
}

main();
