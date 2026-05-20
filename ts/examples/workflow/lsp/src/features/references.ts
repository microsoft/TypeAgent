// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * References feature.
 *
 * For a symbol under the cursor, returns the declaring location plus
 * all reference sites resolving to it. When the cursor is on the
 * declaration itself we also list every reference back.
 */

import { Location, Range } from "vscode-languageserver/node.js";
import type { TextDocument } from "vscode-languageserver-textdocument";
import { getParsed } from "../parsedDocument.js";
import { fromLspPosition, toLspPosition } from "../util/position.js";
import { findReferenceAt, type SymbolDef } from "../symbolResolver.js";

export function computeReferences(
    doc: TextDocument,
    position: { line: number; character: number },
    includeDeclaration: boolean,
): Location[] | null {
    const parsed = getParsed(doc);
    if (!parsed.symbols) return null;

    const { line, col } = fromLspPosition(position);
    let def: SymbolDef | undefined = findReferenceAt(
        parsed.symbols,
        line,
        col,
    )?.def;
    if (!def) {
        def = parsed.symbols.defs.find(
            (d) =>
                d.loc.line === line &&
                col >= d.loc.col &&
                col <= d.loc.col + d.name.length,
        );
    }
    if (!def) return null;

    const locs: Location[] = [];
    if (includeDeclaration) {
        locs.push(locationOf(doc.uri, def.loc, def.name.length));
    }
    for (const ref of parsed.symbols.refs) {
        if (ref.def === def) {
            locs.push(locationOf(doc.uri, ref.loc, ref.name.length));
        }
    }
    return locs;
}

function locationOf(
    uri: string,
    loc: { line: number; col: number },
    length: number,
): Location {
    const start = toLspPosition(loc);
    const range: Range = {
        start,
        end: { line: start.line, character: start.character + length },
    };
    return { uri, range };
}
