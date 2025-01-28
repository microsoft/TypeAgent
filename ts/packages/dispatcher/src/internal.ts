// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Internal exports for CLI/testing/debugging purposes

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
    convertTestDataToExplanationData,
} from "./utils/test/testData.js";

export { getAssistantSelectionSchemas } from "./translation/unknownSwitcher.js";
export { getActionSchema } from "./translation/actionSchemaFileCache.js";
export { getFullSchemaText } from "./translation/agentTranslators.js";

export { loadAgentJsonTranslator } from "./translation/agentTranslators.js";
export { createSchemaInfoProvider } from "./translation/actionSchemaFileCache.js";
export {
    createActionConfigProvider,
    getSchemaNamesForActionConfigProvider,
} from "./agentProvider/agentProviderUtils.js";
export { getInstanceDir } from "./utils/userData.js";
