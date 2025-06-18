// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import fs from "node:fs";
import { CommandHandlerContext } from "../context/commandHandlerContext.js";
import { askYesNoWithContext } from "../context/interactiveIO.js";

export async function checkOverwriteFile(
    filePath: string | undefined,
    context: CommandHandlerContext,
) {
    if (filePath === undefined || !fs.existsSync(filePath)) {
        return;
    }
    const message = `File '${filePath}' exists.  Overwrite?`;
    if (!(await askYesNoWithContext(context, message, true))) {
        throw new Error("Aborted!");
    }
}
