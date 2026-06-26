// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import os from "node:os";
import path from "node:path";

// Expand a leading "~" to the user's home directory.
export function expandHome(pathname: string): string {
    if (pathname === "~") {
        return os.homedir();
    }
    if (pathname.startsWith(`~/`) || pathname.startsWith(`~\\`)) {
        return path.join(os.homedir(), pathname.substring(2));
    }
    return pathname;
}

// Expand ${ENV} references against process.env (design §6 config paths).
// Unknown variables expand to an empty string.
export function expandEnv(
    value: string,
    env: NodeJS.ProcessEnv = process.env,
): string {
    return value.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_, name) => {
        return env[name] ?? "";
    });
}

// Expand both ${ENV} and a leading "~".
export function expandPath(
    value: string,
    env: NodeJS.ProcessEnv = process.env,
): string {
    return expandHome(expandEnv(value, env));
}
