// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { renderDerivedViewUsage } from "./memoryHubViewUsage";
import { invokeMemory } from "./viewClient";

jest.mock("./viewClient", () => ({
    invokeMemory: jest.fn(),
    invokeView: jest.fn(),
}));
test("Used by opens the exact derived revision, reports section impact and never substitutes latest", async () => {
    const invoke = invokeMemory as jest.Mock;
    const operations: Array<Promise<void>> = [];
    const usage = renderDerivedViewUsage(
        [
            {
                corpusId: "c",
                viewId: "wiki",
                kind: "wiki",
                title: "Payments",
                revisionId: "exact",
                version: 1,
                state: "historical",
                sectionIds: ["pool"],
                reason: "stale; generated",
            },
        ],
        1,
        (operation) => {
            operations.push(operation());
        },
    );
    document.body.replaceChildren(usage);
    invoke.mockResolvedValue({
        revisionId: "exact",
        version: 1,
        content: {
            kind: "wiki",
            title: "Payments",
            sections: [
                {
                    id: "pool",
                    heading: "Pressure",
                    body: "Unresolved pressure",
                    details: { kind: "page", taxonomy: "concept" },
                },
            ],
            citations: [],
        },
    });
    usage.querySelector("button")!.click();
    await operations.pop();
    expect(invoke).toHaveBeenCalledWith("memoryGetView", {
        corpusId: "c",
        viewId: "wiki",
        revisionId: "exact",
    });
    expect(usage.textContent).toContain("Affected sections/pages: pool");
    expect(usage.textContent).toContain(
        "Historical inspection is not current publication",
    );
    invoke.mockResolvedValue({ revisionId: "latest", content: {} });
    usage.querySelector("button")!.click();
    await expect(operations.pop()).rejects.toThrow("latest is not substituted");
});
