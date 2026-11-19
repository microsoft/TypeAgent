/** canUndo isn't updated by undo. */

import { faultyList } from "./_list.ts";

export const make = () => faultyList({ staleCanUndo: true });
