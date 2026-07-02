// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * A pure, vscode-free description of a tree-row hover card. The presentation
 * modules build these so the labelling can be unit-tested without the editor
 * host; {@link ../baseTreeProvider} renders one into a `vscode.MarkdownString`
 * so every Studio view gets the same bordered, bold-label hover cards.
 */

export interface TooltipField {
    /** The field name, shown bold (e.g. "Agent", "Schema"). */
    label: string;
    /** The field value, shown after the label. */
    value: string;
    /** Render the value in inline `code` style (hashes, paths, ids). */
    mono?: boolean;
}

export interface TooltipModel {
    /** Optional bold heading rendered above the fields. */
    title?: string;
    /** The body rows, one per line. */
    fields: TooltipField[];
    /** Optional trailing italic note, e.g. an affordance hint. */
    hint?: string;
}

/** A tooltip that is just a descriptive note (no field rows). */
export function noteTooltip(hint: string): TooltipModel {
    return { fields: [], hint };
}
