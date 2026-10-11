// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { parseViewDraftCapability } from "./viewBuildValidation.js";
import type { FileMemoryServiceOptions } from "./fileMemoryService.js";

export function getConfiguredMemoryViewOptions(
    environment: Readonly<Record<string, string | undefined>> = process.env,
): Pick<FileMemoryServiceOptions, "viewDrafts" | "informationalViews"> {
    return {
        viewDrafts: parseViewDraftCapability(
            environment.TYPEAGENT_MEMORY_VIEW_DRAFTS,
        ),
        informationalViews: parseViewDraftCapability(
            environment.TYPEAGENT_MEMORY_INFORMATIONAL_VIEWS,
            "TYPEAGENT_MEMORY_INFORMATIONAL_VIEWS",
        ),
    };
}
