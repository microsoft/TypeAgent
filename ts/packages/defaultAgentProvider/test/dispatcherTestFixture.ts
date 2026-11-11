// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { Dispatcher } from "agent-dispatcher";

export function createDispatcherTestFixture<
    T extends Pick<Dispatcher, "close">,
>(initialize: () => Promise<T>) {
    const dispatcher = initialize();
    return {
        dispatcher,
        async close() {
            await (await dispatcher).close();
        },
    };
}
