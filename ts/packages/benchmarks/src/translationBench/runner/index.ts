// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Translation-bench runner library.
 *
 * Public surface:
 * - suite execution (`runTranslationBench`)
 * - pure scoring (`scoreTranslationBench`, `diagnoseTranslationBench`, …)
 * - checkpoint / scale helpers
 * - HTML report rendering
 * - explainer probes
 *
 * Callers own dispatcher bootstrap (`initializeCommandHandlerContext`).
 * This package only crosses into agent-dispatcher at `translateRequest`.
 */

export * from "./runner.js";
export * from "./scale.js";
export * from "./report.js";
export * from "./explainer.js";
