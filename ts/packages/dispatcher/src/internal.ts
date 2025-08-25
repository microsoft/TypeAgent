// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

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
export { getFullSchemaText } from "./translation/agentTranslators.js";
export { tryGetActionSchema } from "./translation/actionSchemaFileCache.js";
export { getAppAgentName } from "./translation/agentTranslators.js";
export { createSchemaInfoProvider } from "./translation/actionSchemaFileCache.js";
export { getAllActionConfigProvider } from "./context/inlineAgentProvider.js";

export { ChatHistoryInput, isChatHistoryInput } from "./context/chatHistory.js";
