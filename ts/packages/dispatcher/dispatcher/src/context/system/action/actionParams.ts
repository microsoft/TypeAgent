// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/** Returns `{ [key]: value }` when value is defined, `{}` otherwise. */
export function opt<T>(value: T | undefined, key: string): Record<string, T> {
    return value !== undefined ? { [key]: value } : {};
}

// Reads `parameters` off an action union. Action schemas mix members that have
// no `parameters` at all with members whose `parameters` is optional, so a
// direct `action.parameters` doesn't type check and throws at runtime when the
// translator omits it. Returning `{}` for both cases lets each switch case read
// its fields and fall back to the command's default.
export function actionParams(action: { actionName: string }): any {
    return (action as { parameters?: any }).parameters ?? {};
}
