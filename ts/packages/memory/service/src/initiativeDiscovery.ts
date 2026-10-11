// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export function normalizeInitiativeSelector(value: string): string {
    return value
        .trim()
        .toLocaleLowerCase()
        .replace(/[_\s]+/g, " ");
}

export function isInitiativeSubject(
    name: string,
    types: readonly string[],
    indexedText: string,
): boolean {
    const query = normalizeInitiativeSelector(name);
    if (!query || query.length > 200 || !/\p{L}/u.test(query)) return false;
    if (
        /^(project|initiative|program|charter|goals?|scope|objectives?|goals? and scope)$/i.test(
            query,
        )
    )
        return false;
    const typed = types.some((type) =>
        /^(project|initiative|program)$/i.test(type),
    );
    const named =
        /\b(project|initiative|program|migration|rollout|charter)\b/i.test(
            query,
        );
    if (!typed && !named) return false;
    const local = indexedText.split(/\n\s*\n/).some((paragraph) => {
        const text = normalizeInitiativeSelector(paragraph);
        return (
            text.includes(query) &&
            /\b(goal|goals|scope|objective|objectives|aim|aims|deliver|deliverables)\b/i.test(
                text,
            )
        );
    });
    if (local) return true;
    const goalHeading = /^#{1,6}\s+[^\n]*\b(goals?|scope|objectives?)\b/im.exec(
        indexedText,
    );
    if (!goalHeading) return false;
    const introduction = normalizeInitiativeSelector(
        indexedText.slice(0, goalHeading.index),
    );
    return (
        introduction.includes(query) &&
        /\b(project|initiative|program|charter)\b/i.test(introduction)
    );
}
