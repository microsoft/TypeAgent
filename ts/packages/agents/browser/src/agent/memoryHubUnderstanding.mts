// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { MemoryHubFunctions } from "@typeagent/browser-control-rpc/viewRpc";
import type { MemoryService } from "@typeagent/memory-service";

export function createMemoryHubUnderstandingFunctions(
    getService: () => MemoryService,
): Pick<
    MemoryHubFunctions,
    | "memoryHubUnderstand"
    | "memoryHubUnderstandingModule"
    | "memoryHubCancelUnderstanding"
> {
    return {
        async memoryHubCancelUnderstanding(request) {
            const service = getService();
            if (!service.cancelUnderstanding)
                throw new Error(
                    "Memory understanding cancellation is not supported",
                );
            return service.cancelUnderstanding(request);
        },
        async memoryHubUnderstand(request) {
            const service = getService();
            if (!service.understand)
                throw new Error("Memory understanding is not supported");
            return service.understand(request);
        },
        async memoryHubUnderstandingModule(request) {
            const service = getService();
            if (!service.understandingModule)
                throw new Error(
                    "Memory understanding modules are not supported",
                );
            return service.understandingModule(request);
        },
    };
}
