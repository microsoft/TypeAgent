// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { context as otelContext, type Context } from "@opentelemetry/api";
import {
    logs,
    SeverityNumber,
    type Logger as OtelApiLogger,
    type LogRecord as OtelLogRecord,
} from "@opentelemetry/api-logs";
import { Buffer } from "node:buffer";

import type {
    LogEvent,
    LogEventData,
    LogEventSeverity,
    LoggerSink,
} from "./logger.js";
import {
    INSTRUMENTATION_SCOPE_NAME,
    INSTRUMENTATION_SCOPE_VERSION,
} from "../otel/instrumentation.js";
import { TYPEAGENT_SPAN_ATTRIBUTES } from "../otel/traceContract.js";
import {
    redactObject,
    redactText,
    type RedactionOptions,
} from "../otel/redaction.js";

/**
 * Options for {@link createOtelLoggerSink} / {@link OtelLoggerSink}.
 *
 * The sink pulls its logger from the global OTel logs API on demand; it
 * never owns or configures a provider. The only knob currently exposed is
 * a shared {@link RedactionOptions} secret filter that is threaded through
 * every redaction call the sink makes. This filtering is defense in depth:
 * producers remain responsible for excluding prompts, responses, user
 * content, PII, and other data that is not appropriate to record. See
 * `docs/architecture/telemetry/opentelemetry.md` for the privacy contract.
 */
export interface OtelLoggerSinkOptions extends RedactionOptions {
    readonly diagnostic?: (message: string) => void;
}

/**
 * Top-level string fields on `LogEvent.event` that are promoted to
 * well-known OTel log attributes. Order is stable so tests can assert on
 * the produced attribute bag deterministically.
 *
 * Only these keys are promoted. Everything else on `event.event` stays in
 * the log body. `traceId` here is the caller's legacy correlation id; the
 * canonical OTel trace id is derived by the SDK from the active context.
 */
const CORRELATION_FIELDS: ReadonlyArray<
    readonly [keyof LogEventData & string, string]
> = [
    ["sessionId", TYPEAGENT_SPAN_ATTRIBUTES.SESSION_ID],
    ["activationId", TYPEAGENT_SPAN_ATTRIBUTES.ACTIVATION_ID],
    ["traceId", TYPEAGENT_SPAN_ATTRIBUTES.TRACE_ID],
];

/**
 * Maximum object/array nesting depth the sink preserves when snapshotting
 * the caller's payload. Deterministic bound: an entry sitting at depth
 * greater than or equal to this value is replaced with
 * {@link TRUNCATION_MARKER} carrying `depth`. Root is depth 0, its direct
 * children are depth 1, etc. Chosen high enough that any realistic
 * TypeAgent event (`ActionResult`, cache hit, translation, reasoning tool
 * call) fits comfortably, but low enough that a runaway self-referential
 * or generator-produced tree cannot exhaust the call stack.
 */
const BODY_MAX_DEPTH = 32;

/**
 * Approximate allocation cap for the snapshotted body, measured in UTF-16
 * code units as the sink walks the payload. JSON punctuation and escaped
 * string lengths are included, but truncation markers and values that JSON
 * does not represent directly can make the final serialized size differ.
 * Once the running estimate would exceed the cap, the current and
 * subsequent subtrees are replaced with a `size` marker.
 */
const BODY_MAX_APPROX_CHARS = 60 * 1024;

/**
 * Hard cap on the UTF-8 byte length of the JSON-serialized, redacted body.
 * The final check catches multi-byte text, redaction expansion, and any
 * difference from the traversal estimate. If the body exceeds this limit
 * or cannot be serialized, the body becomes a root-level `size` marker so
 * the OTel event is still emitted.
 */
const BODY_MAX_SERIALIZED_BYTES = 64 * 1024;

/** Maximum Unicode code points retained in an OTel event name. */
const EVENT_NAME_MAX_LENGTH = 256;

/** Maximum Unicode code points retained in a promoted correlation value. */
const CORRELATION_VALUE_MAX_LENGTH = 256;

const TRUNCATED_EVENT_NAME = "typeagent.truncated_event_name";

/**
 * Marker key attached to the truncated subtree when the sink refuses to
 * preserve a payload node. The value is the reason so a reader can tell
 * which limit was reached without cross-referencing constants.
 */
const TRUNCATION_MARKER_KEY = "__typeagent_otel_truncated";

type TruncationReason = "depth" | "cycle" | "size" | "unsupported";

