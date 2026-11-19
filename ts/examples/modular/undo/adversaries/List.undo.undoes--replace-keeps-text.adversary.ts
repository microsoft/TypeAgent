/** Undoing a replace leaves the new text. */

import { faultyList } from "./_list.ts";

export const make = () => faultyList({ undoReplaceKeepsText: true });
