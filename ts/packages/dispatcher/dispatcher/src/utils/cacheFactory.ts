// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { AgentCacheFactory } from "@typeagent/agent-cache";

const cacheFactory = new AgentCacheFactory();

export function getCacheFactory() {
    return cacheFactory;
}
