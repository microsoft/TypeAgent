// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createMemoryViewPackageManager } from "../src/memoryViewPackages.js";
import { createMemoryViewPackageManager as shared } from "@typeagent/package-installation";

test("the legacy host export uses the shared package manager", () => {
    expect(createMemoryViewPackageManager).toBe(shared);
});