function truncationMarker(reason: TruncationReason): Record<string, string> {
    return { [TRUNCATION_MARKER_KEY]: reason };
}

const TRUNCATION_MARKER_APPROX_CHARS: Readonly<
    Record<Exclude<TruncationReason, "size">, number>
> = {
    depth: JSON.stringify(truncationMarker("depth")).length,
    cycle: JSON.stringify(truncationMarker("cycle")).length,
    unsupported: JSON.stringify(truncationMarker("unsupported")).length,
};

/**
 * Map a Structured Logger severity onto the OTel severity buckets. The
 * sink never infers severity from the event name or from the payload;
 * `undefined` (the caller-side default) becomes INFO here, matching the
 * `Logger` contract documented in `logger.ts`.
 */
function mapSeverity(severity: LogEventSeverity | undefined): {
    severityNumber: SeverityNumber;
    severityText: "INFO" | "WARN" | "ERROR";
} {
    switch (severity) {
        case "warning":
            return {
                severityNumber: SeverityNumber.WARN,
                severityText: "WARN",
            };
        case "error":
            return {
                severityNumber: SeverityNumber.ERROR,
                severityText: "ERROR",
            };
        case "info":
        case undefined:
            return {
                severityNumber: SeverityNumber.INFO,
                severityText: "INFO",
            };
        default: {
            // Exhaustiveness: an unknown severity string is safer as
            // INFO than as a runtime throw from the telemetry path.
            const _exhaustive: never = severity;
            void _exhaustive;
            return {
                severityNumber: SeverityNumber.INFO,
                severityText: "INFO",
            };
        }
    }
}

/**
 * A {@link LoggerSink} that forwards Structured Logger events as OTel log
 * records via the global `@opentelemetry/api-logs` API.
 *
 * Contract:
 *
 * - Own no provider, processor, exporter, flush, or shutdown. The sink
 *   only reads the global logs API.
 * - Never throw from `logEvent`. Failures (missing provider, misbehaving
 *   redaction, broken logger implementation, etc.) drop the OTel record
 *   only. No debug or Structured Logger calls happen in the catch, so
 *   the sink cannot recurse through a sibling sink. Failures produce a
 *   rate-limited, content-free diagnostic through an injected callback or
 *   direct stderr output.
 * - Never mutate the caller's `LogEvent.event`; the emitted body is a
 *   detached snapshot produced by {@link boundedSnapshot} so a sibling
 *   sink still sees the original. The snapshot bounds depth
 *   ({@link BODY_MAX_DEPTH}, deterministic), cycles (WeakSet-based), and
 *   approximate allocation size ({@link BODY_MAX_APPROX_CHARS}). The
 *   redacted result also has a hard serialized UTF-8 limit
 *   ({@link BODY_MAX_SERIALIZED_BYTES}). When any bound is reached the
 *   offending subtree, or the root for the final byte check, is replaced with
 *   {@link TRUNCATION_MARKER_KEY} carrying `depth`, `cycle`, `size`, or
 *   `unsupported` instead of dropping the record.
 * - Redact every string that reaches OTel through `redactText` /
 *   `redactObject`, including the promoted correlation attributes. This
 *   catches recognizable and registered secrets but does not make an
 *   arbitrary event body safe to export; producers sanitize content first.
 * - Promote only non-empty root-level string fields listed in
 *   {@link CORRELATION_FIELDS}. Nested or non-string values stay in the
 *   body only.
 * - Attach the OTel context active at emit time so the SDK derives the
 *   canonical trace/span ids. `LogEvent.timestamp` (the canonical
 *   Structured Logger timestamp produced by `Date.prototype.toISOString`)
 *   becomes the record timestamp; anything else is dropped from the
 *   record (the SDK defaults `hrTime`), never the record itself. Observed
 *   timestamp is left for the SDK to fill in.
 * - Severity is read from `LogEvent.severity` and mapped by
 *   {@link mapSeverity}. `undefined` maps to INFO. The sink never infers
 *   severity from the event name or the payload.
 *
 * The sink does not cache the acquired OTel logger between calls. The
 * pinned `@opentelemetry/api-logs` (0.221.0) `LogsAPI.getLogger()` is
 * already a cheap `getLoggerProvider().getLogger(name, version)` lookup,
 * and re-acquiring on every emit is what makes late provider registration
 * *and* global provider replacement (e.g. `logs.disable()` followed by
 * `setGlobalLoggerProvider(...)`) transparent to a sink created earlier.
 *
 * The sink does not own or configure a provider. TypeAgent-owned composition
 * roots attach it to runtime loggers and configure providers separately.
 */
