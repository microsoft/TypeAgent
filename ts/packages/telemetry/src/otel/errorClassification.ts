// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Turns an arbitrary thrown value into bounded, low-cardinality fields that
 * are safe to export.
 *
 * Free-text messages are never parsed or exported: a message is the part of an
 * error most likely to contain a prompt, path, or user request. Signals are
 * only an explicit classification from the thrower, `error.name`,
 * `error.code` (allowlisted), and an HTTP failure status (400-599).
 *
 * Precedence: the `cause` chain is walked outermost first and the first link
 * carrying a recognized signal wins, with every reported field read from that
 * same link, so a cause's `ECONNRESET` is never reported next to its wrapper's
 * HTTP 401. Within a link: explicit, then name, then code, then status.
 *
 * Never throws - a thrown value is hostile-shaped input (throwing getters,
 * revocable proxies), so classification must not replace the failure it was
 * asked to describe.
 */

export const TELEMETRY_ERROR_CATEGORIES = [
    "authentication",
    "authorization",
    "rate_limit",
    "network",
    "timeout",
    "validation",
    "provider",
    "cancelled",
    "internal",
] as const;

/** Closed, low-cardinality set: safe as a metric dimension or span attribute. */
export type TelemetryErrorCategory =
    (typeof TELEMETRY_ERROR_CATEGORIES)[number];

/**
 * A code allowed to leave the process: a member of
 * {@link TELEMETRY_ERROR_CODES}. A `string` alias rather than a literal union
 * so a package can declare a constant without importing a generated type; the
 * allowlist is the runtime authority either way.
 */
export type TelemetryErrorCode = string;

/**
 * The export-safe view of a failure. Optional fields are omitted rather than
 * guessed when the error carries no evidence for them.
 */
export interface TelemetryErrorClassification {
    readonly errorCategory: TelemetryErrorCategory;
    /** A reviewed code from {@link TELEMETRY_ERROR_CODES}. */
    readonly errorCode?: TelemetryErrorCode;
    /** HTTP status when the failure carries one, in the range 400-599. */
    readonly httpStatus?: number;
    /** Whether retrying the same operation could plausibly succeed. */
    readonly retryable?: boolean;
}

/**
 * Properties a package sets on its own error type to classify it. Values
 * outside {@link TELEMETRY_ERROR_CATEGORIES} / {@link TELEMETRY_ERROR_CODES}
 * are ignored.
 */
export interface TelemetryClassifiedError {
    readonly errorCategory: TelemetryErrorCategory;
    readonly errorCode?: TelemetryErrorCode;
    readonly retryable?: boolean;
}

type CategoryRule = {
    readonly category: TelemetryErrorCategory;
    // Omitted when retryability genuinely depends on the situation.
    readonly retryable?: boolean;
};

/**
 * Standard platform error names (DOM, Node, undici) only. A package with its
 * own typed error attaches `errorCategory` to it instead (see
 * {@link TelemetryClassifiedError}).
 */
const CATEGORY_BY_ERROR_NAME: ReadonlyMap<string, CategoryRule> = new Map([
    ["AbortError", { category: "cancelled", retryable: false }],
    ["TimeoutError", { category: "timeout", retryable: true }],
    ["HeadersTimeoutError", { category: "timeout", retryable: true }],
    ["BodyTimeoutError", { category: "timeout", retryable: true }],
    ["ConnectTimeoutError", { category: "timeout", retryable: true }],
    ["FetchError", { category: "network", retryable: true }],
    ["SocketError", { category: "network", retryable: true }],
] as const);

/** Standard Node/undici `error.code` values that also determine a category. */
const CATEGORY_BY_ERROR_CODE: ReadonlyMap<string, CategoryRule> = new Map([
    ["ABORT_ERR", { category: "cancelled", retryable: false }],
    ["ETIMEDOUT", { category: "timeout", retryable: true }],
    ["ESOCKETTIMEDOUT", { category: "timeout", retryable: true }],
    ["UND_ERR_HEADERS_TIMEOUT", { category: "timeout", retryable: true }],
    ["UND_ERR_BODY_TIMEOUT", { category: "timeout", retryable: true }],
    ["UND_ERR_CONNECT_TIMEOUT", { category: "timeout", retryable: true }],
    ["ERR_SOCKET_CONNECTION_TIMEOUT", { category: "timeout", retryable: true }],
    ["ECONNREFUSED", { category: "network", retryable: true }],
    ["ECONNRESET", { category: "network", retryable: true }],
    ["ECONNABORTED", { category: "network", retryable: true }],
    ["EHOSTUNREACH", { category: "network", retryable: true }],
    ["ENETUNREACH", { category: "network", retryable: true }],
    ["ENETDOWN", { category: "network", retryable: true }],
    ["ENOTFOUND", { category: "network", retryable: true }],
    ["EAI_AGAIN", { category: "network", retryable: true }],
    ["EPIPE", { category: "network", retryable: true }],
    ["EPROTO", { category: "network", retryable: true }],
    ["UND_ERR_SOCKET", { category: "network", retryable: true }],
    // TLS trust failures are network-layer but never fix themselves on retry.
    ["CERT_HAS_EXPIRED", { category: "network", retryable: false }],
    ["DEPTH_ZERO_SELF_SIGNED_CERT", { category: "network", retryable: false }],
    ["SELF_SIGNED_CERT_IN_CHAIN", { category: "network", retryable: false }],
    [
        "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
        { category: "network", retryable: false },
    ],
] as const);

