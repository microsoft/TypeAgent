// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

const MUTATION_ACTION_PATTERN =
    /\b(add|build|change|create|delete|edit|fix|format|implement|migrate|modify|refactor|remove|rename|update|write)\b/i;

export function isMutatingCodingRequest(request: string): boolean {
    return MUTATION_ACTION_PATTERN.test(request);
}
