// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { matchGrammar } from "../src/grammarMatcher.js";
import { Grammar } from "../src/grammarTypes.js";

export const spaces =
    " \t\v\f\u00a0\ufeff\n\r\u2028\u2029\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200A\u202F\u205F\u3000";
export const escapedSpaces =
    "\\ \\t\\v\\f\\u00a0\\ufeff\\n\\r\\u2028\\u2029\\u1680\\u2000\\u2001\\u2002\\u2003\\u2004\\u2005\\u2006\\u2007\\u2008\\u2009\\u200A\\u202F\\u205F\\u3000";

export function testMatchGrammar(grammar: Grammar, request: string) {
    return matchGrammar(grammar, request)?.map((m) => m.match);
}
