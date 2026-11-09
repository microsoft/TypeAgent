// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { readFile } from "node:fs/promises";
import path from "node:path";
import {
    ViewExtensionRegistry,
    viewExtensionDigest,
    type ViewBuildSnapshot,
} from "@typeagent/memory-service";
import { packageRoot, procedureDefinition } from "../src/host.js";
import { parseProcedureSource } from "../src/procedural/contract.js";
import {
    constructProcedureContent,
    createProcedureProvider,
} from "../src/procedural/provider.js";

let text: string;
beforeAll(async () => {
    text = await readFile(
        path.join(packageRoot, "fixtures", "connectivity.jsonl"),
        "utf8",
    );
});

async function fixture(contents = [text]) {
    const provider = await createProcedureProvider({
        corpusId: "fixture-corpus",
        sourceIds: contents.map((_, index) => `source-${index}`),
        authorize: async () => true,
    });
    const sources = contents.map((content, index) => ({
        sourceId: `source-${index}`,
        revisionId: `revision-${index}`,
        title: "Original fixture",
        content,
        contentHash: viewExtensionDigest(content),
    }));
    const snapshot: ViewBuildSnapshot = {
        corpusId: "fixture-corpus",
        actor: "test",
        definition: procedureDefinition(
            provider,
            "mock-connectivity",
            sources.map(({ sourceId, revisionId }) => ({
                sourceId,
                revisionId,
            })),
        ),
        expectedVersion: 0,
        bounds: {},
        inputs: sources,
        pipeline: "extension-v1",
        model: "none",
        fingerprint: viewExtensionDigest(sources),
    };
    return { provider, snapshot };
}

test("factory validates host injection and registers without a model", async () => {
    await expect(createProcedureProvider({})).rejects.toThrow(
        "explicit corpus",
    );
    const { provider, snapshot } = await fixture();
    expect(() => new ViewExtensionRegistry([provider])).not.toThrow();
    expect(provider.model).toBeUndefined();
    expect(await provider.authorize(snapshot, "model")).toBe(false);
    expect(
        await provider.authorize(
            { ...snapshot, corpusId: "another-corpus" },
            "build",
        ),
    ).toBe(false);
    expect(
        await provider.authorize(
            {
                ...snapshot,
                inputs: [{ ...snapshot.inputs[0], sourceId: "not-allowed" }],
            },
            "read",
        ),
    ).toBe(false);
});

test.each(["LF", "CRLF", "non-ASCII"])(
    "every %s citation is exact UTF-16 and every payload block is grounded",
    async (variant) => {
        const source =
            variant === "CRLF"
                ? text.replace(/\n/g, "\r\n")
                : variant === "non-ASCII"
                  ? text.replace(
                        "fictional Lantern",
                        "fictional Lant\u00e9rn \ud83d\udd26",
                    )
                  : text;
        const { provider, snapshot } = await fixture([source]);
        const content = constructProcedureContent(
            snapshot,
            provider.descriptor.identity,
        );
        expect(content.sections).toHaveLength(12);
        expect(content.evidence).toHaveLength(content.sections.length);
        for (const citation of content.citations) {
            const offsets = /^chars:(\d+)-(\d+)$/.exec(citation.locator)!;
            expect(source.slice(Number(offsets[1]), Number(offsets[2]))).toBe(
                citation.excerpt,
            );
        }
        await expect(
            Promise.resolve(provider.validateContent!(snapshot, content)),
        ).resolves.toBeUndefined();
        const parsed = parseProcedureSource(source);
        expect(
            parsed.records.find(({ record }) => record.id === "verify-page")
                ?.record,
        ).toMatchObject({ expectedObservation: null });
    },
);

