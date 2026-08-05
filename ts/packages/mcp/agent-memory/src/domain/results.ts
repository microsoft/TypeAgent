// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { DomainError } from "./errors.js";

export type DomainResult<T> =
    | { readonly ok: true; readonly value: T }
    | { readonly ok: false; readonly error: DomainError };

export function domainSuccess<T>(value: T): DomainResult<T> {
    return { ok: true, value };
}

export function domainFailure<T = never>(error: DomainError): DomainResult<T> {
    return { ok: false, error };
}
