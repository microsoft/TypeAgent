// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Shared normalizer that turns an arbitrary thrown value into bounded,
 * low-cardinality structured fields that are safe to export.
 *
 * Structured failure events need to answer "what kind of failure was this,
 * and is it worth retrying?" without carrying the original message, stack, or
 * any user content. This module produces exactly that: a closed
 * {@link TelemetryErrorCategory}, plus optional `errorCode`, `httpStatus`, and
 * `retryable` fields that are emitted only when they are actually known.
 *
 * Classification never parses free-text messages. A message is the one part of
 * an error most likely to contain a prompt, a file path, or a user's request,
 * and matching on its wording is both a privacy hazard and fragile across
 * provider/library versions. The only inputs are:
 *
 * 1. An explicit `errorCategory` (and optional `errorCode` / `retryable`) that
 *    the thrower attached - the opt-in extension point for a package that owns
 *    a typed error and knows how it should be classified.
 * 2. `error.name`, matched against a closed table of standard platform names
 *    (DOM, Node, undici).
 * 3. `error.code`, matched against {@link TELEMETRY_ERROR_CODES}, a closed
 *    reviewed allowlist. A code outside it is dropped rather than exported.
 * 4. An HTTP *failure* status (400-599) read from a small set of well-known
 *    numeric properties. A 1xx/2xx/3xx value is not evidence of a failure, and
 *    `status` is also used as a non-HTTP enum elsewhere (a `child_process`
 *    exit code, for instance), so those values are ignored rather than
 *    reported.
 *
 * ## Precedence
 *
 * Each error in the `cause` chain is examined in turn, outermost first, so a
 * `fetch` failure (`TypeError` wrapping a `cause` carrying `ECONNREFUSED`)
 * classifies as `network` rather than falling through. The **first link that
 * yields a recognized signal wins, and every reported field comes from that
 * one link**: category, code, status, and retryability then describe the same
 * error instead of being stitched together across links (a cause's
 * `ECONNRESET` must not be reported next to its wrapper's HTTP 401).
 *
 * Within the winning link the order is: an explicit classification from the
 * thrower, then `error.name`, then `error.code`, then an HTTP failure status.
 * A link carrying only an allowlisted code with no category rule still wins:
 * it reports that code with the `internal` category rather than dropping a
 * reviewed, useful code.
 *
 * Anything that yields no signal - a thrown string, a thrown object, or a
 * plain `Error` - becomes `internal` with no fabricated code, status, or
 * retryability. A caller that has its own truthful default for that case uses
 * {@link classifyTelemetryErrorIfRecognized} instead and gets `undefined`.
 *
 * ## Never throws
 *
 * A thrown value is hostile-shaped input: getters can throw, proxies trap
 * every operation, and a proxy can be revoked between two reads. Every
 * property access here is guarded and the entry point has a last-resort
 * fallback, so classifying a hostile error degrades to `internal` instead of
 * replacing the original failure with a telemetry one.
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

/**
 * Closed set of failure categories. Low-cardinality by construction, so it is
 * safe as a metric dimension or a log/span attribute.
 */
export type TelemetryErrorCategory =
    (typeof TELEMETRY_ERROR_CATEGORIES)[number];

/**
 * A code that is allowed to leave the process: a member of
 * {@link TELEMETRY_ERROR_CODES}. Kept as a `string` alias rather than a
 * literal union so a package can declare a constant without importing a
 * generated type; the allowlist is the runtime authority either way.
 */
export type TelemetryErrorCode = string;

/**
 * The normalized, export-safe view of a failure. Only `errorCategory` is
 * always present; the optional fields are omitted rather than guessed when the
 * error carries no evidence for them.
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
 * The properties a package sets on its own error type to classify it without
 * this module having to know the type's name. `errorCategory` must be a member
 * of {@link TELEMETRY_ERROR_CATEGORIES} and `errorCode` a member of
 * {@link TELEMETRY_ERROR_CODES}; anything else is ignored.
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
 * Standard platform error names. Deliberately limited to names defined by the
 * DOM, Node, or undici so this table does not become a registry of every
 * TypeAgent error type - a package with its own typed error attaches
 * `errorCategory` to it instead (see {@link TelemetryClassifiedError}).
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
 * Reviewed codes that are safe to export but say nothing about the category on
 * their own. Kept out of {@link CATEGORY_BY_ERROR_CODE} so the category tables
 * stay honest: these are reported as `errorCode` alongside whatever category
 * the rest of the link established, which is `internal` when nothing else did.
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
 * The closed, reviewed set of codes this module will ever export.
 *
 * A code becomes a log/metric label, so a shape check is not enough on its
 * own: a `code` that happens to be an identifier-shaped GUID, account name, or
 * API key passes any pattern and then either blows up label cardinality or
 * carries an identifier off the machine. Exporting only reviewed constants
 * bounds both. A package that needs its own code adds it here (one reviewed
 * line) and declares it through {@link TelemetryClassifiedError}.
 */
export const TELEMETRY_ERROR_CODES: readonly TelemetryErrorCode[] =
    Object.freeze([
        ...CATEGORY_BY_ERROR_CODE.keys(),
        ...UNCATEGORIZED_ERROR_CODES,
    ]);

const TELEMETRY_ERROR_CODE_SET: ReadonlySet<string> = new Set(
    TELEMETRY_ERROR_CODES,
);

/**
 * HTTP statuses that are worth retrying. Matches the transient set the
 * `aiclient` REST layer already retries on, so a retryable classification and
 * an actual retry agree.
 */
const RETRYABLE_HTTP_STATUSES: ReadonlySet<number> = new Set([
    408, 429, 500, 502, 503, 504,
]);

/** Numeric properties an HTTP status is conventionally exposed under. */
const HTTP_STATUS_PROPERTIES = ["status", "statusCode", "httpStatus"] as const;

/**
 * How far the `cause` chain is walked. Deep enough for the wrapping that
 * `fetch`, undici, and the Azure SDKs actually do, shallow enough that a
 * hostile or accidental chain cannot turn classification into real work.
 */
const MAX_CAUSE_DEPTH = 8;

const INTERNAL_CLASSIFICATION: TelemetryErrorClassification = Object.freeze({
    errorCategory: "internal",
});

/**
 * Normalize any thrown value into bounded, export-safe structured fields.
 * Never throws and never returns the original message, stack, or any other
 * free-text content. A value carrying no recognized signal is reported as
 * `internal`.
 */
export function classifyTelemetryError(
    error: unknown,
): TelemetryErrorClassification {
    return classifyTelemetryErrorIfRecognized(error) ?? INTERNAL_CLASSIFICATION;
}

/**
 * The same classification, except that a value carrying no recognized signal
 * yields `undefined` instead of `internal`.
 *
 * `internal` is a claim, not an absence: it says the failure came from our own
 * code. A caller that already knows something truer about the failure must not
 * have that claim written over its own. The transport turning a provider call
 * into a `Result` failure is the case that matters - `provider` is the honest
 * description of "the model call failed and nothing told us why", and
 * attaching `internal` to it would both mislabel the failure and pre-empt the
 * fallback the reporting layer would otherwise apply.
 *
 * Use this wherever a classification is *attached* to a value that already has
 * a meaningful default; use {@link classifyTelemetryError} where a category is
 * required and `internal` is the honest answer. Never throws.
 */
export function classifyTelemetryErrorIfRecognized(
    error: unknown,
): TelemetryErrorClassification | undefined {
    try {
        return classifyErrorChain(collectErrorChain(error));
    } catch {
        // Defense in depth: every read below is already guarded, so reaching
        // here means an assumption broke. A telemetry helper must still not
        // replace the failure it was asked to describe.
        return undefined;
    }
}

/**
 * Whether a failure should be reported as a cancellation.
 *
 * The single cancellation test for spans, structured events, and the model
 * wrapper, so a span status and the log record next to it cannot disagree
 * about the same failure. Two things make it a cancellation:
 *
 * - The thrown value classifies as `cancelled`. This walks the `cause` chain,
 *   so an `AbortError` wrapped by a phase-level error still counts - a call
 *   site that only compared `error.name` would report a plain failure.
 * - `cancelledHint`, what the caller knows from outside the error: typically
 *   that the request's abort signal has fired. It stands on its own, because a
 *   cancellation frequently surfaces as an unrelated-looking failure (a
 *   provider socket error, a timeout) once the signal has torn the work down.
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
 * Classify an HTTP failure status directly, for a caller that holds the status
 * but no error object - a REST client turning a non-OK response into a typed
 * failure result, for instance. Returns `undefined` for a status that is not a
 * failure so the caller omits the classification rather than inventing one.
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
 * Where a classification is stashed on a value that is not itself an error.
 *
 * A registered symbol rather than a string key: it cannot collide with a
 * domain property, `JSON.stringify` and `Object.keys` skip it, and
 * `Symbol.for` resolves to the same symbol when two copies of this package are
 * loaded in one process.
 */
const CLASSIFICATION_CARRIER = Symbol.for(
    "typeagent.telemetry.errorClassification",
);

/**
 * Record a classification on a value that reports failure without throwing.
 *
 * `typechat`'s `Result` failure is `{ success: false, message }` - a string
 * with no room for structure, so by the time a caller sees one, everything
 * that was known at the transport layer (the HTTP status, the socket error)
 * has been flattened into prose that telemetry must not parse. This lets the
 * layer that still has the facts attach them, and
 * {@link readTelemetryErrorClassification} lets the layer that reports
 * telemetry pick them back up.
 *
 * The property is non-enumerable, so it does not change spreads, `Object.keys`,
 * `JSON.stringify`, or deep-equality assertions on existing results. Returns
 * the same object and never throws: a frozen or exotic target simply carries
 * no classification.
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
 * {@link attachTelemetryErrorClassification}. The stored value is re-validated
 * against the same closed vocabularies used for a thrown error, so a stale or
 * forged carrier cannot smuggle an unbounded field into an export.
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
 * Read one property without trusting the object. A getter can throw, and a
 * proxy can trap (or have been revoked since the previous read), so every
 * access degrades to `undefined` instead of propagating.
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
 * an ordered list, outermost first. Bounded by {@link MAX_CAUSE_DEPTH} and
 * guarded by a visited set, so a self-referential or mutually-referential
 * chain terminates instead of recursing forever.
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
        // Stopping the walk must not discard the links already collected: an
        // outer `AbortError` still classifies the failure even when the value
        // hanging off it is unreadable.
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
    // Only the first aggregated error is followed. Walking all of them would
    // make the cost unbounded, and the categories of sibling failures are
    // usually the same anyway.
    const errors = readProperty(node, "errors");
    try {
        // `Array.isArray` is not a safe predicate: it throws on a revoked
        // proxy rather than returning false. It and the index read are both
        // inside the guard so an unreadable `errors` ends the walk instead.
        return Array.isArray(errors) ? errors[0] : undefined;
    } catch {
        return undefined;
    }
}

/**
 * Report the first link of the chain that carries a recognized signal, with
 * every field read from that link. See the precedence contract at the top of
 * the module. `undefined` when no link carried anything recognized.
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
        // Nothing on this link is evidence of anything. Keep walking rather
        // than reporting an `internal` that a cause could have explained.
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
 * Read the classification a thrower declared on its own error type. Returns
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
    // Only failure statuses reach here (see readOwnHttpStatus). The remaining
    // 4xx codes all say the request itself was unacceptable; 5xx is the
    // provider failing to serve an acceptable request.
    return status < 500 ? "validation" : "provider";
}

/**
 * Read an HTTP failure status off the node itself or off its `response`
 * object (the shape most HTTP clients use). `cause` is deliberately not
 * followed here: the chain walk already visits it as its own link, so
 * following it would let a cause's status pre-empt that same cause's more
 * specific `name`/`code`.
 *
 * Only a finite integer in the 400-599 range counts. A string `"429"` is
 * ignored rather than coerced, and a 1xx/2xx/3xx value is ignored because it
 * says nothing about a failure - `status` is also used as a non-HTTP enum
 * elsewhere (a `child_process` exit code, for instance), and treating such a
 * value as a signal would both fabricate an `httpStatus` and stop the cause
 * walk before the real signal.
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
