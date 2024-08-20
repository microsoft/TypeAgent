// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export {
    processCommand,
    getSettingSummary,
    getPrompt,
    getTranslatorNameToEmojiMap,
} from "./command.js";
export { partialInput } from "./action/actionHandlers.js";
export { processRequests } from "./utils/interactive.js";
export { ClientIO, RequestId } from "./handlers/common/interactiveIO.js";
export {
    initializeCommandHandlerContext,
    closeCommandHandlerContext,
    CommandHandlerContext,
} from "./handlers/common/commandHandlerContext.js";
export {
    getDefaultTranslatorName,
    getTranslatorNames,
} from "./translation/agentTranslators.js";
export { getCacheFactory } from "./utils/cacheFactory.js";
export { loadTranslatorSchemaConfig } from "./utils/loadSchemaConfig.js";
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

// for CLI
export { RequestCommandHandler } from "./handlers/requestCommandHandler.js";
export { TranslateCommandHandler } from "./handlers/translateCommandHandler.js";
export { ExplainCommandHandler } from "./handlers/explainCommandHandler.js";
export { getFullSchemaText } from "./translation/agentTranslators.js";
export { getAssistantSelectionSchemas } from "./translation/unknownSwitcher.js";
export { getTestDataFiles } from "./utils/config.js";
