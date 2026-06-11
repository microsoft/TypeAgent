// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export * from "./common.js";
export { resolveCliOnPath, claudeExecutableOption } from "./cliPath.js";
export * from "./models.js";
export * as openai from "./openai.js";
export * as bing from "./bing.js";
export * from "./restClient.js";
export * from "./auth.js";
export * from "./tokenCounter.js";
export { getCopilotClient } from "./copilotModels.js";
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
