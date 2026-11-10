// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export interface TestWaitOptions {
    timeoutMs?: number;
    deadline?: number;
}

export async function waitForTestState<T>(
    read: () => Promise<T>,
    settled: (value: T) => boolean,
    description: string,
    options: TestWaitOptions = {},
): Promise<T> {
    const timeoutMs = options.timeoutMs ?? 30_000;
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0)
        throw new Error("Test wait timeout must be a positive finite duration");
    if (options.deadline !== undefined && !Number.isFinite(options.deadline))
        throw new Error("Test wait deadline must be finite");
    const deadline = Math.min(
        Date.now() + timeoutMs,
        options.deadline ?? Infinity,
    );
    let value: T | undefined;
    let reading = false;
    const timedOut = () =>
        new Error(
            `${description} did not settle: ${JSON.stringify(value) ?? "no state returned"}${reading ? " (state read pending)" : ""}`,
        );
    while (true) {
        const remaining = deadline - Date.now();
        if (remaining <= 0) throw timedOut();
        let timer: ReturnType<typeof setTimeout> | undefined;
        reading = true;
        try {
            value = await Promise.race([
                read(),
                new Promise<never>((_, reject) => {
                    timer = setTimeout(() => reject(timedOut()), remaining);
                }),
            ]);
        } finally {
            reading = false;
            clearTimeout(timer);
        }
        if (settled(value)) return value;
        if (Date.now() >= deadline) throw timedOut();
        await new Promise((resolve) =>
            setTimeout(resolve, Math.min(20, deadline - Date.now())),
        );
    }
}
