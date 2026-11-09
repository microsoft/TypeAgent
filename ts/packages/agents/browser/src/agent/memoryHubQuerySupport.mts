// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export async function timed<T>(work: Promise<T>, timeout = 30_000): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
        return await Promise.race([
            work,
            new Promise<never>((_, reject) => {
                timer = setTimeout(
                    () =>
                        reject(
                            new Error(
                                "Memory retrieval timed out; the underlying read may still finish.",
                            ),
                        ),
                    timeout,
                );
            }),
        ]);
    } finally {
        clearTimeout(timer);
    }
}
