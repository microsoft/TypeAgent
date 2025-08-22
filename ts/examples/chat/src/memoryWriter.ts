// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { getInteractiveIO, InteractiveIo } from "interactive-app";
import { ChalkWriter } from "examples-lib";

export class MemoryConsoleWriter extends ChalkWriter {
    constructor(io?: InteractiveIo | undefined) {
        if (!io) {
            io = getInteractiveIO();
        }
        super(io);
    }

    public writeJsonList(items: any[], indented: boolean, reverse = false) {
        if (reverse) {
            for (let i = items.length - 1; i >= 0; --i) {
                this.writeLine(`[${i + 1} / ${items.length}]`);
                this.writeJson(items[i], indented);
            }
        } else {
            for (let i = 0; i < items.length; ++i) {
                this.writeLine(`[${i + 1} / ${items.length}]`);
                this.writeJson(items[i], indented);
            }
        }
    }
}
