// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export {
    resolveTelemetryConfig,
    getAllOtlpExporters,
    DEFAULT_LOG_RETENTION_BYTES,
    type OtlpExporterConfig,
    type TraceSampler,
    type TraceConfig,
    type MetricConfig,
    type LogConfig,
    type TelemetryConfig,
    type ResolveTelemetryConfigOptions,
} from "./config.js";

export {
    installDebugBridge,
    type DebugBridge,
    type DebugBridgeOptions,
    type DebugModule,
} from "./debugBridge.js";

export {
    createLocalTelemetryState,
    expandTracePresets,
    getLocalTelemetryState,
    setLocalTelemetryState,
    LOCAL_TELEMETRY_PROFILES,
    TRACE_PRESETS,
    type CreateLocalTelemetryStateOptions,
    type LocalTelemetryProfile,
    type LocalTelemetrySnapshot,
    type LocalTelemetryState,
    type TracePresetName,
} from "./localTelemetryState.js";

export {
    JsonlLogExporter,
    resolveJsonlLogPath,
    getJsonlLogPathIdentity,
    getActiveJsonlLogPaths,
    type JsonlLogExporterOptions,
} from "./jsonlLogExporter.js";

export {
    runLogRetentionCleanup,
    type LogRetentionFs,
    type RunLogRetentionCleanupOptions,
} from "./logRetention.js";

export { LocalLogRecordProcessor } from "./localLogRecordProcessor.js";

export {
    classifyDebugNamespace,
    debugClassAllowedByProfile,
    readDebugClass,
    DEBUG_CLASS_ATTRIBUTE,
    DEBUG_NAMESPACE_ATTRIBUTE,
    type DebugLogClass,
} from "./debugClass.js";

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
    TYPEAGENT_PROCESS_NAME_ATTRIBUTE,
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
    getActiveTypeAgentSpanAttributes,
    installAmbientTypeAgentAttributeStore,
    runInTypeAgentTelemetryContext,
    setActiveTypeAgentSpanAttributes,
    setTypeAgentSpanAttributes,
    type AmbientTypeAgentAttributeStore,
    type TypeAgentSpanName,
    type TypeAgentSpanAttributeKey,
    type TypeAgentSpanAttributes,
} from "./traceContract.js";

export { installNodeAmbientTelemetryContext } from "./traceContextNode.js";

export {
    isStructuredLoggingEnabled,
    setStructuredLoggingEnabled,
} from "./structuredLogging.js";

export {
    attachTelemetryErrorClassification,
    classifyTelemetryError,
    classifyTelemetryErrorIfRecognized,
    classifyTelemetryHttpStatus,
    isTelemetryCancellation,
    readTelemetryErrorClassification,
    TELEMETRY_ERROR_CATEGORIES,
    TELEMETRY_ERROR_CODES,
    type TelemetryClassifiedError,
    type TelemetryErrorCategory,
    type TelemetryErrorClassification,
    type TelemetryErrorCode,
} from "./errorClassification.js";
