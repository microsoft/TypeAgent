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
