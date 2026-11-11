// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export const {
    waitForViewBuild,
}: typeof import("../../service/dist/test/viewBuildTestWait.js") = await import(
    new URL("../../../service/dist/test/viewBuildTestWait.js", import.meta.url)
        .href
);
