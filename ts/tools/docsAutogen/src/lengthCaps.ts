// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Per-section length caps applied by the deterministic renderer and
 * enforced as part of structural validation.
 *
 * These mirror the values documented in
 * `ts/docs/architecture/doc-pipeline/doc-autogen.md` ("Length caps" section).
 */
export const FILES_OF_INTEREST_MAX = 10;
export const USED_BY_MAX = 10;
export const EXTERNAL_DEPS_MAX = 20;
export const KEY_CONCEPTS_MAX = 8;
/**
 * Maximum number of agent actions the deterministic
 * `### Actions` reference subsection enumerates. Beyond this we
 * emit a "...and N more" trailer so very large schemas (e.g. the
 * Discord agent with 25+ actions) don't bloat the file.
 */
export const ACTIONS_REFERENCE_MAX = 30;

/**
 * Documentation prose word counts. The LLM targets the band; the
 * structural validator hard-rejects anything beyond the cap. Values
 * widened from Phase 4 ("thin AI Overview") to Phase 5 ("full AI
 * documentation"): the model now authors multiple sections (Overview,
 * What it does, Actions intro, Key Files, How to extend) rather
 * than a single Overview blurb.
 */
export const DOCUMENTATION_TARGET_WORDS_MIN = 500;
export const DOCUMENTATION_TARGET_WORDS_MAX = 1500;
export const DOCUMENTATION_HARD_CAP_WORDS = 2500;

/**
 * Backwards-compatible aliases so older imports keep compiling. New
 * code should reference the DOCUMENTATION_* names above.
 *
 * @deprecated Use the DOCUMENTATION_* constants instead.
 */
export const OVERVIEW_TARGET_WORDS_MIN = DOCUMENTATION_TARGET_WORDS_MIN;
/** @deprecated Use the DOCUMENTATION_* constants instead. */
export const OVERVIEW_TARGET_WORDS_MAX = DOCUMENTATION_TARGET_WORDS_MAX;
/** @deprecated Use the DOCUMENTATION_* constants instead. */
export const OVERVIEW_HARD_CAP_WORDS = DOCUMENTATION_HARD_CAP_WORDS;

/**
 * Total AUTOGEN block hard cap as a safety net for pathological
 * packages.
 */
export const TOTAL_BLOCK_HARD_CAP_WORDS = 4000;

/**
 * Compact-mode triggers. A package qualifies when EITHER condition
 * holds.
 */
export const COMPACT_LINE_THRESHOLD = 200;
export const COMPACT_EXPORTS_THRESHOLD = 3;
