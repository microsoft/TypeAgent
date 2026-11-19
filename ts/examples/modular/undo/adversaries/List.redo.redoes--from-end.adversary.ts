/** redo reapplies the last undone change instead of the next one. */

import { faultyList } from "./_list.ts";

export const make = () => faultyList({ redoFromEnd: true });
