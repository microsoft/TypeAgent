/** add appends, ignoring its index. */

import { faultyList } from "./_list.ts";

export const make = () => faultyList({ addAppends: true });
