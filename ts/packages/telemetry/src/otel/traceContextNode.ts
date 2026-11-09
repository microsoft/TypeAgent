// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { AsyncLocalStorage } from "node:async_hooks";
import {
    installAmbientTypeAgentAttributeStore,
    type AmbientTypeAgentAttributeStore,
    type TypeAgentSpanAttributes,
} from "./traceContract.js";

export * from "./traceContract.js";

const ambientAttributes = new AsyncLocalStorage<TypeAgentSpanAttributes>();

const nodeAmbientStore: AmbientTypeAgentAttributeStore = {
    getActive: () => ambientAttributes.getStore(),
    run: (attributes, body) => ambientAttributes.run(attributes, body),
};

export function installNodeAmbientTelemetryContext(): void {
    installAmbientTypeAgentAttributeStore(nodeAmbientStore);
}

installNodeAmbientTelemetryContext();
