// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Definition feature: jump from an identifier reference to its
 * declaring location.
 *
 * Only resolves DSL-bound names (params, consts, lambda params).
 * Task names point into builtin code we don't ship sources for, so we
 * return `null` for those.
 */

import { Location, Range } from "vscode-languageserver/node.js";
import type { TextDocument } from "vscode-languageserver-textdocument";
import { getParsed } from "../parsedDocument.js";
import { fromLspPosition, toLspPosition } from "../util/position.js";
import { findReferenceAt } from "../symbolResolver.js";

export function computeDefinition(
    doc: TextDocument,
    position: { line: number; character: number },
): Location | null {
    const parsed = getParsed(doc);
    if (!parsed.symbols) return null;

    const { line, col } = fromLspPosition(position);
    const ref = findReferenceAt(parsed.symbols, line, col);
    if (!ref?.def) return null;

    const start = toLspPosition(ref.def.loc);
    const range: Range = {
        start,
        end: {
            line: start.line,
            character: start.character + ref.def.name.length,
        },
    };
    return { uri: doc.uri, range };
}
