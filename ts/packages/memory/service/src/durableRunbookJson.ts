// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { randomUUID } from "node:crypto";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

export async function writeRunbookJson(
    file: string,
    content: string,
    retained: () => boolean = () => true,
): Promise<void> {
    await mkdir(path.dirname(file), { recursive: true });
    const staged = `${file}.${randomUUID()}.staging`;
    try {
        await writeFile(staged, content, { flag: "wx" });
        const attempts = process.platform === "win32" ? 80 : 20;
        for (let attempt = 0; attempt < attempts; attempt++) {
            if (!retained()) return;
            try {
                await rename(staged, file);
                return;
            } catch (error) {
                const code = (error as NodeJS.ErrnoException).code;
                // Windows can briefly deny replacement while a reader/antivirus owns a handle.
                if (
                    !["EPERM", "EACCES", "EBUSY"].includes(code ?? "") ||
                    attempt === attempts - 1
                )
                    throw error;
                await new Promise<void>((resolve) =>
                    setTimeout(resolve, process.platform === "win32" ? 25 : 10),
                );
            }
        }
    } finally {
        await rm(staged, { force: true });
    }
}
