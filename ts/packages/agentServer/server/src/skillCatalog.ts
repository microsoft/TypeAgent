// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { SkillCatalog } from "@typeagent/skill-catalog";
import { getFsStorageProvider } from "dispatcher-node-providers";

export function createLocalSkillCatalog(instanceDir: string): SkillCatalog {
    const storage = getFsStorageProvider().getStorage(
        "skillCatalog",
        instanceDir,
    );
    return new SkillCatalog(storage);
}
