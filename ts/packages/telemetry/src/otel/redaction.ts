// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { filterSecrets, type SecretFilter } from "@typeagent/common-utils";

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
 * Redact known secret values and recognizable secret formats from a
 * structured value (a log event payload or attribute bag) about to be
 * recorded as telemetry.
 *
 * The strings are combined and filtered together, rather than running every
 * secret detector separately for each nested value. The structure is rebuilt
 * without mutating the input.
 */
export function redactObject<T>(value: T, options?: RedactionOptions): T {
    const strings: string[] = [];
    collectStrings(value, strings);
    if (strings.length === 0) {
        return value;
    }

    const separator = createSeparator(strings);
    const redactedStrings = redactText(strings.join(separator), options).split(
        separator,
    );
    if (redactedStrings.length !== strings.length) {
        return mapStrings(value, (text) => redactText(text, options)) as T;
    }

    let index = 0;
    return mapStrings(value, () => redactedStrings[index++]) as T;
}

function collectStrings(value: unknown, strings: string[]): void {
    if (typeof value === "string") {
        strings.push(value);
        return;
    }
    if (!isTraversable(value)) {
        return;
    }
    for (const item of Array.isArray(value)
        ? value
        : Object.values(value as Record<string, unknown>)) {
        collectStrings(item, strings);
    }
}

function mapStrings(value: unknown, redact: (text: string) => string): unknown {
    if (typeof value === "string") {
        return redact(value);
    }
    if (!isTraversable(value)) {
        return value;
    }
    if (Array.isArray(value)) {
        return value.map((item) => mapStrings(item, redact));
    }
    return Object.fromEntries(
        Object.entries(value).map(([key, item]) => [
            key,
            mapStrings(item, redact),
        ]),
    );
}

function isTraversable(
    value: unknown,
): value is readonly unknown[] | Record<string, unknown> {
    if (value === null || typeof value !== "object") {
        return false;
    }
    if (Array.isArray(value)) {
        return true;
    }
    const proto = Object.getPrototypeOf(value);
    return proto === Object.prototype || proto === null;
}

function createSeparator(strings: readonly string[]): string {
    // Surround the marker with whitespace so detectors that use ^ or
    // whitespace as a token boundary behave as they do for each source string.
    let separator = "\n\0typeagent-otel-redaction\0\n";
    while (strings.some((text) => text.includes(separator))) {
        separator += "\0";
    }
    return separator;
}
