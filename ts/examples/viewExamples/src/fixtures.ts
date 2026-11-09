// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { digest, type ConstructionPacket } from "./packets.js";
import { readFileSync } from "node:fs";

const projects = [
    [
        "capacity-review",
        "Capacity review",
        "The project remains active. The incident is closed. Capacity review remains pending owner review.",
    ],
    [
        "accountability",
        "Accountability review",
        "Mira is the capacity reviewer, not the accountable service owner. The accountable service owner is unknown.",
    ],
    [
        "undated-milestone",
        "Routing acceptance",
        "The routing acceptance milestone is proposed. Its date is unknown.",
    ],
    [
        "corrected-decision",
        "Orders decision",
        "Orders approved a trial, not deployment. A later correction withdraws trial approval pending resident memory evidence.",
    ],
    [
        "scoped-identity",
        "Identity migration",
        "Identity migration in the desktop scope differs from Identity migration in the service scope. They are separate projects.",
    ],
    [
        "shared-concept",
        "Connection capacity",
        "Orders and Identity share connection capacity terminology. Shared infrastructure does not establish one project.",
    ],
] as const;

export function originalFixtures(): ConstructionPacket {
    return {
        schemaVersion: 1,
        purpose: "construction-only",
        dataset: "original",
        release: {
            repository: "https://github.com/microsoft/TypeAgent",
            revision: "original-fixtures-v1",
            license: "MIT",
            files: [
                {
                    path: "examples/viewExamples/src/fixtures.ts",
                    sha256: digest(
                        readFileSync(
                            new URL("../src/fixtures.ts", import.meta.url),
                            "utf8",
                        ),
                    ),
                },
            ],
        },
        bundles: projects.flatMap(([id, query, baseline], index) => {
            const update = `${baseline}\nCapacity review update: the owner has not approved production deployment.`;
            const correction = `${query} correction: a draft or trial does not establish production approval. Capacity review remains pending.`;
            const source = (suffix: string, retained: string, day: number) => ({
                id: `${id}-${suffix}`,
                version: suffix,
                title: `${query} ${suffix}`,
                text: retained,
                sha256: digest(retained),
                authoredAt: `2026-10-${String(10 + index + day).padStart(2, "0")}T00:00:00Z`,
            });
            return (["wiki", "projectBrief"] as const).map((kind) => ({
                id: `${id}-${kind}`,
                kind,
                query,
                aliases: [],
                sources: [
                    source("baseline", baseline, 0),
                    source("update", update, 1),
                    source("correction", correction, 2),
                ],
            }));
        }),
    };
}
