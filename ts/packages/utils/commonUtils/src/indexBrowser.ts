// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export {
    getObjectPropertyNames,
    getObjectProperty,
    setObjectProperty,
} from "./objectProperty.js";
export { createLimiter } from "./limiter.js";

export { uint8ArrayToBase64, base64ToUint8Array } from "./base64Browser.js";

export { createPromiseWithResolvers } from "./promiseWithResolvers.js";

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
