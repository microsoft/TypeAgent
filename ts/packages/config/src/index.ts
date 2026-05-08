// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export { loadConfig, loadConfigSync } from "./loader.js";
export { flatten, mergeFlat } from "./flatten.js";
export { validateConfigTree, configTreeSchema } from "./schema.js";
export {
    ConfigSource,
    type ConfigScalar,
    type ConfigTree,
    type FlatEnv,
    type LoadConfigOptions,
    type LoadConfigResult,
    type SourceMap,
} from "./types.js";
