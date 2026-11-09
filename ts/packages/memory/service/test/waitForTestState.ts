// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export async function waitForTestState<T>(
    read: () => Promise<T>,
    settled: (value: T) => boolean,
    description: string,
): Promise<T> {
    // Allow slow CI filesystem work without adding a fixed delay to fast tests.
    const deadline = Date.now() + 60_000;
    while (true) {
        const value = await read();
        if (settled(value)) return value;
        if (Date.now() >= deadline)
            throw new Error(
                `${description} did not settle: ${JSON.stringify(value)}`,
            );
        await new Promise((resolve) => setTimeout(resolve, 20));
    }
}