/**
 * Reviewed codes that are safe to export but imply no category on their own;
 * reported alongside whatever category the rest of the link established.
 */
const UNCATEGORIZED_ERROR_CODES = [
    "EACCES",
    "EADDRINUSE",
    "EADDRNOTAVAIL",
    "EBUSY",
    "EEXIST",
    "EISDIR",
    "EMFILE",
    "ENOENT",
    "ENOMEM",
    "ENOSPC",
    "ENOTDIR",
    "EPERM",
    "ERR_INVALID_ARG_TYPE",
    "ERR_INVALID_ARG_VALUE",
    "ERR_INVALID_URL",
    "ERR_OUT_OF_RANGE",
    "ERR_STREAM_PREMATURE_CLOSE",
    "UND_ERR_ABORTED",
    "UND_ERR_DESTROYED",
    "UND_ERR_RESPONSE_STATUS_CODE",
] as const;

/**
 * The closed set of codes this module will ever export. A code becomes a
 * log/metric label, so a shape check is not enough: an identifier-shaped
 * `code` (GUID, account name, key) would pass a pattern and then either blow
 * up label cardinality or carry an identifier off the machine. Adding a code
 * is a reviewed change here.
 */
export const TELEMETRY_ERROR_CODES: readonly TelemetryErrorCode[] =
    Object.freeze([
        ...CATEGORY_BY_ERROR_CODE.keys(),
        ...UNCATEGORIZED_ERROR_CODES,
    ]);

const TELEMETRY_ERROR_CODE_SET: ReadonlySet<string> = new Set(
    TELEMETRY_ERROR_CODES,
);

/** HTTP statuses that callers can generally retry safely. */
const RETRYABLE_HTTP_STATUSES: ReadonlySet<number> = new Set([
    408, 429, 500, 502, 503, 504,
]);

/** Numeric properties an HTTP status is conventionally exposed under. */
const HTTP_STATUS_PROPERTIES = ["status", "statusCode", "httpStatus"] as const;

/**
 * How far the `cause` chain is walked - deep enough for the wrapping `fetch`,
 * undici, and the Azure SDKs do, shallow enough to bound a hostile chain.
 */
const MAX_CAUSE_DEPTH = 8;

const INTERNAL_CLASSIFICATION: TelemetryErrorClassification = Object.freeze({
    errorCategory: "internal",
});

/**
 * Normalize any thrown value into bounded, export-safe fields. Never throws
 * and never returns the message, stack, or any other free-text content. An
 * unrecognized value is reported as `internal`.
 */
export function classifyTelemetryError(
    error: unknown,
): TelemetryErrorClassification {
    return classifyTelemetryErrorIfRecognized(error) ?? INTERNAL_CLASSIFICATION;
}

/**
 * As {@link classifyTelemetryError}, but an unrecognized value yields
 * `undefined` instead of `internal`.
 *
 * `internal` is a claim, not an absence: it says the failure came from our own
 * code. Use this where a classification is attached to a value whose caller
 * already has a truer default (the transport reporting `provider` for a failed
 * model call, say). Never throws.
 */
export function classifyTelemetryErrorIfRecognized(
    error: unknown,
): TelemetryErrorClassification | undefined {
    try {
        return classifyErrorChain(collectErrorChain(error));
    } catch {
        // Every read below is already guarded; a telemetry helper must still
        // never replace the failure it was asked to describe.
        return undefined;
    }
}

/**
 * The single cancellation test for spans, structured events, and the model
 * wrapper, so a span status and the log record next to it cannot disagree.
 *
 * `cancelledHint` (typically "the abort signal fired") stands on its own,
 * because a cancellation often surfaces as an unrelated-looking failure once
 * the signal has torn the work down.
 */
export function isTelemetryCancellation(
    error: unknown,
    cancelledHint?: boolean,
): boolean {
    return (
        cancelledHint === true ||
        classifyTelemetryErrorIfRecognized(error)?.errorCategory === "cancelled"
    );
}

