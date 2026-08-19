// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/** Minimal field shape for recursive llmAsAJudge detection. */
export type GraderFieldNode = {
    verify?: string;
    item?: GraderFieldNode;
};

export type GraderByAction = {
    byAction: Record<string, { fields: Record<string, GraderFieldNode> }>;
    rulesFingerprint?: string;
};

export function fieldTreeIsLlmAsAJudge(field: GraderFieldNode): boolean {
    if (field.verify === "llmAsAJudge") return true;
    if (field.item !== undefined && fieldTreeIsLlmAsAJudge(field.item)) {
        return true;
    }
    return false;
}

/** Actions that have any verify=llmAsAJudge field (including nested item). */
export function listActionsWithLlmJudgeFields(
    catalog: GraderByAction,
): string[] {
    const out: string[] = [];
    for (const id of Object.keys(catalog.byAction).sort()) {
        const fields = catalog.byAction[id]!.fields;
        if (Object.values(fields).some((f) => fieldTreeIsLlmAsAJudge(f))) {
            out.push(id);
        }
    }
    return out;
}
