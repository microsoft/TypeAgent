// Checks that the browser's DOM types fit the subset cut from them in
// dom.ts. See canvas.check.ts.
import type { DomDocument, DomElement } from "../dom.ts";

const doc = null as unknown as Document;
const element = null as unknown as HTMLElement;
export const fitsDocument: DomDocument = doc;
export const fitsElement: DomElement = element;
