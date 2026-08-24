// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { PowerShellStore } from "../store/powerShellStore.mjs";

export interface PowerShellAgentContext {
    store?: PowerShellStore | undefined;
}
