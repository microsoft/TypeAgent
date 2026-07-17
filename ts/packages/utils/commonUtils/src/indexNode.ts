// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export { Limiter, createLimiter } from "./limiter.js";
export * from "./print.js";

export * from "./types.js";

export { simpleStarRegex } from "./simpleStartRegex.js";

export {
    getObjectPropertyNames,
    getObjectProperty,
    setObjectProperty,
} from "./objectProperty.js";

export { uint8ArrayToBase64, base64ToUint8Array } from "./base64Node.js";

export { createPromiseWithResolvers } from "./promiseWithResolvers.js";

export { resolveCliOnPath, claudeExecutableOption } from "./cliPath.js";

export {
    filterSecrets,
    filterSecretsFromObject,
    filterSecretsFromJsonString,
    createSecretFilter,
    SECRET_PATTERNS,
    DEFAULT_SECRET_REPLACEMENT,
    type SecretPattern,
    type SecretFilter,
    type FilterSecretsOptions,
    type CreateSecretFilterOptions,
} from "./secretFilter.js";
