// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Built-in lever registrations. Each lever ships in its own module; this
// file is the single import-time aggregation point.
//
// To add a new lever: write `levers/<name>.ts` exporting a `LeverPlugin`
// constant, then add one line below. `@collision optimize list-levers` and
// the case loop will pick it up automatically.

import { registerLever } from "../registry.js";
import { jsdocLever } from "./jsdoc.js";
import { manifestLever } from "./manifest.js";
import { fewshotLever } from "./fewshot.js";
import { pruneLever } from "./prune.js";

let initialized = false;

/**
 * Idempotent registration. Call from the optimize handler's setup path —
 * not at module load — so test files can `_clearRegistryForTest()` then
 * re-initialize without import-order surprises.
 */
export function initBuiltInLevers(): void {
    if (initialized) return;
    initialized = true;
    registerLever(jsdocLever);
    registerLever(manifestLever);
    registerLever(fewshotLever);
    registerLever(pruneLever);
    // v1.1 lands: grammar.
}

/** Testing-only: reset the "have we registered?" flag so tests can replay
 *  initialization after a `_clearRegistryForTest()` call. */
export function _resetBuiltInLeversForTest(): void {
    initialized = false;
}
