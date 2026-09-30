// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
    validateAgentGroupCatalog,
    loadAgentGroupCatalog,
    findAgentGroup,
} from "../src/installSources/agentGroups.js";

function writeTempCatalog(content: unknown): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ta-agentgroups-"));
    const file = path.join(dir, "agentGroups.json");
    fs.writeFileSync(
        file,
        typeof content === "string" ? content : JSON.stringify(content),
    );
    return file;
}

describe("agentGroups", () => {
    it("validates a well-formed agent group catalog", () => {
        const catalog = validateAgentGroupCatalog({
            groups: {
                media: {
                    displayName: "Media Tools",
                    description: "Media creation and editing tools",
                    agents: ["photo", "image", "video"],
                },
            },
        });
        expect(catalog.groups.media).toBeDefined();
        expect(catalog.groups.media.displayName).toBe("Media Tools");
        expect(catalog.groups.media.agents).toEqual([
            "photo",
            "image",
            "video",
        ]);
    });

    it("throws on missing or invalid root object", () => {
        expect(() => validateAgentGroupCatalog(null)).toThrow(
            /expected a root object/i,
        );
        expect(() => validateAgentGroupCatalog([])).toThrow(
            /expected a root object/i,
        );
        expect(() => validateAgentGroupCatalog({ groups: null })).toThrow(
            /field 'groups' must be an object/i,
        );
    });

    it("throws on illegal group key or member name", () => {
        expect(() =>
            validateAgentGroupCatalog({
                groups: {
                    "123-bad": {
                        displayName: "Bad",
                        description: "Bad",
                        agents: ["photo"],
                    },
                },
            }),
        ).toThrow(/group '123-bad'.*invalid name/i);

        expect(() =>
            validateAgentGroupCatalog({
                groups: {
                    good: {
                        displayName: "Good",
                        description: "Good",
                        agents: ["123-bad-member!"],
                    },
                },
            }),
        ).toThrow(/invalid member/i);
    });

    it("throws on duplicate group key or duplicate member name (case-insensitive)", () => {
        expect(() =>
            validateAgentGroupCatalog({
                groups: {
                    media: {
                        displayName: "Media",
                        description: "Media",
                        agents: ["photo"],
                    },
                    MEDIA: {
                        displayName: "Media 2",
                        description: "Media 2",
                        agents: ["video"],
                    },
                },
            }),
        ).toThrow(/duplicates another group name/i);

        expect(() =>
            validateAgentGroupCatalog({
                groups: {
                    media: {
                        displayName: "Media",
                        description: "Media",
                        agents: ["photo", "Photo"],
                    },
                },
            }),
        ).toThrow(/duplicate member/i);
    });

    it("throws on empty agents array or empty descriptions", () => {
        expect(() =>
            validateAgentGroupCatalog({
                groups: {
                    media: {
                        displayName: "",
                        description: "Media",
                        agents: ["photo"],
                    },
                },
            }),
        ).toThrow(/'displayName' must be a non-empty string/i);

        expect(() =>
            validateAgentGroupCatalog({
                groups: {
                    media: {
                        displayName: "Media",
                        description: "",
                        agents: ["photo"],
                    },
                },
            }),
        ).toThrow(/'description' must be a non-empty string/i);

        expect(() =>
            validateAgentGroupCatalog({
                groups: {
                    media: {
                        displayName: "Media",
                        description: "Media",
                        agents: [],
                    },
                },
            }),
        ).toThrow(/'agents' must be a non-empty array/i);
    });

    it("findAgentGroup looks up groups case-insensitively", () => {
        const catalog = validateAgentGroupCatalog({
            groups: {
                developer: {
                    displayName: "Dev Tools",
                    description: "Developer tools",
                    agents: ["code", "visualStudio"],
                },
            },
        });
        const found = findAgentGroup(catalog, "Developer");
        expect(found).toBeDefined();
        expect(found!.key).toBe("developer");
        expect(found!.group.displayName).toBe("Dev Tools");

        expect(findAgentGroup(catalog, "nonexistent")).toBeUndefined();
    });

    it("loadAgentGroupCatalog loads and parses a file from disk", () => {
        const file = writeTempCatalog({
            groups: {
                testGroup: {
                    displayName: "Test",
                    description: "Testing group",
                    agents: ["agentA", "agentB"],
                },
            },
        });
        const catalog = loadAgentGroupCatalog(file);
        expect(catalog.groups.testGroup).toBeDefined();
        expect(catalog.groups.testGroup.agents).toEqual(["agentA", "agentB"]);
    });

    it("rejects unknown root and group fields", () => {
        expect(() =>
            validateAgentGroupCatalog({
                groups: {},
                typo: true,
            }),
        ).toThrow(/root contains unknown field.*typo/i);
        expect(() =>
            validateAgentGroupCatalog({
                groups: {
                    media: {
                        displayName: "Media",
                        description: "Media",
                        agents: ["photo"],
                        typo: true,
                    },
                },
            }),
        ).toThrow(/group 'media' contains unknown field.*typo/i);
    });

    it("enforces display-name and description bounds", () => {
        expect(() =>
            validateAgentGroupCatalog({
                groups: {
                    media: {
                        displayName: "x".repeat(101),
                        description: "Media",
                        agents: ["photo"],
                    },
                },
            }),
        ).toThrow(/field 'displayName'.*100/i);
        expect(() =>
            validateAgentGroupCatalog({
                groups: {
                    media: {
                        displayName: "Media",
                        description: "x".repeat(501),
                        agents: ["photo"],
                    },
                },
            }),
        ).toThrow(/field 'description'.*500/i);
    });

    it("reports missing files and malformed JSON with the file path", () => {
        const missing = path.join(
            os.tmpdir(),
            `missing-agent-groups-${Date.now()}.json`,
        );
        expect(() => loadAgentGroupCatalog(missing)).toThrow(
            new RegExp(`Could not read.*${path.basename(missing)}`, "i"),
        );
        const malformed = writeTempCatalog("{");
        expect(() => loadAgentGroupCatalog(malformed)).toThrow(
            new RegExp(`Invalid JSON.*${path.basename(malformed)}`, "i"),
        );
    });

    it("returns a deeply immutable catalog", () => {
        const catalog = validateAgentGroupCatalog({
            groups: {
                media: {
                    displayName: "Media",
                    description: "Media",
                    agents: ["photo"],
                },
            },
        });
        expect(Object.isFrozen(catalog)).toBe(true);
        expect(Object.isFrozen(catalog.groups)).toBe(true);
        expect(Object.isFrozen(catalog.groups.media)).toBe(true);
        expect(Object.isFrozen(catalog.groups.media.agents)).toBe(true);
    });

    it("loadAgentGroupCatalog loads the shipped agentGroups.json data file", () => {
        const catalog = loadAgentGroupCatalog();
        expect(catalog.groups.developer).toBeDefined();
        expect(catalog.groups.media).toBeDefined();
        expect(catalog.groups.developer.agents).toContain("code");
        expect(catalog.groups.media.agents).toContain("photo");
    });

    it("validates every shipped group member against workspace package metadata", () => {
        const packageRoot = path.resolve(
            path.dirname(fileURLToPath(import.meta.url)),
            "..",
            "..",
        );
        const tsRoot = path.resolve(packageRoot, "..", "..");
        const config = JSON.parse(
            fs.readFileSync(
                path.join(packageRoot, "data", "config.json"),
                "utf8",
            ),
        ) as {
            agents: Record<string, { name: string }>;
        };
        const packages = new Map<
            string,
            {
                private?: boolean;
                keywords?: string[];
                exports?: Record<string, unknown>;
                typeagent?: { defaultAgentName?: string };
            }
        >();
        for (const entry of fs.readdirSync(
            path.join(tsRoot, "packages", "agents"),
            { withFileTypes: true },
        )) {
            if (!entry.isDirectory()) {
                continue;
            }
            const packageFile = path.join(
                tsRoot,
                "packages",
                "agents",
                entry.name,
                "package.json",
            );
            if (!fs.existsSync(packageFile)) {
                continue;
            }
            const packageJson = JSON.parse(
                fs.readFileSync(packageFile, "utf8"),
            ) as {
                name?: string;
                private?: boolean;
                keywords?: string[];
                exports?: Record<string, unknown>;
                typeagent?: { defaultAgentName?: string };
            };
            if (packageJson.name !== undefined) {
                packages.set(packageJson.name, packageJson);
            }
        }

        const catalog = loadAgentGroupCatalog();
        for (const [groupName, group] of Object.entries(catalog.groups)) {
            for (const member of group.agents) {
                const configured = config.agents[member];
                expect(configured).toBeDefined();
                const packageJson = packages.get(configured.name);
                expect(packageJson).toBeDefined();
                expect(packageJson?.private).not.toBe(true);
                expect(packageJson?.keywords).toContain("typeagent-agent");
                expect(packageJson?.typeagent?.defaultAgentName).toBe(member);
                expect(
                    packageJson?.exports?.["./agent/manifest"],
                ).toBeDefined();
                expect(
                    packageJson?.exports?.["./agent/handlers"],
                ).toBeDefined();
                expect(groupName).toBeTruthy();
            }
        }
    });

    it("requires the catalog in agent-server bundles and MSI staging", () => {
        const packageRoot = path.resolve(
            path.dirname(fileURLToPath(import.meta.url)),
            "..",
            "..",
        );
        const tsRoot = path.resolve(packageRoot, "..", "..");
        const bundleScript = fs.readFileSync(
            path.join(tsRoot, "tools", "scripts", "bundleAgentServer.mjs"),
            "utf8",
        );
        const msiScript = fs.readFileSync(
            path.join(tsRoot, "tools", "scripts", "build-msi-local.mjs"),
            "utf8",
        );

        expect(bundleScript).toContain('"agentGroups.json"');
        expect(bundleScript).not.toMatch(
            /existsSync\(fullSource\)[\s\S]{0,120}copyFile\(fullSource/,
        );
        expect(msiScript).toContain("bundleAgentServer.mjs");
        expect(msiScript).toContain("agentDir");
    });
});