/**
 * Classify an HTTP failure status for a caller that holds a status but no
 * error object. `undefined` for a non-failure status, so the caller omits the
 * classification rather than inventing one.
 */
export function classifyTelemetryHttpStatus(
    status: number,
): TelemetryErrorClassification | undefined {
    if (!isHttpFailureStatus(status)) {
        return undefined;
    }
    const rule = ruleForHttpStatus(status);
    return {
        errorCategory: rule.category,
        httpStatus: status,
        ...(rule.retryable === undefined ? {} : { retryable: rule.retryable }),
    };
}

/**
 * Where a classification is stashed on a non-error value. `Symbol.for` so it
 * cannot collide with a domain property, is skipped by `JSON.stringify` and
 * `Object.keys`, and resolves identically across two copies of this package.
 */
const CLASSIFICATION_CARRIER = Symbol.for(
    "typeagent.telemetry.errorClassification",
);

/**
 * Record a classification on a value that reports failure without throwing.
 *
 * `typechat`'s `Result` failure is `{ success: false, message }`, so the facts
 * known at the transport layer (HTTP status, socket error) are otherwise
 * flattened into prose that telemetry must not parse. The property is
 * non-enumerable, so spreads, `Object.keys`, and deep-equality assertions are
 * unaffected. Returns the same object and never throws.
 */
export function attachTelemetryErrorClassification<T extends object>(
    target: T,
    classification: TelemetryErrorClassification,
): T {
    try {
        Object.defineProperty(target, CLASSIFICATION_CARRIER, {
            value: classification,
            enumerable: false,
            configurable: true,
            writable: true,
        });
    } catch {
        // A frozen or sealed result is not worth failing the call over.
    }
    return target;
}

/**
 * Read back a classification attached by
 * {@link attachTelemetryErrorClassification}. Re-validated against the same
 * closed vocabularies, so a stale or forged carrier cannot smuggle an
 * unbounded field into an export.
 */
export function readTelemetryErrorClassification(
    value: unknown,
): TelemetryErrorClassification | undefined {
    if (value === null || typeof value !== "object") {
        return undefined;
    }
    let carried: unknown;
    try {
        carried = (value as Record<symbol, unknown>)[CLASSIFICATION_CARRIER];
    } catch {
        return undefined;
    }
    return sanitizeClassification(carried);
}

function sanitizeClassification(
    value: unknown,
): TelemetryErrorClassification | undefined {
    if (value === null || typeof value !== "object") {
        return undefined;
    }
    const category = readStringProperty(value, "errorCategory");
    if (category === undefined || !isTelemetryErrorCategory(category)) {
        return undefined;
    }
    const errorCode = readAllowlistedCode(value, "errorCode");
    const httpStatus = readProperty(value, "httpStatus");
    const retryable = readProperty(value, "retryable");
    return {
        errorCategory: category,
        ...(errorCode === undefined ? {} : { errorCode }),
        ...(typeof httpStatus === "number" && isHttpFailureStatus(httpStatus)
            ? { httpStatus }
            : {}),
        ...(typeof retryable === "boolean" ? { retryable } : {}),
    };
}

/**
 * Read one property without trusting the object: a getter can throw and a
 * proxy can be revoked between reads.
 */
function readProperty(node: object, key: string): unknown {
    try {
        return (node as Record<string, unknown>)[key];
    } catch {
        return undefined;
    }
}

function readStringProperty(node: object, key: string): string | undefined {
    const value = readProperty(node, key);
    return typeof value === "string" ? value : undefined;
}

/**
 * Flatten the `cause` chain (and the first entry of an `AggregateError`) into
 * an ordered list, outermost first. Bounded by {@link MAX_CAUSE_DEPTH} and a
 * visited set so a cyclic chain terminates.
 */
function collectErrorChain(error: unknown): readonly object[] {
    const chain: object[] = [];
    const visited = new Set<object>();
    let current: unknown = error;
    while (
        chain.length < MAX_CAUSE_DEPTH &&
        current !== null &&
        typeof current === "object" &&
        !visited.has(current)
    ) {
        visited.add(current);
        chain.push(current);
        // An unreadable `cause` must not discard the links already collected.
        try {
            current = nextInChain(current);
        } catch {
            break;
        }
    }
    return chain;
}

function nextInChain(node: object): unknown {
    const cause = readProperty(node, "cause");
    if (cause !== undefined) {
        return cause;
    }
    // Only the first aggregated error is followed, to keep the cost bounded.
    const errors = readProperty(node, "errors");
    try {
        // `Array.isArray` throws on a revoked proxy rather than returning
        // false, so it and the index read are both inside the guard.
        return Array.isArray(errors) ? errors[0] : undefined;
    } catch {
        return undefined;
    }
}

