// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import path from "node:path";
import type { SessionContext } from "@typeagent/agent-sdk";
import type { BrowserActionContext } from "./browserActions.mjs";

export async function getSessionFolderPath(
    context: SessionContext<BrowserActionContext>,
): Promise<string | undefined> {
    if (!(await context.sessionStorage?.exists("settings.json"))) {
        await context.sessionStorage?.write("settings.json", "");
    }
    const files = await context.sessionStorage?.list("", { fullPath: true });
    return files?.length ? path.dirname(files[0]) : undefined;
}
