// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { FileMemoryService } from "../src/fileMemoryService.js";
import type { ViewBuildJob } from "../src/viewTypes.js";
import { waitForTestState } from "./waitForTestState.js";

export async function waitForViewBuild(
    service: Pick<FileMemoryService, "getViewBuild">,
    job: Pick<ViewBuildJob, "corpusId" | "jobId">,
) {
    return waitForTestState(
        async () => {
            const current = await service.getViewBuild({
                corpusId: job.corpusId,
                jobId: job.jobId,
            });
            if (!current)
                throw new Error(`Missing durable view build '${job.jobId}'`);
            return current;
        },
        (current) => current.state !== "running",
        `View build ${job.corpusId}/${job.jobId}`,
    );
}
