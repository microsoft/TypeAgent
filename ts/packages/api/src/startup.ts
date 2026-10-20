// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { Config } from "@typeagent/config";

/**
 * Keep configuration validation ahead of every listener or dispatcher start.
 * Tests inject a start callback to verify invalid configuration cannot listen.
 */
export async function startAfterBootstrap<T>(
    bootstrap: () => Promise<Config>,
    start: (config: Config) => Promise<T>,
): Promise<T> {
    const config = await bootstrap();
    return start(config);
}
