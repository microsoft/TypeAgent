// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export * from "./common.js";
export * from "./models.js";
export {
    instrumentChatModel,
    resetLlmClassificationDiagnostics,
    type ChatModelTelemetryInfo,
} from "./otelChatModel.js";
export {
    getChatModelTelemetryContext,
    withChatModelTelemetryContext,
    withChatModelTelemetryPurpose,
    type ChatModelTelemetryClassification,
    type ChatModelTelemetryClassificationSource,
    type ChatModelTelemetryContext,
    type ChatModelTelemetryPhase,
    type ChatModelTelemetryPurpose,
    type ChatModelTelemetryScope,
} from "./chatModelTelemetryContext.js";
export {
    getModelCallSink,
    withModelCallSink,
    type ModelCallRecord,
    type ModelCallSink,
} from "./modelCallCapture.js";
export * as openai from "./openai.js";
export * as bing from "./bing.js";
export * from "./restClient.js";
export * from "./auth.js";
export * from "./tokenCounter.js";
export {
    getCopilotClient,
    getCopilotCliPath,
    warmupCopilotClient,
    warmupCopilotFromConfig,
    type CopilotClientOptions,
} from "./copilotModels.js";
export {
    copilotApiSettingsFromConfig,
    type CopilotApiSettings,
    type CopilotReasoningEffort,
} from "./copilotSettings.js";
export {
    getActiveModelProvider,
    setActiveModelProvider,
    resolveTarget,
    PROVIDER_MODES,
    type ProviderMode,
} from "./providerMode.js";
export {
    getChatModelNames,
    getChatModelMaxConcurrency,
} from "./modelResource.js";
export {
    apiSettingsFromConfig,
    azureApiSettingsFromConfig,
    openAIApiSettingsFromConfig,
    configFromEnvRecord,
    getDeployment,
    getDeploymentEndpoint,
} from "./apiSettingsFromConfig.js";
export { discoverEndpointPoolFromConfig } from "./endpointPoolFromConfig.js";
export {
    getRuntimeConfig,
    setRuntimeConfig,
    initRuntimeConfigFromProcessEnv,
} from "./runtimeConfig.js";
export {
    createLocalEmbeddingModel,
    DefaultLocalEmbeddingModel,
    type LocalEmbeddingModelSettings,
} from "./localEmbedding.js";
export {
    getEmbeddingProvider,
    isEmbeddingAvailable,
    tryCreateEmbeddingModel,
    type EmbeddingProvider,
} from "./embeddingProvider.js";
