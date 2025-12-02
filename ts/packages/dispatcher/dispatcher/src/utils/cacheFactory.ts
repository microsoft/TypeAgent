// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { AgentCacheFactory } from "agent-cache";

const cacheFactory = new AgentCacheFactory();

export function getCacheFactory() {
    return cacheFactory;
}
