/**
 * Vocabulary for rule expressions about pointer.ts: the regions under a
 * region. Re-exports the vocabulary of the files pointer.ts imports.
 *
 * @module
 */

import type { Region } from "./pointer.ts";

export * from "./geometry.vocab.ts";

/** Ghost state: the regions a region has added and not removed, in the order added. */
export declare function children(region: Region): readonly Region[];
