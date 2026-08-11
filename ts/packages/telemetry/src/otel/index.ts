// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export {
    resolveTelemetryConfig,
    type OtlpExporterConfig,
    type TraceSampler,
    type TraceConfig,
    type MetricConfig,
    type LogConfig,
    type TelemetryConfig,
    type ResolveTelemetryConfigOptions,
} from "./config.js";

export {
    createTelemetryLifecycle,
    TelemetryLifecycleClosedError,
    TelemetryShutdownTimeoutError,
    type ShutdownCallback,
    type TelemetryLifecycle,
    type TelemetryLifecycleOptions,
} from "./lifecycle.js";

export {
    createTelemetryCoordinator,
    initTelemetry,
    shutdownTelemetry,
    TelemetryProviderOwnershipError,
    type InitTelemetryOptions,
    type TelemetryCoordinator,
    type TelemetryOwnedComponent,
    type TelemetryProvider,
    type TelemetryProviderBundle,
    type TelemetryProviderFactories,
    type TelemetrySignal,
} from "./bootstrap.js";

export {
    createProcessResource,
    TYPEAGENT_RESOURCE_ATTRIBUTES,
    type ProcessResourceOptions,
} from "./resources.js";

export {
    getTypeAgentSourceVersion,
    resolveTypeAgentSourceVersion,
    type GitVersionReader,
    type TypeAgentSourceVersion,
} from "./sourceVersion.js";

export {
    redactText,
    redactObject,
    type RedactionOptions,
} from "./redaction.js";

export {
    INSTRUMENTATION_SCOPE_NAME,
    INSTRUMENTATION_SCOPE_VERSION,
    INSTRUMENTATION_SCOPE,
    type InstrumentationScope,
} from "./instrumentation.js";

export {
    TYPEAGENT_SPAN_NAMES,
    TYPEAGENT_SPAN_ATTRIBUTES,
    setTypeAgentSpanAttributes,
    type TypeAgentSpanName,
    type TypeAgentSpanAttributeKey,
    type TypeAgentSpanAttributes,
} from "./traceContract.js";
