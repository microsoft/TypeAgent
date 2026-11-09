// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { mkdir } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { packageRoot, runExample } from "./host.js";

async function main(): Promise<void> {
    const args = process.argv.slice(2);
    if (args.some((arg) => arg !== "--publish"))
        throw new Error(
            "Usage: pnpm start [--publish]. Offline only; --publish explicitly admits publication in this run's owned corpus.",
        );
    const runs = path.join(packageRoot, ".runs");
    await mkdir(runs, { recursive: true });
    const result = await runExample({
        outputDirectory: path.join(runs, randomUUID()),
        publish: args.includes("--publish"),
    });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
});
