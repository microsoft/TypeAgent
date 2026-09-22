// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    LiveSkillCatalog,
    SkillAcquirer,
    type SkillAcquirerOptions,
} from "@typeagent/skill-catalog";
import { getFsStorageProvider } from "dispatcher-node-providers";
import path from "node:path";

export type LocalSkillAcquisitionOptions = Omit<
    SkillAcquirerOptions,
    "stagingRoot"
>;

export type LocalSkillServices = {
    skillCatalog: LiveSkillCatalog;
    skillAcquirer: SkillAcquirer;
};

export async function createLocalSkillServices(
    instanceDir: string,
    options: LocalSkillAcquisitionOptions = {},
): Promise<LocalSkillServices> {
    const storage = getFsStorageProvider().getStorage(
        "skillCatalog",
        instanceDir,
    );
    const skillCatalog = await LiveSkillCatalog.create(storage);
    return {
        skillCatalog,
        skillAcquirer: new SkillAcquirer(skillCatalog, {
            ...options,
            stagingRoot: path.resolve(instanceDir, "skill-acquisition-staging"),
        }),
    };
}
