// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { setTimeout as delay } from "node:timers/promises";

export async function retryProcedurePublication(
    publish: () => Promise<void>,
    wait: (milliseconds: number) => Promise<void> = delay,
    windows = process.platform === "win32",
): Promise<void> {
    for (let attempt = 0; attempt < 5; attempt++) {
        try {
            await publish();
            return;
        } catch (error) {
            const code = (error as NodeJS.ErrnoException).code;
            if (
                !windows ||
                !["EPERM", "EACCES", "EBUSY"].includes(code ?? "") ||
                attempt === 4
            ) {
                throw error;
            }
            // Windows scanners can briefly retain a directory handle after files close.
            await wait(25 * 2 ** attempt);
        }
    }
}
