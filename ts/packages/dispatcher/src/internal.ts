// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Internal exports for CLI/testing/debugging purposes

export {
    initializeCommandHandlerContext,
    closeCommandHandlerContext,
    CommandHandlerContext,
} from "./handlers/common/commandHandlerContext.js";
export {
    processCommand,
    getSettingSummary,
    getPrompt,
    getTranslatorNameToEmojiMap,
} from "./dispatcher/command.js";
export { processRequests } from "./utils/interactive.js";
export { getCacheFactory } from "./utils/cacheFactory.js";
export {
    GenerateTestDataResult,
    GenerateDataInput,
    generateTestDataFiles,
    TestData,
    readLineData,
    getEmptyTestData,
    readTestData,
    printTestDataStats,
    TestDataEntry,
    FailedTestDataEntry,
} from "./utils/test/testData.js";

export { getBuiltinConstructionConfig } from "./utils/config.js";
export { getBuiltinTranslatorNames } from "./translation/agentTranslators.js";
export { getAssistantSelectionSchemas } from "./translation/unknownSwitcher.js";
export { getActionSchema } from "./translation/actionSchema.js";
export { getTestDataFiles } from "./utils/config.js";
export {
    loadBuiltinTranslatorSchemaConfig,
    getBuiltinTranslatorConfigProvider,
    getFullSchemaText,
} from "./translation/agentTranslators.js";
