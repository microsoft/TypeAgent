/** remove records an empty text, so undoing it can't restore the item. */

import { faultyList } from "./_list.ts";

export const make = () => faultyList({ removeForgetsText: true });
