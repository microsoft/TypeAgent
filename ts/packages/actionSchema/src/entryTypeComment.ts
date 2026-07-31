// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import ts from "typescript";

/**
 * Remove a documentation comment attached directly (no blank line) above the
 * entry union `export type <EntryTypeName> = ...`. The action schema parser
 * (and the action-schema compiler) treat such a comment as an "entry type
 * comment" and reject it because entry-type comments are not used for prompts.
 * Comments separated by a blank line, and comments on individual action types,
 * are preserved.
 *
 * Uses the TypeScript parser to locate the entry type alias (robust against
 * formatting/whitespace variants — and against schema-looking text inside
 * string literals — that a source-text regex would mishandle), then strips
 * only the contiguous comment block that abuts the declaration. Returns the
 * source unchanged when the entry type is absent or has no attached comment.
 */
export function stripEntryTypeComment(
    schemaTs: string,
    entryTypeName: string,
): string {
    const source = ts.createSourceFile(
        "schema.ts",
        schemaTs,
        ts.ScriptTarget.Latest,
        /* setParentNodes */ true,
    );

    const alias = source.statements.find(
        (s): s is ts.TypeAliasDeclaration =>
            ts.isTypeAliasDeclaration(s) && s.name.text === entryTypeName,
    );
    if (alias === undefined) return schemaTs;

    const declStart = alias.getStart(source, /* includeJsDocComment */ false);
    const comments =
        ts.getLeadingCommentRanges(schemaTs, alias.getFullStart()) ?? [];
    if (comments.length === 0) return schemaTs;

    // Walk the leading comments from the one nearest the declaration upward,
    // keeping those with no blank line between them and the following token. A
    // blank line marks the boundary of the comment block that "belongs" to the
    // entry type, so anything above it (e.g. the file header) is preserved.
    const hasBlankLine = (text: string) =>
        (text.match(/\n/g)?.length ?? 0) >= 2;

    let blockStart = -1;
    let nextStart = declStart;
    for (let i = comments.length - 1; i >= 0; i--) {
        const c = comments[i];
        if (hasBlankLine(schemaTs.slice(c.end, nextStart))) break;
        blockStart = c.pos;
        nextStart = c.pos;
    }
    if (blockStart < 0) return schemaTs;

    // Drop the attached comment block (trimming any indentation left on its
    // first line), then collapse the blank-line run the removal may create.
    const before = schemaTs.slice(0, blockStart).replace(/[ \t]+$/, "");
    const after = schemaTs.slice(declStart);
    return (before + after).replace(/\n{3,}/g, "\n\n");
}
