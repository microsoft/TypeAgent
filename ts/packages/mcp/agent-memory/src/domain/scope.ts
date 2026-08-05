// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { invalidArgument } from "./errors.js";
import type { ScopeId } from "./ids.js";

export type MemoryScope = {
    userId: string;
    agentId?: string;
    workspaceId?: string;
    sessionId?: string;
};

export type AccessScope = Readonly<MemoryScope> & {
    scopeId: ScopeId;
};

export function createAccessScope(
    scopeId: ScopeId,
    scope: MemoryScope,
): AccessScope {
    const userId = requireScopePart(scope.userId, "userId");

    return Object.freeze({
        scopeId,
        userId,
        ...optionalScopePart("agentId", scope.agentId),
        ...optionalScopePart("workspaceId", scope.workspaceId),
        ...optionalScopePart("sessionId", scope.sessionId),
    });
}

export function scopesEqual(left: MemoryScope, right: MemoryScope): boolean {
    return (
        left.userId === right.userId &&
        left.agentId === right.agentId &&
        left.workspaceId === right.workspaceId &&
        left.sessionId === right.sessionId
    );
}

function requireScopePart(value: string, name: string): string {
    const normalized = value.trim();
    if (normalized.length === 0) {
        return invalidArgument(`${name} must not be empty`, { name });
    }
    return normalized;
}

function optionalScopePart<TName extends keyof MemoryScope>(
    name: TName,
    value: string | undefined,
): Partial<Pick<MemoryScope, TName>> {
    if (value === undefined) {
        return {};
    }
    return { [name]: requireScopePart(value, name) } as Partial<
        Pick<MemoryScope, TName>
    >;
}
