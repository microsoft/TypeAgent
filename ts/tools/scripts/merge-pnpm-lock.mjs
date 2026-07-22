// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Git merge driver for pnpm-lock.yaml.  A line-level 3-way merge of a lockfile
// can silently produce an invalid result, so instead we keep our side and let
// pnpm rebuild a correct lockfile from the already-merged package.json files.
//
// git invokes this as: node merge-pnpm-lock.mjs %O %A %B %P
//   %O = common ancestor, %A = ours (git reads the merged result back from it),
//   %B = theirs, %P = path of the lockfile in the work tree (ts/pnpm-lock.yaml).

import { execSync } from "node:child_process";
import { copyFileSync } from "node:fs";
import { dirname } from "node:path";

const ours = process.argv[3]; // %A
const lockfilePath = process.argv[5]; // %P

try {
    // Seed with our lockfile, then let pnpm reconcile it to the merged manifests.
    copyFileSync(ours, lockfilePath);
    execSync(
        "pnpm install --lockfile-only --no-frozen-lockfile --ignore-scripts",
        { cwd: dirname(lockfilePath), stdio: "inherit" },
    );
    copyFileSync(lockfilePath, ours);
    process.exit(0);
} catch (err) {
    console.error(`[merge-pnpm-lock] regeneration failed: ${err.message}`);
    process.exit(1); // non-zero leaves the conflict for manual resolution
}