export class OtelLoggerSink implements LoggerSink {
    private readonly options: OtelLoggerSinkOptions | undefined;
    private lastDiagnosticAt = 0;

    constructor(options?: OtelLoggerSinkOptions) {
        this.options = options;
    }

    public logEvent(event: LogEvent): void {
        try {
            const logger = this.acquireLogger();
            if (logger === undefined) {
                return;
            }

            const activeContext = otelContext.active();
            const { severityNumber, severityText } = mapSeverity(
                event.severity,
            );

            // A no-provider ProxyLogger reports `enabled() === false`, so
            // this call is what preserves the no-provider guarantee and
            // also skips work when a real provider is off. Guarded so a
            // broken `enabled()` implementation still drops only this
            // record. The enabled fast path runs before we build the
            // snapshot, so a disabled provider costs nothing beyond the
            // logger lookup and the (cheap) check.
            if (!isLoggerEnabled(logger, activeContext, severityNumber)) {
                return;
            }

            const eventName =
                sanitizeBoundedText(
                    event.eventName,
                    this.options,
                    EVENT_NAME_MAX_LENGTH,
                ) ?? TRUNCATED_EVENT_NAME;
            // Bounded, cycle-safe snapshot of the caller's payload before
            // redaction. Guarantees an acyclic, depth-limited tree so the
            // downstream `redactObject` recursion cannot hang or overflow
            // regardless of what the caller passed.
            const snapshot = boundedSnapshot(event.event);
            // `redactObject` rebuilds every reachable container when it
            // finds a string to redact, but short-circuits back to the
            // caller's own reference when the payload has no strings.
            // The bounded snapshot is already detached from the caller,
            // so short-circuiting to it is safe.
            const redactedBody: LogEventData = redactObject(
                snapshot,
                this.options,
            );
            const body = enforceSerializedBodyLimit(redactedBody);
            const attributes = collectCorrelationAttributes(
                event.event,
                this.options,
            );
            const timestamp = parseTimestamp(event.timestamp);

            const record: OtelLogRecord = {
                context: activeContext,
                severityNumber,
                severityText,
                eventName,
                body,
                attributes,
                ...(timestamp === undefined ? {} : { timestamp }),
            };

            logger.emit(record);
        } catch (error) {
            // Failure isolation: never let a telemetry-side error escape
            // into the caller. Intentionally no debug/logger call - that
            // would recurse through the sibling sinks that share the same
            // `MultiSinkLogger`.
            this.reportFailure(error);
        }
    }

    private acquireLogger(): OtelApiLogger | undefined {
        try {
            return logs.getLogger(
                INSTRUMENTATION_SCOPE_NAME,
                INSTRUMENTATION_SCOPE_VERSION,
            );
        } catch {
            return undefined;
        }
    }

    private reportFailure(error: unknown): void {
        const now = Date.now();
        if (now - this.lastDiagnosticAt < 60_000) {
            return;
        }
        this.lastDiagnosticAt = now;
        const errorName = error instanceof Error ? error.name : "Error";
        const message = `OpenTelemetry structured log dropped (${errorName}).`;
        try {
            if (this.options?.diagnostic !== undefined) {
                this.options.diagnostic(message);
            } else {
                process.stderr.write(`[typeagent:telemetry] ${message}\n`);
            }
        } catch {
            // Diagnostics remain isolated from the request and logger fan-out.
        }
    }
}

/** Factory that mirrors the other sinks in this package. */
export function createOtelLoggerSink(
    options?: OtelLoggerSinkOptions,
): OtelLoggerSink {
    return new OtelLoggerSink(options);
}

function isLoggerEnabled(
    logger: OtelApiLogger,
    activeContext: Context,
    severityNumber: SeverityNumber,
): boolean {
    try {
        return logger.enabled({
            context: activeContext,
            severityNumber,
        });
    } catch {
        return false;
    }
}

function collectCorrelationAttributes(
    event: LogEventData | undefined,
    options: OtelLoggerSinkOptions | undefined,
): Record<string, string> {
    const attributes: Record<string, string> = {};
    if (event === null || typeof event !== "object") {
        return attributes;
    }
    const source = event as Record<string, unknown>;
    for (const [sourceKey, attributeKey] of CORRELATION_FIELDS) {
        const raw = source[sourceKey];
        if (typeof raw !== "string" || raw.length === 0) {
            continue;
        }
        const redacted = sanitizeBoundedText(
            raw,
            options,
            CORRELATION_VALUE_MAX_LENGTH,
        );
        if (redacted === undefined || redacted.length === 0) {
            continue;
        }
        attributes[attributeKey] = redacted;
    }
    return attributes;
}

