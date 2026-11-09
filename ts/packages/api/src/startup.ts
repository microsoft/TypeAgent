// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Keep configuration validation ahead of every listener or dispatcher start.
 * Tests inject a start callback to verify invalid configuration cannot listen.
 */
export async function startAfterBootstrap<TRuntime, TResult>(
    bootstrap: () => Promise<TRuntime>,
    start: (runtime: TRuntime) => Promise<TResult>,
): Promise<TResult> {
    const runtime = await bootstrap();
    return start(runtime);
}
