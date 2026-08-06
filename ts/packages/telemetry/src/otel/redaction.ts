// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    filterSecrets,
    filterSecretsFromObject,
    type SecretFilter,
} from "@typeagent/common-utils";

/**
 * Shared pre-record sanitization helpers for telemetry. These wrap
 * `@typeagent/common-utils`'s secret scrubber so every OTel record TypeAgent
 * creates (span attribute, log body, event) is redacted the same way before
 * it is handed to the SDK. Secret detection itself lives entirely in
 * `@typeagent/common-utils`; this module does not add or duplicate patterns.
 */

/** Options for {@link redactText} and {@link redactObject}. */
export interface RedactionOptions {
    /**
     * A stateful filter accumulating known secret values (e.g. API keys read
     * from config) as they become available. When provided, it is used
     * instead of the stateless `filterSecrets` defaults - it still applies
     * the standard secret-format detectors, plus its own registered values.
     */
    readonly secretFilter?: SecretFilter;
}

/**
 * Redact known secret values and recognizable secret formats from a string
 * about to be recorded as telemetry (a log body, an attribute value, etc.).
 */
export function redactText(text: string, options?: RedactionOptions): string {
    return options?.secretFilter
        ? options.secretFilter.filter(text)
        : filterSecrets(text);
}

/**
 * Redact known secret values and recognizable secret formats from every
 * string in a structured value (a log event payload, an attribute bag)
 * about to be recorded as telemetry. Returns a new value of the same shape;
 * non-string, non-plain-object values (numbers, booleans, `Date`, class
 * instances, ...) pass through unchanged.
 */
export function redactObject<T>(value: T, options?: RedactionOptions): T {
    const secretFilter = options?.secretFilter;
    if (!secretFilter) {
        return filterSecretsFromObject(value);
    }
    return walkStrings(value, (text) => secretFilter.filter(text)) as T;
}

/**
 * Recursively apply `redact` to every string in `value`, preserving its
 * shape. Only secret *detection* lives in `@typeagent/common-utils`
 * (`filterSecrets`); this walk exists solely to let a stateful
 * {@link SecretFilter} - which only exposes `filter(text)`, not its
 * underlying values - participate in structural redaction the same way
 * `filterSecretsFromObject` does for the stateless case above.
 */
function walkStrings(
    value: unknown,
    redact: (text: string) => string,
): unknown {
    if (typeof value === "string") {
        return redact(value);
    }
    if (value === null || typeof value !== "object") {
        return value;
    }
    if (Array.isArray(value)) {
        return value.map((item) => walkStrings(item, redact));
    }
    // Only recurse into plain objects, matching filterSecretsFromObject's
    // handling of Date, RegExp, Map, and other class instances.
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) {
        return value;
    }
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(
        value as Record<string, unknown>,
    )) {
        out[key] = walkStrings(item, redact);
    }
    return out;
}
