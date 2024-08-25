// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { StopWatch } from "common-utils";
import { RequestId } from "./interactiveIO.js";
import { CommandHandlerContext } from "./commandHandlerContext.js";
import { CommandHandler } from "./commandHandler.js";

export class Profiler {

    private timers: Map<RequestId, StopWatch> = new Map<RequestId, StopWatch>();

    constructor() {
        this.timers = new Map<RequestId, StopWatch>();
    }
    
    start(context: CommandHandlerContext, commandHandler: CommandHandler) {

        if (!this.timers.has(context.requestId)) {
            this.timers.set(context.requestId, new StopWatch());
        }

        this.timers.get(context.requestId)?.start();
    }

    stop(context: CommandHandlerContext, commandHandler: CommandHandler) {

        if (this.timers.has(context.requestId)) {
            this.timers.get(context.requestId)?.stop();
        }
    }

    get(requestId: RequestId): StopWatch | undefined {
        return this.timers.get(requestId);
    }
}
