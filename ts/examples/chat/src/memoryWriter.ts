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
}
