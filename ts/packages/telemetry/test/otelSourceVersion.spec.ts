// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    readTypeAgentSourceVersionFromEnvironment,
    resolveTypeAgentSourceVersion,
    type GitVersionReader,
} from "../src/otel/sourceVersion.js";

describe("resolveTypeAgentSourceVersion", () => {
    it("records the local commit and official merge-base", async () => {
        const calls: string[][] = [];
        const readVersion: GitVersionReader = async (args) => {
            calls.push([...args]);
            return args[0] === "rev-parse" ? "local-commit" : "official-commit";
        };

        await expect(
            resolveTypeAgentSourceVersion(readVersion),
        ).resolves.toEqual({
            headRevision: "local-commit",
            baseRevision: "official-commit",
        });
        expect(calls).toEqual([
            ["rev-parse", "HEAD"],
            ["merge-base", "HEAD", "origin/main"],
        ]);
    });

    it("prefers configured production revisions and skips Git", async () => {
        const readVersion: GitVersionReader = async () => {
            throw new Error("Git should not be called");
        };

        await expect(
            resolveTypeAgentSourceVersion(readVersion, {
                headRevision: "production-head",
                baseRevision: "production-base",
            }),
        ).resolves.toEqual({
            headRevision: "production-head",
            baseRevision: "production-base",
        });
    });

    it("uses Git only for revisions missing from production metadata", async () => {
        const calls: string[][] = [];
        const readVersion: GitVersionReader = async (args) => {
            calls.push([...args]);
            return "git-base";
        };

        await expect(
            resolveTypeAgentSourceVersion(readVersion, {
                headRevision: "production-head",
            }),
        ).resolves.toEqual({
            headRevision: "production-head",
            baseRevision: "git-base",
        });
        expect(calls).toEqual([["merge-base", "HEAD", "origin/main"]]);
    });

    it("uses baked build revisions before runtime Git", async () => {
        const readVersion: GitVersionReader = async () => {
            throw new Error("Git should not be called");
        };

        await expect(
            resolveTypeAgentSourceVersion(
                readVersion,
                {},
                {
                    headRevision: "build-head",
                    baseRevision: "build-base",
                },
            ),
        ).resolves.toEqual({
            headRevision: "build-head",
            baseRevision: "build-base",
        });
    });

    it("allows runtime OTel attributes to override baked revisions", async () => {
        const readVersion: GitVersionReader = async () => {
            throw new Error("Git should not be called");
        };

        await expect(
            resolveTypeAgentSourceVersion(
                readVersion,
                {
                    headRevision: "runtime-head",
                    baseRevision: "runtime-base",
                },
                {
                    headRevision: "build-head",
                    baseRevision: "build-base",
                },
            ),
        ).resolves.toEqual({
            headRevision: "runtime-head",
            baseRevision: "runtime-base",
        });
    });

    it("omits source versions that are unavailable", async () => {
        const readVersion: GitVersionReader = async (args) =>
            args[0] === "rev-parse" ? "local-commit" : undefined;

        await expect(
            resolveTypeAgentSourceVersion(readVersion),
        ).resolves.toEqual({
            headRevision: "local-commit",
        });
    });
});

describe("readTypeAgentSourceVersionFromEnvironment", () => {
    const ENV_KEY = "OTEL_RESOURCE_ATTRIBUTES";
    let saved: string | undefined;

    beforeEach(() => {
        saved = process.env[ENV_KEY];
    });

    afterEach(() => {
        if (saved === undefined) {
            delete process.env[ENV_KEY];
        } else {
            process.env[ENV_KEY] = saved;
        }
    });

    it("reads standard OTel VCS resource attributes", () => {
        process.env[ENV_KEY] =
            "vcs.ref.head.revision=production-head,vcs.ref.base.revision=production-base";

        expect(readTypeAgentSourceVersionFromEnvironment()).toEqual({
            headRevision: "production-head",
            baseRevision: "production-base",
        });
    });

    it("ignores unrelated OTel resource attributes", () => {
        process.env[ENV_KEY] = "deployment.environment.name=production";

        expect(readTypeAgentSourceVersionFromEnvironment()).toEqual({});
    });
});
