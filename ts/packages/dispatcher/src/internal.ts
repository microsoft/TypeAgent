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
export { getAssistantSelectionSchemas } from "./translation/unknownSwitcher.js";
export { getActionSchema } from "./translation/actionSchemaFileCache.js";
export { getFullSchemaText } from "./translation/agentTranslators.js";

export {
    ActionConfig,
    ActionConfigProvider,
    convertToActionConfig,
    loadAgentJsonTranslator,
} from "./translation/agentTranslators.js";
export {
    AppAgentInfo,
    createNpmAppAgentProvider,
} from "./agentProvider/npmAgentProvider.js";
export {
    ActionSchemaFileCache,
    createSchemaInfoProvider,
} from "./translation/actionSchemaFileCache.js";
export { getInstanceDir } from "./utils/userData.js";
