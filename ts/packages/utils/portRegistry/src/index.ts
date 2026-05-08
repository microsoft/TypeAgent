// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export {
    DEFAULT_REGISTRY_PORT,
    Namespaces,
    REGISTRY_PORT_ENV,
    USE_REGISTRY_ENV,
} from "./protocol.js";
export type {
    AllocateRequest,
    AllocateResponse,
    LookupResponse,
    Namespace,
    RegisterRequest,
    StatusEntry,
    StatusResponse,
} from "./protocol.js";

export { reservePorts } from "./allocator.js";

export {
    PortRegistry,
    getRegistryPort,
    globalRegistry,
    isRegistryEnabled,
} from "./client.js";
export type { PortRegistryOptions } from "./client.js";

export { RegistryState, startRegistryServer } from "./server.js";
export type { StartResult } from "./server.js";
