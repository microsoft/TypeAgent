// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export { loadConfig, loadConfigSync, computeConfigDrift } from "./loader.js";
export { flatten, mergeFlat } from "./flatten.js";
export {
    fetchKeyVaultConfig,
    makeAzureFetcher,
    DEFAULT_SECRET_NAME,
    type KeyVaultFetcher,
} from "./keyVault.js";
export {
    importDotEnv,
    parseDotEnvFile,
    parseDotEnvText,
    flatEnvToConfigTree,
    writeConfigYamlFile,
    type ImportResult,
} from "./import.js";
export {
    redactFlat,
    redactTree,
    shouldRedact,
    SECRET_KEY_PATTERN,
    REDACTED,
} from "./redact.js";
export { runCli, type CliIO, type CliArgs } from "./cli.js";
export { validateConfigTree, configTreeSchema } from "./schema.js";
export {
    ConfigSource,
    type ComputeConfigDriftOptions,
    type ConfigDrift,
    type ConfigScalar,
    type ConfigTree,
    type FlatEnv,
    type KeyVaultOptions,
    type LoadConfigOptions,
    type LoadConfigResult,
    type SourceMap,
} from "./types.js";

// Typed runtime config (Phase A: schema + builder + shim).
export {
    REGIONS,
    isRegion,
    regionToEnvSuffix,
    regionFromEnvSuffix,
    type Region,
} from "./runtime/regions.js";
export {
    IDENTITY,
    authModeFromString,
    type AuthMode,
    type AzureOpenAIConfig,
    type AzureStorageConfig,
    type AwsStorageConfig,
    type Config,
    type DatabaseConfig,
    type Deployment,
    type DeploymentEndpoint,
    type DeploymentMode,
    type GoogleCalendarConfig,
    type MapsConfig,
    type MicrosoftGraphConfig,
    type OpenAIConfig,
    type SpeechConfig,
    type SpotifyConfig,
    type StorageConfig,
    type VaultConfig,
    type WikipediaConfig,
} from "./runtime/types.js";
export { buildConfig, parseSuffix } from "./runtime/build.js";
export {
    configToEnv,
    applyToProcessEnv,
    type EnvOutput,
} from "./runtime/shim.js";
export { envToYamlTree } from "./runtime/tree.js";
export {
    loadRuntimeConfigSync,
    type LoadRuntimeConfigOptions,
    type RuntimeConfigResult,
} from "./runtime/load.js";
