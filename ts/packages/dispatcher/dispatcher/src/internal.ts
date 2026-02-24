// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Internal exports for agent server
export { createDispatcherFromContext } from "./dispatcher.js";
export {
    closeCommandHandlerContext,
    initializeCommandHandlerContext,
} from "./context/commandHandlerContext.js";

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
export { tryGetActionSchema } from "./translation/actionSchemaFileCache.js";
export { createSchemaInfoProvider } from "./translation/actionSchemaFileCache.js";
export { getAllActionConfigProvider } from "./context/inlineAgentProvider.js";
export type { ComposeSchemaOptions } from "./translation/actionSchemaJsonTranslator.js";
export type { ActionConfig } from "./translation/actionConfig.js";
export type { ActionConfigProvider } from "./translation/actionConfigProvider.js";

export {
    ChatHistoryInput,
    ChatHistoryInputEntry,
    ChatHistoryInputAssistant,
    isChatHistoryInput,
} from "./context/chatHistory.js";

export {
    getSessionsDirPath,
    getSessionDirPath,
    getSessionNames,
    getSessionConstructionDirPath,
    getSessionConstructionDirPaths,
} from "./context/session.js";
