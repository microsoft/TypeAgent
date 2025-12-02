// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Storage } from "@typeagent/agent-sdk";

export interface StorageProvider {
    getStorage(name: string, baseDir: string): Storage;
}
