// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { getTestDataFiles } from "./utils/config.js";
import { getBuiltinConstructionConfig } from "./utils/config.js";
import { ConstructionProvider } from "agent-dispatcher";

export function getDefaultConstructionProvider(): ConstructionProvider {
    return {
        getBuiltinConstructionConfig,
        getImportTranslationFiles: getTestDataFiles,
    };
}