/**
 * Report the first link carrying a recognized signal, with every field read
 * from that link (see the precedence contract at the top of the module).
 */
function classifyErrorChain(
    chain: readonly object[],
): TelemetryErrorClassification | undefined {
    for (const node of chain) {
        const classification = classifyNode(node);
        if (classification !== undefined) {
            return classification;
        }
    }
    return undefined;
}

function classifyNode(node: object): TelemetryErrorClassification | undefined {
    const explicit = readExplicitClassification(node);
    const errorCode = explicit?.errorCode ?? readAllowlistedCode(node, "code");
    const httpStatus = readHttpStatus(node);
    const rule =
        explicit?.rule ??
        readNameRule(node) ??
        (errorCode === undefined
            ? undefined
            : CATEGORY_BY_ERROR_CODE.get(errorCode)) ??
        (httpStatus === undefined ? undefined : ruleForHttpStatus(httpStatus));
    if (rule === undefined && errorCode === undefined) {
        // Keep walking rather than reporting an `internal` that a cause could
        // have explained.
        return undefined;
    }
    return {
        errorCategory: rule?.category ?? "internal",
        ...(errorCode === undefined ? {} : { errorCode }),
        ...(httpStatus === undefined ? {} : { httpStatus }),
        ...(rule?.retryable === undefined ? {} : { retryable: rule.retryable }),
    };
}

function readNameRule(node: object): CategoryRule | undefined {
    const name = readStringProperty(node, "name");
    return name === undefined ? undefined : CATEGORY_BY_ERROR_NAME.get(name);
}

/** Read a code from `key`, keeping it only if it is in the allowlist. */
function readAllowlistedCode(
    node: object,
    key: "code" | "errorCode",
): TelemetryErrorCode | undefined {
    const code = readStringProperty(node, key);
    return code !== undefined && TELEMETRY_ERROR_CODE_SET.has(code)
        ? code
        : undefined;
}

type ExplicitClassification = {
    readonly rule?: CategoryRule;
    readonly errorCode?: TelemetryErrorCode;
};

/**
 * Read the classification a thrower declared on its own error type.
 * `undefined` when it declared neither a usable category nor an allowlisted
 * code, so the link falls through to the platform signals.
 */
function readExplicitClassification(
    node: object,
): ExplicitClassification | undefined {
    const errorCode = readAllowlistedCode(node, "errorCode");
    const category = readStringProperty(node, "errorCategory");
    if (category === undefined || !isTelemetryErrorCategory(category)) {
        return errorCode === undefined ? undefined : { errorCode };
    }
    const retryable = readProperty(node, "retryable");
    return {
        rule: {
            category,
            ...(typeof retryable === "boolean" ? { retryable } : {}),
        },
        ...(errorCode === undefined ? {} : { errorCode }),
    };
}

function isTelemetryErrorCategory(
    value: string,
): value is TelemetryErrorCategory {
    return (TELEMETRY_ERROR_CATEGORIES as readonly string[]).includes(value);
}

function ruleForHttpStatus(status: number): CategoryRule {
    const retryable = RETRYABLE_HTTP_STATUSES.has(status);
    return { category: categoryForHttpStatus(status), retryable };
}

function categoryForHttpStatus(status: number): TelemetryErrorCategory {
    switch (status) {
        case 401:
            return "authentication";
        case 403:
            return "authorization";
        case 408:
        case 504:
            return "timeout";
        case 429:
            return "rate_limit";
    }
    // Only failure statuses reach here: the remaining 4xx say the request was
    // unacceptable, 5xx is the provider failing an acceptable request.
    return status < 500 ? "validation" : "provider";
}

/**
 * Read an HTTP failure status off the node or its `response`. `cause` is
 * deliberately not followed: the chain walk visits it as its own link, so
 * following it here would let a cause's status pre-empt that same cause's more
 * specific `name`/`code`.
 */
function readHttpStatus(node: object): number | undefined {
    const own = readOwnHttpStatus(node);
    if (own !== undefined) {
        return own;
    }
    const response = readProperty(node, "response");
    return response !== null && typeof response === "object"
        ? readOwnHttpStatus(response)
        : undefined;
}

function readOwnHttpStatus(node: object): number | undefined {
    for (const property of HTTP_STATUS_PROPERTIES) {
        const value = readProperty(node, property);
        if (typeof value === "number" && isHttpFailureStatus(value)) {
            return value;
        }
    }
    return undefined;
}

function isHttpFailureStatus(value: number): boolean {
    return Number.isInteger(value) && value >= 400 && value <= 599;
}