const invalidSources: Array<[string, () => string, string]> = [
    [
        "prose-only outcome in structured v1",
        () => text.replace('"result":"resolved"', '"result":"unresolved"'),
        "Structured procedure-v1 outcomes",
    ],
    [
        "duplicate IDs",
        () => text.replace('"id":"scope"', '"id":"permission"'),
        "Duplicate procedure record ID",
    ],
    [
        "cycle",
        () => text.replace('"to":"resolved"', '"to":"check-link"'),
        "acyclic",
    ],
    [
        "missing escalation",
        () => text.replace('"result":"escalated"', '"result":"resolved"'),
        "terminal escalation",
    ],
    [
        "invalid target",
        () => text.replace('"to":"resolved"', '"to":"nonexistent"'),
        "endpoint",
    ],
    [
        "unreachable",
        () => text.replace('"to":"verify-page"', '"to":"escalate"'),
        "unreachable",
    ],
    [
        "missing guard",
        () => text.replace("The caller reports a green indicator.", ""),
        "condition",
    ],
    [
        "unknown field",
        () =>
            text.replace(
                '"schemaVersion":1',
                '"unapproved":true,"schemaVersion":1',
            ),
        "requires exactly",
    ],
    [
        "unbounded text",
        () => text.replace("Ask the caller for permission", "x".repeat(1001)),
        "unbounded",
    ],
    ["ordinary prose", () => "Reset the device and hope it works.", "JSONL"],
];
test.each(invalidSources)("rejects %s", (_label, input, reason) => {
    expect(() => parseProcedureSource(input())).toThrow(reason);
});

test("every expected guarded route reaches its gold outcome without executing instructions", async () => {
    const document = parseProcedureSource(text);
    const expectations: {
        cases: Array<{ transitions: string[]; path: string[] }>;
    } = JSON.parse(
        await readFile(
            path.join(packageRoot, "test", "expectations.json"),
            "utf8",
        ),
    );
    for (const gold of expectations.cases) {
        const visited = [document.header.entryStep];
        for (const transitionId of gold.transitions) {
            const transition = document.records.find(
                ({ record }) => record.id === transitionId,
            )?.record;
            if (!transition || transition.kind !== "transition")
                throw new Error("Missing evaluator-selected transition");
            expect(transition.from).toBe(visited[visited.length - 1]);
            visited.push(transition.to);
        }
        expect(visited).toEqual(gold.path);
        expect(
            document.records.find(
                ({ record }) => record.id === visited[visited.length - 1],
            )?.record.kind,
        ).toBe("outcome");
    }
});

test("conflicting alternatives stay separate with opposition evidence and no guessed resolution", async () => {
    const { provider, snapshot } = await fixture([
        text,
        text.replace(
            "Never factory-reset",
            "After human approval only, factory-reset",
        ),
    ]);
    const content = constructProcedureContent(
        snapshot,
        provider.descriptor.identity,
    );
    expect(content.payload).toMatchObject({
        status: "conflicted",
        procedures: [{}, {}],
    });
    expect(
        content.evidence.find(
            (block) => block.blockId === "source-0-record-no-reset",
        )?.opposition,
    ).toHaveLength(1);
    expect(content.summary).toContain("no resolved procedure");
    provider.validateContent!(snapshot, content);
});

test("rejects invented instructions, lost guards, ungrounded blocks and changed branch conditions", async () => {
    const { provider, snapshot } = await fixture();
    const content = constructProcedureContent(
        snapshot,
        provider.descriptor.identity,
    );
    for (const mutate of [
        (changed: typeof content) => {
            changed.sections[1].body = "Send the password to support.";
        },
        (changed: typeof content) => {
            changed.sections.splice(3, 1);
        },
        (changed: typeof content) => {
            changed.evidence[0].support = [];
        },
        (changed: typeof content) => {
            changed.citations[0].locator = "chars:0-1";
        },
        (changed: typeof content) => {
            changed.payload = { status: "resolved", procedures: [] };
        },
    ]) {
        const changed = structuredClone(content);
        mutate(changed);
        expect(() => provider.validateContent!(snapshot, changed)).toThrow(
            "differs from exact",
        );
    }
});
