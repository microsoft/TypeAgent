// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Minimal `ClientIO` implementation used by the collision-pipeline operational
// scripts (smoke test, probe runner). The dispatcher requires a `ClientIO`
// when booted; these scripts don't have a real shell or CLI to wire up, so
// every method is a no-op. Output the script wants to inspect goes through
// `appendDisplay`, which the caller can override by wrapping this helper.

import type { ClientIO } from "agent-dispatcher";

export function silentClientIO(
    overrides: Partial<ClientIO> = {},
): ClientIO {
    const noop = () => {};
    const noopAsync = async () => {};
    const base: ClientIO = {
        clear: noop,
        exit: noop,
        shutdown: noop,
        setUserRequest: noop,
        setDisplayInfo: noop,
        setDisplay: noop,
        appendDisplay: noop,
        appendDiagnosticData: noop,
        setDynamicDisplay: noop,
        question: async () => 0,
        proposeAction: async () => undefined,
        notify: noop as ClientIO["notify"],
        openLocalView: noopAsync,
        closeLocalView: noopAsync,
        requestChoice: noop,
        requestInteraction: noop,
        interactionResolved: noop,
        interactionCancelled: noop,
        takeAction: noop,
    };
    return { ...base, ...overrides };
}
