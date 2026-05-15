// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Per-section length caps applied by the deterministic renderer and
 * enforced as part of structural validation.
 *
 * These mirror the values documented in
 * `ts/docs/architecture/doc-autogen.md` ("Length caps" section).
 */
export const FILES_OF_INTEREST_MAX = 10;
export const USED_BY_MAX = 10;
export const EXTERNAL_DEPS_MAX = 20;
export const KEY_CONCEPTS_MAX = 8;

/**
 * Overview prose word counts. The generator targets the range, the
 * structural validator hard-rejects anything beyond the cap.
 */
export const OVERVIEW_TARGET_WORDS_MIN = 250;
export const OVERVIEW_TARGET_WORDS_MAX = 400;
export const OVERVIEW_HARD_CAP_WORDS = 500;

/**
 * Total AUTOGEN block hard cap as a safety net for pathological
 * packages.
 */
export const TOTAL_BLOCK_HARD_CAP_WORDS = 2000;

/**
 * Compact-mode triggers. A package qualifies when EITHER condition
 * holds.
 */
export const COMPACT_LINE_THRESHOLD = 200;
export const COMPACT_EXPORTS_THRESHOLD = 3;