function sanitizeBoundedText(
    text: string,
    options: OtelLoggerSinkOptions | undefined,
    maxLength: number,
): string | undefined {
    if (exceedsCodePointLimit(text, maxLength)) {
        return undefined;
    }
    const redacted = redactText(text, options);
    return exceedsCodePointLimit(redacted, maxLength) ? undefined : redacted;
}

function exceedsCodePointLimit(text: string, maxLength: number): boolean {
    if (text.length <= maxLength) {
        return false;
    }
    let count = 0;
    for (const _codePoint of text) {
        count++;
        if (count > maxLength) {
            return true;
        }
    }
    return false;
}

/**
 * State threaded through the bounded traversal so cycle, depth, and
 * approximate size limits can be enforced without a second pass.
 *
 * `visited` blocks reference cycles: an object is added before its
 * children are cloned and removed after; a repeat visit within the same
 * recursion path becomes a `cycle` marker. `approxChars` is the running
 * estimate of the eventual JSON-serialized length, charged as the walker
 * descends. `sizeTruncated` latches when the next charge would exceed
 * {@link BODY_MAX_APPROX_CHARS} so any remaining subtree short-circuits
 * to a `size` marker instead of continuing to allocate.
 */
interface BoundedTraversalState {
    visited: WeakSet<object>;
    approxChars: number;
    sizeTruncated: boolean;
}

/**
 * Produce a detached JSON-compatible clone of `value` bounded by
 * {@link BODY_MAX_DEPTH}, cycle-safe via a WeakSet, and approximately
 * bounded in serialized size by {@link BODY_MAX_APPROX_CHARS}. Nodes that
 * hit a limit are replaced with a {@link TRUNCATION_MARKER_KEY}-tagged
 * marker instead of dropping the record. JSON primitives pass through;
 * arrays and plain objects are detached into JSON-compatible containers.
 * Values outside the Structured Logger's JSON-compatible contract become
 * `unsupported` markers instead of reaching the OTel SDK in an invalid body.
 */
function boundedSnapshot(value: LogEventData | undefined): LogEventData {
    const state: BoundedTraversalState = {
        visited: new WeakSet<object>(),
        approxChars: 0,
        sizeTruncated: false,
    };
    // Root is a plain-object `LogEventData` per the Structured Logger
    // contract; falling through the object branch preserves that shape
    // in the returned snapshot. A missing or non-object root would be a
    // caller bug elsewhere in the pipeline; we still return an empty
    // object so the record shape stays predictable.
    if (value === null || typeof value !== "object") {
        return {};
    }
    const cloned = cloneBounded(value, 0, state) as LogEventData;
    return cloned;
}

function cloneBounded(
    value: unknown,
    depth: number,
    state: BoundedTraversalState,
): unknown {
    if (state.sizeTruncated) {
        return truncationMarker("size");
    }
    if (depth >= BODY_MAX_DEPTH) {
        return boundedMarker("depth", state);
    }
    if (value === null) {
        return clonePrimitive(value, state);
    }
    if (isJsonPrimitive(value)) {
        return clonePrimitive(value, state);
    }
    if (typeof value !== "object") {
        return boundedMarker("unsupported", state);
    }
    if (state.visited.has(value)) {
        return boundedMarker("cycle", state);
    }

    state.visited.add(value);
    try {
        return Array.isArray(value)
            ? cloneArray(value, depth, state)
            : cloneObject(value, depth, state);
    } finally {
        state.visited.delete(value);
    }
}

type JsonPrimitive = null | string | boolean | number;

function isJsonPrimitive(
    value: unknown,
): value is Exclude<JsonPrimitive, null> {
    return (
        typeof value === "string" ||
        typeof value === "boolean" ||
        (typeof value === "number" && Number.isFinite(value))
    );
}

function clonePrimitive(
    value: JsonPrimitive,
    state: BoundedTraversalState,
): JsonPrimitive | Record<string, string> {
    return tryCharge(state, approxPrimitiveChars(value))
        ? value
        : truncationMarker("size");
}

function cloneArray(
    source: readonly unknown[],
    depth: number,
    state: BoundedTraversalState,
): unknown[] {
    if (!tryCharge(state, 2)) {
        return [truncationMarker("size")];
    }

    const clone: unknown[] = [];
    for (let index = 0; index < source.length; index++) {
        if (!chargeArraySeparator(index, state)) {
            clone.push(truncationMarker("size"));
            break;
        }
        clone.push(cloneBounded(source[index], depth + 1, state));
        if (state.sizeTruncated) {
            break;
        }
    }
    return clone;
}

