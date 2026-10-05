// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { migrateLegacyMemoryLocation } from "./memoryHubMigration";

test("HTTP legacy redirects retain browser fragments and graph selection before removing the compatibility marker", () => {
    const analytics = migrateLegacyMemoryLocation(
        "http://localhost:123/library/memoryHub.html?query=A%26B&legacyView=knowledgeLibrary#analytics",
    );
    expect(analytics.hash).toBe("#/explore/web/analytics");
    expect(analytics.searchParams.get("query")).toBe("A&B");
    expect(analytics.searchParams.has("legacyView")).toBe(false);
    const entity = migrateLegacyMemoryLocation(
        "http://localhost:123/library/memoryHub.html?entity=A%26B%20%2F%20C&legacyView=entityGraph#detail",
    );
    expect(entity.hash).toBe("#/explore/web/entities/A%26B%20%2F%20C");
    expect(entity.searchParams.get("entity")).toBe("A&B / C");
});

test("modern routes are unchanged and compatibility links cannot select unrelated applications", () => {
    const modern =
        "http://localhost:123/library/memoryHub.html?query=Worker#/runbooks/a/p/procedure/3";
    expect(migrateLegacyMemoryLocation(modern).href).toBe(modern);
    expect(() =>
        migrateLegacyMemoryLocation(
            "http://localhost:123/library/memoryHub.html?legacyView=automationsLibrary",
        ),
    ).toThrow("invalid");
    const preserved = migrateLegacyMemoryLocation(
        "http://localhost:123/library/memoryHub.html?legacyView=memoryCenter#/library/a/source",
    );
    expect(preserved.hash).toBe("#/library/a/source");
});
