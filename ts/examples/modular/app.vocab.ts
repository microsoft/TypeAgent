/**
 * Vocabulary for rule expressions about app.ts: the parts an app was made
 * with. Re-exports the vocabulary of the files app.ts imports.
 *
 * @module
 */

import type { App, AppParts } from "./app.ts";

export * from "./chrome.vocab.ts";

/** Ghost state: the parts an app was made with. */
export declare function parts(app: App): AppParts;
