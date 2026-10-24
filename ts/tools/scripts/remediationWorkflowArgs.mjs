// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const switches = new Set([
    "--dry-run",
    "--show-chains",
    "--skip-shell-check",
    "--skip-install",
    "--json",
    "--verbose",
]);
const packageFilters = new Set([
    "--auto-fix",
    "--apply-overrides",
    "--update-parents",
]);
const packageName = /^(?:@[a-zA-Z0-9._-]+\/)?[a-zA-Z0-9._-]+$/;

function isPackageList(value) {
    return value.split(",").every((name) => packageName.test(name));
}

export function parseRemediationWorkflowArgs(input, minimumAgeDays = 0) {
    if (
        typeof input !== "string" ||
        !Number.isSafeInteger(minimumAgeDays) ||
        minimumAgeDays < 0
    ) {
        throw new Error(
            "Invalid remediation argument input or release-age policy.",
        );
    }
    const result = [];
    for (const token of input.trim().split(/\s+/).filter(Boolean)) {
        const separator = token.indexOf("=");
        const flag = separator < 0 ? token : token.slice(0, separator);
        const value = separator < 0 ? undefined : token.slice(separator + 1);
        if (packageFilters.has(flag)) {
            if (value !== undefined && !isPackageList(value)) {
                throw new Error(
                    "Invalid package filter in remediation arguments.",
                );
            }
            // The workflow selects and verifies one package at a time.
            continue;
        }
        if (switches.has(flag) && value === undefined) {
            result.push(flag);
            continue;
        }
        if (flag === "--show-chains" && value === "full") {
            result.push(token);
            continue;
        }
        if (
            flag === "--min-release-age-days" &&
            value !== undefined &&
            /^\d+$/.test(value) &&
            Number.isSafeInteger(Number(value)) &&
            Number(value) >= minimumAgeDays
        ) {
            result.push(token);
            continue;
        }
        throw new Error("Unsupported remediation workflow argument or value.");
    }
    return result;
}

const script = fileURLToPath(import.meta.url);
const invoked = process.argv[1] && resolve(process.argv[1]);
const isMain =
    invoked &&
    (process.platform === "win32"
        ? invoked.toLowerCase() === script.toLowerCase()
        : invoked === script);
if (isMain) {
    try {
        const minimumAgeDays = Number(
            process.env.DEPENDABOT_MIN_RELEASE_AGE_DAYS ?? "0",
        );
        const args = parseRemediationWorkflowArgs(
            process.env.REMEDIATION_EXTRA_ARGS ?? "--auto-fix",
            minimumAgeDays,
        );
        process.stdout.write(args.join(" "));
    } catch (error) {
        console.error(`::error::${error.message}`);
        process.exitCode = 1;
    }
}
