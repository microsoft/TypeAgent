// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { AsyncLocalStorage } from "node:async_hooks";
import {
    installAmbientTypeAgentAttributeStore,
    type AmbientTypeAgentAttributeStore,
    type TypeAgentSpanAttributes,
} from "./traceContract.js";

/**
 * Node-only companion to `traceContract.ts`.
 *
 * `traceContract.ts` is published as `@typeagent/telemetry/traceContext` and is
 * imported by browser-shared code, so it cannot import `node:async_hooks`. The
 * ambient attribute storage that keeps log correlation working in a process
 * with no OTel context manager lives here instead, and is installed into the
 * contract module when this file loads.
 *
 * Loading it is what installs the store: the package's Node entry point pulls
 * it in through `otel/index.ts`, and the `./traceContext` subpath resolves here
 * under the `node` condition, so both ways a Node caller reaches the contract
 * come with the store already installed. This file re-exports the whole
 * contract so it is a drop-in for that subpath.
 */

export * from "./traceContract.js";

const ambientAttributes = new AsyncLocalStorage<TypeAgentSpanAttributes>();

const nodeAmbientStore: AmbientTypeAgentAttributeStore = {
    getActive: () => ambientAttributes.getStore(),
    run: (attributes, body) => ambientAttributes.run(attributes, body),
};

/**
 * Install the `AsyncLocalStorage`-backed ambient store. Called on import;
 * exported so a host that replaced the store (or a test that exercised the
 * no-store browser path) can put it back. Installing the same store twice is a
 * no-op, and no scope is lost by doing so - the storage itself is created once.
 */
export function installNodeAmbientTelemetryContext(): void {
    installAmbientTypeAgentAttributeStore(nodeAmbientStore);
}

installNodeAmbientTelemetryContext();
