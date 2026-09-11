// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Internal exports for agent server
export { createDispatcherFromContext } from "./dispatcher.js";
export {
    closeCommandHandlerContext,
    initializeCommandHandlerContext,
    prewarmReasoning,
} from "./context/commandHandlerContext.js";
export type { CommandHandlerContext } from "./context/commandHandlerContext.js";
export {
    collectCommandReferenceMarkdown,
    collectActionReference,
} from "./command/commandReference.js";
export type {
    CommandReferenceOptions,
    ActionReferenceEntry,
} from "./command/commandReference.js";
export { lockInstanceDir } from "./utils/fsUtils.js";
export { DisplayLog } from "./displayLog.js";
export type { DisplayLogEntry } from "./displayLog.js";
export { PendingInteractionManager } from "./context/pendingInteractionManager.js";

// Internal exports for CLI/testing/debugging purposes

export { getCacheFactory } from "./utils/cacheFactory.js";
export {
    GenerateTestDataResult,
    GenerateDataInput,
    generateExplanationTestDataFiles,
    ExplanationTestData,
    readLineData,
    getEmptyExplanationTestData,
    readExplanationTestData,
    printExplanationTestDataStats,
    ExplanationTestDataEntry,
    FailedExplanationTestDataEntry,
    convertTestDataToExplanationData,
} from "./utils/test/explanationTestData.js";

export { getAssistantSelectionSchemas } from "./translation/unknownSwitcher.js";
export {
    getFullSchemaText,
    getAppAgentName,
    loadAgentJsonTranslator,
} from "./translation/agentTranslators.js";
export type {
    TypeAgentTranslator,
    TranslatedAction,
} from "./translation/agentTranslators.js";
export type {
    TranslationOutcome,
    TranslationProbeFile,
    TranslationProbeRow,
    TranslationProbeSummary,
    UserContextMode,
} from "./translation/translationProbeRunner.js";
export type { UserContext } from "./translation/userContext.js";
export { resolveUserContextFromSchema } from "./translation/userContext.js";
export { schemaGuidelines } from "./translation/schemaGuidelines.js";
export {
    ActionSchemaFileCache,
    tryGetActionSchema,
    createSchemaInfoProvider,
} from "./translation/actionSchemaFileCache.js";
export { getAllActionConfigProvider } from "./context/inlineAgentProvider.js";
export type { ComposeSchemaOptions } from "./translation/actionSchemaJsonTranslator.js";
export {
    convertToActionConfig,
    type ActionConfig,
} from "./translation/actionConfig.js";
export type {
    ActionConfigProvider,
    ActionSchemaFile,
} from "./translation/actionConfigProvider.js";
export { createHistoryContext } from "./translation/interpretRequest.js";
export { translateRequest } from "./translation/translateRequest.js";
export {
    DispatcherClarifyName,
    isUnknownAction,
} from "./context/dispatcher/dispatcherUtils.js";

export {
    ChatHistoryInput,
    ChatHistoryInputEntry,
    ChatHistoryInputAssistant,
    isChatHistoryInput,
    createChatHistory,
} from "./context/chatHistory.js";

export {
    getSessionsDirPath,
    getSessionDirPath,
    getSessionNames,
    getSessionConstructionDirPath,
    getSessionConstructionDirPaths,
    type CollisionStrategy,
    type DispatcherConfig,
    Session,
} from "./context/session.js";

export { initializeGeolocation } from "./context/geolocation.js";

// System command handler tree — exposed for tooling that statically enumerates
// the `@command` surface (e.g. the Action Browser documentation generator).
export { systemHandlers } from "./context/system/systemAgent.js";
