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
} from "./command/command.js";
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
export {
    getSchemaNamesFromDefaultAppAgentProviders,
    getActionConfigProviderFromDefaultAppAgentProviders,
    createSchemaInfoProviderFromDefaultAppAgentProviders,
    getDefaultAppAgentProviders,
} from "./utils/defaultAppProviders.js";
export { getAssistantSelectionSchemas } from "./translation/unknownSwitcher.js";
export { getActionSchema } from "./translation/actionSchemaFileCache.js";
export { getTestDataFiles } from "./utils/config.js";
export { getFullSchemaText } from "./translation/agentTranslators.js";
