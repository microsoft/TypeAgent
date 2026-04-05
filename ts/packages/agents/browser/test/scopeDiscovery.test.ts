// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as fs from "fs";
import * as path from "path";

interface FlowScope {
    type: "site" | "global";
    domains?: string[];
    urlPatterns?: string[];
}

interface SampleFlow {
    name: string;
    scope: FlowScope;
}

interface ExpectedPage {
    simulatedDomain: string;
    scopeDiscovery: {
        shouldInclude: string[];
        shouldExclude: string[];
    };
}

interface ExpectedFlows {
    pages: Record<string, ExpectedPage>;
}

function loadSampleFlows(): SampleFlow[] {
    const samplesDir = path.resolve(
        __dirname,
        "..",
        "src",
        "agent",
        "webFlows",
        "samples",
    );
    const files = fs.readdirSync(samplesDir).filter((f) => f.endsWith(".json"));
    return files.map((f) => {
        const content = JSON.parse(
            fs.readFileSync(path.join(samplesDir, f), "utf8"),
        );
        return { name: content.name, scope: content.scope };
    });
}

function discoverByScope(domain: string, flows: SampleFlow[]): string[] {
    return flows
        .filter((flow) => {
            if (flow.scope.type === "global") return true;
            if (flow.scope.type === "site" && flow.scope.domains?.length) {
                return flow.scope.domains.some((d) => domain.endsWith(d));
            }
            return false;
        })
        .map((f) => f.name);
}

describe("scope-based discovery", () => {
    let flows: SampleFlow[];
    let expected: ExpectedFlows;

    beforeAll(() => {
        flows = loadSampleFlows();
        const expectedPath = path.resolve(
            __dirname,
            "fixtures",
            "discovery-pages",
            "expected-flows.json",
        );
        expected = JSON.parse(fs.readFileSync(expectedPath, "utf8"));
    });

    it("loads all sample flows", () => {
        expect(flows.length).toBeGreaterThanOrEqual(21);
    });

    for (const [pageName, pageExpected] of Object.entries(
        JSON.parse(
            fs.readFileSync(
                path.resolve(
                    __dirname,
                    "fixtures",
                    "discovery-pages",
                    "expected-flows.json",
                ),
                "utf8",
            ),
        ).pages as Record<string, ExpectedPage>,
    )) {
        describe(`${pageName} (${pageExpected.simulatedDomain})`, () => {
            it("includes expected flows", () => {
                const samplesDir = path.resolve(
                    __dirname,
                    "..",
                    "src",
                    "agent",
                    "webFlows",
                    "samples",
                );
                const files = fs
                    .readdirSync(samplesDir)
                    .filter((f) => f.endsWith(".json"));
                const allFlows: SampleFlow[] = files.map((f) => {
                    const content = JSON.parse(
                        fs.readFileSync(path.join(samplesDir, f), "utf8"),
                    );
                    return { name: content.name, scope: content.scope };
                });

                const discovered = discoverByScope(
                    pageExpected.simulatedDomain,
                    allFlows,
                );

                for (const flowName of pageExpected.scopeDiscovery
                    .shouldInclude) {
                    expect(discovered).toContain(flowName);
                }
            });

            it("excludes expected flows", () => {
                const samplesDir = path.resolve(
                    __dirname,
                    "..",
                    "src",
                    "agent",
                    "webFlows",
                    "samples",
                );
                const files = fs
                    .readdirSync(samplesDir)
                    .filter((f) => f.endsWith(".json"));
                const allFlows: SampleFlow[] = files.map((f) => {
                    const content = JSON.parse(
                        fs.readFileSync(path.join(samplesDir, f), "utf8"),
                    );
                    return { name: content.name, scope: content.scope };
                });

                const discovered = discoverByScope(
                    pageExpected.simulatedDomain,
                    allFlows,
                );

                for (const flowName of pageExpected.scopeDiscovery
                    .shouldExclude) {
                    expect(discovered).not.toContain(flowName);
                }
            });
        });
    }
});