function chargeArraySeparator(
    index: number,
    state: BoundedTraversalState,
): boolean {
    return !state.sizeTruncated && (index === 0 || tryCharge(state, 1));
}

function cloneObject(
    source: object,
    depth: number,
    state: BoundedTraversalState,
): Record<string, unknown> {
    if (!isPlainObject(source)) {
        return boundedMarker("unsupported", state);
    }

    const clone: Record<string, unknown> = {};
    if (!tryCharge(state, 2)) {
        markObjectSizeTruncated(clone);
        return clone;
    }

    let propertyCount = 0;
    for (const key in source) {
        if (!Object.prototype.hasOwnProperty.call(source, key)) {
            continue;
        }
        if (!chargeObjectProperty(key, propertyCount, state)) {
            markObjectSizeTruncated(clone);
            break;
        }
        propertyCount++;
        setOwnValue(
            clone,
            key,
            cloneBounded(
                (source as Record<string, unknown>)[key],
                depth + 1,
                state,
            ),
        );
        if (state.sizeTruncated) {
            break;
        }
    }
    return clone;
}

function isPlainObject(value: object): boolean {
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
}

function chargeObjectProperty(
    key: string,
    propertyCount: number,
    state: BoundedTraversalState,
): boolean {
    if (state.sizeTruncated) {
        return false;
    }
    const separatorChars = propertyCount === 0 ? 0 : 1;
    return tryCharge(state, separatorChars + approxPrimitiveChars(key) + 1);
}

function markObjectSizeTruncated(target: Record<string, unknown>): void {
    setOwnValue(target, TRUNCATION_MARKER_KEY, "size");
}

function boundedMarker(
    reason: Exclude<TruncationReason, "size">,
    state: BoundedTraversalState,
): Record<string, string> {
    if (!tryCharge(state, TRUNCATION_MARKER_APPROX_CHARS[reason])) {
        return truncationMarker("size");
    }
    return truncationMarker(reason);
}

function setOwnValue(
    target: Record<string, unknown>,
    key: string,
    value: unknown,
): void {
    Object.defineProperty(target, key, {
        value,
        enumerable: true,
        configurable: true,
        writable: true,
    });
}

function tryCharge(state: BoundedTraversalState, chars: number): boolean {
    if (state.approxChars + chars > BODY_MAX_APPROX_CHARS) {
        state.sizeTruncated = true;
        return false;
    }
    state.approxChars += chars;
    return true;
}

function approxPrimitiveChars(value: unknown): number {
    if (typeof value === "string") {
        // JSON.stringify gives the exact escaped UTF-16 length for a JSON
        // string token without serializing the surrounding body.
        return JSON.stringify(value).length;
    }
    if (typeof value === "number" || typeof value === "boolean") {
        return String(value).length;
    }
    // null
    return 4;
}

function enforceSerializedBodyLimit(body: LogEventData): LogEventData {
    try {
        const serialized = JSON.stringify(body);
        if (
            serialized !== undefined &&
            Buffer.byteLength(serialized, "utf8") <= BODY_MAX_SERIALIZED_BYTES
        ) {
            return body;
        }
    } catch {
        // An unexpected non-JSON value (for example bigint) should not
        // drop the OTel record. Replace the body with the bounded marker.
    }
    return truncationMarker("size");
}

/**
 * Parse `LogEvent.timestamp` (the canonical Structured Logger timestamp,
 * produced by `Date.prototype.toISOString()`) into a millisecond epoch
 * that OTel accepts as `TimeInput`.
 *
 * Only strings that round-trip exactly through
 * `new Date(timestamp).toISOString()` are accepted; anything else -
 * invalid ISO, non-canonical form, rolled-over dates like
 * `2024-02-30T00:00:00.000Z` - returns `undefined`. The caller drops the
 * timestamp field only, not the whole record: the SDK then fills `hrTime`
 * from `Date.now()`, which is a better signal than losing the event
 * entirely.
 */
function parseTimestamp(timestamp: unknown): number | undefined {
    if (typeof timestamp !== "string" || timestamp.length === 0) {
        return undefined;
    }
    const date = new Date(timestamp);
    const ms = date.getTime();
    if (!Number.isFinite(ms)) {
        return undefined;
    }
    if (date.toISOString() !== timestamp) {
        return undefined;
    }
    return ms;
}
