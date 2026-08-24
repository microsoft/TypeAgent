// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * The stable OTel instrumentation scope identity for `@typeagent/telemetry`
 * itself. Future tracer/meter/logger acquisition (e.g.
 * `trace.getTracer(INSTRUMENTATION_SCOPE.name, INSTRUMENTATION_SCOPE.version)`)
 * uses these values. This module does not acquire a tracer, meter, or logger.
 */

/** Name reported as the OTel instrumentation scope name. */
export const INSTRUMENTATION_SCOPE_NAME = "@typeagent/telemetry";

/**
 * Version reported as the OTel instrumentation scope version. Tracks
 * `@typeagent/telemetry`'s own `package.json` version.
 */
export const INSTRUMENTATION_SCOPE_VERSION = "0.0.1";

/** An OTel instrumentation scope: a stable `(name, version)` identity. */
export interface InstrumentationScope {
    readonly name: string;
    readonly version: string;
}

/**
 * The instrumentation scope TypeAgent-owned code should pass when acquiring
 * a tracer, meter, or logger from the global OTel providers.
 */
export const INSTRUMENTATION_SCOPE: InstrumentationScope = {
    name: INSTRUMENTATION_SCOPE_NAME,
    version: INSTRUMENTATION_SCOPE_VERSION,
};
