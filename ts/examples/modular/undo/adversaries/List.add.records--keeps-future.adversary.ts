/** add leaves future as it was, so redo still offers what was undone. */

import { faultyList } from "./_list.ts";

export const make = () => faultyList({ addKeepsFuture: true });
