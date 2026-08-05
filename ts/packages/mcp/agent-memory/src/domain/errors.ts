// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type DomainErrorCode =
    | "IDEMPOTENCY_CONFLICT"
    | "INVALID_ARGUMENT"
    | "INVALID_STATE_TRANSITION"
    | "INVARIANT_VIOLATION"
    | "NOT_FOUND"
    | "REVISION_CONFLICT"
    | "SCOPE_MISMATCH";

export class DomainError extends Error {
    public readonly code: DomainErrorCode;
    public readonly details: Readonly<Record<string, unknown>> | undefined;

    public constructor(
        code: DomainErrorCode,
        message: string,
        details?: Readonly<Record<string, unknown>>,
    ) {
        super(message);
        this.name = "DomainError";
        this.code = code;
        this.details = details;
    }
}

export function invariant(
    condition: unknown,
    message: string,
    details?: Readonly<Record<string, unknown>>,
): asserts condition {
    if (!condition) {
        throw new DomainError("INVARIANT_VIOLATION", message, details);
    }
}

export function invalidArgument(
    message: string,
    details?: Readonly<Record<string, unknown>>,
): never {
    throw new DomainError("INVALID_ARGUMENT", message, details);
}
