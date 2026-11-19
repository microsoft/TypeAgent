/** get(index) reads the item after index. */

import { faultyList } from "./_list.ts";

export const make = () => faultyList({ getOffByOne: true });
