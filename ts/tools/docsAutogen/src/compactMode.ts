// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    COMPACT_EXPORTS_THRESHOLD,
    COMPACT_LINE_THRESHOLD,
} from "./lengthCaps.js";
import type { PackageInputs } from "./packageInputs.js";

/**
 * Reasons a package qualifies for compact-mode rendering. We surface
 * the reason (rather than just a boolean) so the per-run report can
 * explain *why* a doc looks abbreviated.
 */
export interface CompactDecision {
    readonly compact: boolean;
    readonly reasons: string[];
}

/**
 * Decide whether a package's docs should render in compact mode.
 *
 * Compact mode triggers when EITHER the tracked source is small
 * (< COMPACT_LINE_THRESHOLD lines) OR the package exposes very few
 * public entry points (< COMPACT_EXPORTS_THRESHOLD).
 */
export function decideCompact(inputs: PackageInputs): CompactDecision {
    const reasons: string[] = [];
    if (inputs.totalSourceLines < COMPACT_LINE_THRESHOLD) {
        reasons.push(
            `tracked src is small (${inputs.totalSourceLines} < ${COMPACT_LINE_THRESHOLD} lines)`,
        );
    }
    if (inputs.entryPoints.length < COMPACT_EXPORTS_THRESHOLD) {
        reasons.push(
            `few public exports (${inputs.entryPoints.length} < ${COMPACT_EXPORTS_THRESHOLD})`,
        );
    }
    return { compact: reasons.length > 0, reasons };
}
