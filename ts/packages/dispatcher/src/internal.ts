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

export { getBuiltinConstructionConfig } from "./utils/config.js";
export {
    getSchemaNamesFromDefaultAppAgentProviders,
    getActionConfigProviderFromDefaultAppAgentProviders,
    createSchemaInfoProviderFromDefaultAppAgentProviders,
    getDefaultAppAgentProviders,
} from "./utils/defaultAppProviders.js";
export { getAssistantSelectionSchemas } from "./translation/unknownSwitcher.js";
export { getActionSchema } from "./translation/actionSchemaFileCache.js";
export { getFullSchemaText } from "./translation/agentTranslators.js";
export { getTestDataFiles } from "./utils/config.js";
