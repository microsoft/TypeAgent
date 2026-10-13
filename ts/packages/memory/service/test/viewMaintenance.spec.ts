// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    maintenanceManifest,
    resolveViewMaintenance,
    validateMaintenanceDefinition,
    type MaintenanceSource,
} from "../src/viewMaintenance.js";
import type { ViewDefinitionInput, ViewVersion } from "../src/viewTypes.js";

const source: MaintenanceSource = {
    sourceId: "s",
    corpusId: "c",
    sourceType: "text",
    title: "Payments",
    activeRevisionId: "r",
    tags: ["operations", "reviewed"],
    metadata: { project: "checkout" },
    revisions: [
        {
            revisionId: "r",
            state: "ready",
            content: "Capacity unknown",
            contentHash: "h",
            pipelineVersion: "1",
        },
    ],
};
const definition: ViewDefinitionInput = {
    viewId: "guide",
    kind: "troubleshootingGuide",
    selector: { kind: "sources", sources: [] },
    maintenance: {
        schemaVersion: 1,
        scope: {
            mode: "scopedSources",
            project: "checkout",
            tags: ["operations", "reviewed"],
            sourceTypes: ["text"],
        },
    },
};

test.each(["troubleshootingGuide", "timeline"] as const)(
    "%s retains bounded maintenance, dependency fingerprints, privacy and no-op planning",
    (kind) => {
        const target = { ...definition, kind };
        expect(resolveViewMaintenance(target, [], "model", {}).state).toBe(
            "blocked",
        );
        const plan = resolveViewMaintenance(target, [source], "model", {});
        expect(plan.state).toBe("rebuild");
        expect(plan.snapshot?.privacySources).toEqual(["s"]);
        expect(plan.snapshot?.dependencies).toHaveLength(1);
        const current: ViewVersion = {
            corpusId: "c",
            viewId: "guide",
            revisionId: "v",
            version: 1,
            state: "draft",
            provenance: "generated",
            createdAt: "2026-10-11T12:00:00Z",
            actor: "test",
            definition: { ...target, revisionId: "d" },
            content: {
                kind: "troubleshootingGuide",
                title: "Evidence",
                sections: [],
                citations: [],
            },
            relationships: [],
        };
        current.maintenance = maintenanceManifest(plan.snapshot!, current);
        expect(
            resolveViewMaintenance(target, [source], "model", {}, current)
                .state,
        ).toBe("unchanged");
        expect(
            resolveViewMaintenance(
                target,
                [source],
                "changed-model",
                {},
                current,
            ).state,
        ).toBe("rebuild");
        expect(
            resolveViewMaintenance(
                target,
                [{ ...source, metadata: { project: "other" } }],
                "model",
                {},
            ).state,
        ).toBe("blocked");
        expect(
            resolveViewMaintenance(
                target,
                [{ ...source, tags: ["operations"] }],
                "model",
                {},
            ).state,
        ).toBe("blocked");
        expect(
            resolveViewMaintenance(
                target,
                [
                    {
                        ...source,
                        revisions: [
                            { ...source.revisions[0], state: "processing" },
                        ],
                    },
                ],
                "model",
                {},
            ).reason,
        ).toContain("pending");
        expect(
            resolveViewMaintenance(
                target,
                [
                    {
                        ...source,
                        revisions: [
                            {
                                ...source.revisions[0],
                                content: "x".repeat(120001),
                            },
                        ],
                    },
                ],
                "model",
                {},
            ).reason,
        ).toContain("120000");
        expect(
            resolveViewMaintenance(
                target,
                Array.from({ length: 33 }, (_, index) => ({
                    ...source,
                    sourceId: `s${index}`,
                })),
                "model",
                {},
            ).reason,
        ).toContain("32");
        const fixed: ViewDefinitionInput = {
            ...target,
            maintenance: {
                schemaVersion: 1,
                scope: { mode: "currentSources", sourceIds: ["s"] },
            },
        };
        expect(
            resolveViewMaintenance(
                fixed,
                [source, { ...source, sourceId: "new" }],
                "model",
                {},
            ).snapshot?.dependencies,
        ).toHaveLength(1);
        expect(resolveViewMaintenance(fixed, [], "model", {}).reason).toContain(
            "missing",
        );
        expect(
            resolveViewMaintenance(
                {
                    ...target,
                    maintenance: {
                        schemaVersion: 1,
                        scope: { mode: "pinned" },
                    },
                },
                [source],
                "model",
                {},
            ).state,
        ).toBe("pinned");
    },
);

test("obsolete explicit-subject wiki maintenance rejects rather than migrating", () => {
    expect(() =>
        validateMaintenanceDefinition({ ...definition, kind: "wiki" }),
    ).toThrow("informational-wiki-v1");
    const old = {
        ...definition,
        maintenance: {
            ...definition.maintenance!,
            wikiDiscovery: {
                rules: "explicit-subjects-v1",
                createDraftPages: true,
                subjects: [],
            },
        },
    };
    expect(() => validateMaintenanceDefinition(old)).toThrow("fields");
});
