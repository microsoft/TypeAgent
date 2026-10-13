// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createHash, randomUUID } from "node:crypto";
import {
    link,
    mkdir,
    readFile,
    rm,
    symlink,
    writeFile,
} from "node:fs/promises";
import path from "node:path";
import {
    MacroManager,
    PrivateResultStore,
    constructResultPath,
    induceMacroFromTrace,
    learningToolResult,
    resolveMacroExpression,
    validateMacro,
    type PrivateResultReference,
    type RecordedInteractionTrace,
    type ValueExpression,
} from "@typeagent/copilot-macros";
import {
    assertLearningTrace,
    assertLearningProcedure,
} from "../src/macroLearningValidation.js";
import { parseMacroLearningBuild } from "../src/macroLearningParsers.js";

const hash = (bytes: Buffer) =>
    createHash("sha256").update(bytes).digest("hex");
let root: string;

beforeEach(async () => {
    root = path.resolve(".workiq-test-evidence", randomUUID());
    await mkdir(root, { recursive: true });
});
afterEach(async () => {
    await rm(root, { recursive: true, force: true });
    await rm(path.dirname(root), { recursive: false }).catch(() => undefined);
});

function blob(
    size = 1_200_000,
    contentType = "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
) {
    const bytes = Buffer.alloc(size, 0x41);
    bytes.write(
        "PK\u0003\u0004synthetic DOCX-like original containing media bytes",
    );
    return {
        bytes,
        result: {
            content: [],
            isError: false,
            structuredContent: {
                base64Content: bytes.toString("base64"),
                blobName: "generated.docx",
                contentType,
                sizeBytes: size,
                statusCode: 200,
            },
        },
    };
}

function sourceTrace(result: unknown): RecordedInteractionTrace {
    return {
        schemaVersion: 1,
        sessionId: "session",
        cwd: ".",
        prompt: "Retrieve the complete original file",
        response: "Completed",
        startedAt: "2026-10-01T00:00:00Z",
        completedAt: "2026-10-01T00:01:00Z",
        toolCalls: [
            {
                toolCallId: "blob-call",
                name: "fetch_blob",
                mcpServerName: "workiq",
                arguments: { path: "/drives/drive-A/items/item-A/content" },
                result,
                modelResult: result,
                status: "completed",
            },
        ],
    };
}

function filename(ref: PrivateResultReference) {
    return path.join(
        root,
        "evidence",
        ref.owner,
        ref.ownerId,
        `${ref.id}.json`,
    );
}

describe("private lossless result evidence", () => {
    it("keeps full replay step and final results across manager restart without truncated previews", async () => {
        const generated = blob();
        const host = {
            inspectTool: async (
                mcpServerName: string | undefined,
                toolName: string,
            ) => ({
                ...(mcpServerName ? { mcpServerName } : {}),
                toolName,
                schemaFingerprint: "synthetic",
            }),
            callTool: async () => generated.result,
        };
        const manager = new MacroManager(root, host);
        manager.armRecording({ sessionId: "session" });
        const token = manager.claimRecording({
            sessionId: "session",
            cwd: ".",
            promptHash: hash(
                Buffer.from("Retrieve the complete original file"),
            ),
        })!;
        const summary = await manager.finalizeRecording({
            tokenId: token.id,
            trace: sourceTrace(generated.result),
        });
        const draft = await manager.createMacroFromTrace({
            traceId: summary.traceId,
            name: "Replay original",
            description: "Synthetic",
        });
        const approved = await manager.approveMacro(draft);
        const response = await manager.runMacro({
            runId: "run-1",
            macroId: approved.macroId,
            version: approved.version,
            inputs: {},
        });
        expect(response.status).toBe("completed");
        const persisted = await new MacroManager(root, host).getMacroRun(
            "run-1",
        );
        expect(persisted.resultArtifact?.blobs[0].sha256).toBe(
            hash(generated.bytes),
        );
        expect(persisted.steps[0].resultArtifact?.blobs[0].sha256).toBe(
            hash(generated.bytes),
        );
        expect(JSON.stringify(persisted)).not.toContain('"truncated":true');
        expect(Buffer.byteLength(JSON.stringify(persisted))).toBeLessThan(
            32 * 1024,
        );
        const ref = persisted.steps[0].resultArtifact!;
        expect(
            await new PrivateResultStore(
                path.join(root, "copilot-macros"),
            ).verify(ref, "run", "run-1", ref.toolCallId, "result"),
        ).toEqual(generated.result);
    });
    it.each([
        ["application/octet-stream", 40_000],
        [
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            1_200_000,
        ],
    ])(
        "retains complete %s originals without exposing base64 in learning",
        async (mime, size) => {
            const generated = blob(size as number, mime as string);
            const store = new PrivateResultStore(root);
            const ref = (await store.retain(
                "trace",
                "trace-1",
                "call-1",
                "result",
                generated.result,
            ))!;
            expect(ref.encoding).toBe("json-utf8");
            expect(ref.sensitive).toBe(true);
            expect(ref.blobs).toEqual([
                {
                    path: ["structuredContent", "base64Content"],
                    encoding: "base64",
                    sha256: hash(generated.bytes),
                    sizeBytes: size,
                },
            ]);
            expect(Buffer.byteLength(JSON.stringify(ref))).toBeLessThan(
                32 * 1024,
            );
            expect(JSON.stringify(ref)).not.toContain(
                generated.result.structuredContent.base64Content,
            );
            expect(
                await new PrivateResultStore(root).verify(
                    ref,
                    "trace",
                    "trace-1",
                    "call-1",
                    "result",
                ),
            ).toEqual(generated.result);
            expect(await readFile(filename(ref), "utf8")).toBe(
                JSON.stringify(generated.result),
            );
            await expect(
                store.retain(
                    "trace",
                    "trace-1",
                    "call-1",
                    "result",
                    generated.result,
                ),
            ).rejects.toThrow();
        },
    );

    it("persists a bounded v2 trace, validates after restart and preserves model-result provenance", async () => {
        const generated = blob();
        const manager = new MacroManager(root);
        manager.armRecording({ sessionId: "session" });
        const token = manager.claimRecording({
            sessionId: "session",
            cwd: ".",
            promptHash: hash(
                Buffer.from("Retrieve the complete original file"),
            ),
        })!;
        const original = sourceTrace(generated.result);
        expect(() => assertLearningTrace(original)).toThrow("256 KiB");
        const summary = await manager.finalizeRecording({
            tokenId: token.id,
            trace: original,
        });
        expect(original.schemaVersion).toBe(1);
        const stored = JSON.parse(
            await readFile(
                path.join(
                    root,
                    "copilot-macros",
                    "traces",
                    `${summary.traceId}.json`,
                ),
                "utf8",
            ),
        );
        expect(stored.schemaVersion).toBe(2);
        expect(stored.capabilities).toEqual(["private-result-evidence-v1"]);
        expect(stored.toolCalls[0].modelResultArtifact.source).toBe(
            "modelResult",
        );
        expect(stored.toolCalls[0].resultArtifact.source).toBe("result");
        assertLearningTrace(stored);
        const restarted = new MacroManager(root);
        const draft = await restarted.createMacroFromTrace({
            traceId: summary.traceId,
            name: "Original retrieval",
            description: "",
        });
        const macro = await restarted.inspectMacro(draft);
        expect(macro.schemaVersion).toBe(1);
        expect(macro.steps[0].postconditions).not.toContainEqual({
            kind: "resultPathExists",
            path: ["structuredContent", "base64Content"],
        });
        expect(
            learningToolResult({
                ...stored.toolCalls[0],
                modelResultArtifact: undefined,
                modelResult: null,
            }),
        ).toBeNull();
        const ref = stored.toolCalls[0].resultArtifact;
        await writeFile(
            path.join(
                root,
                "copilot-macros",
                "evidence",
                "trace",
                summary.traceId,
                `${ref.id}.json`,
            ),
            "{}",
        );
        await expect(
            restarted.createMacroFromTrace({
                traceId: summary.traceId,
                name: "Tampered",
                description: "",
            }),
        ).rejects.toThrow("size");
    });

    it("rejects caller-supplied artifact traces", async () => {
        const manager = new MacroManager(root);
        manager.armRecording({ sessionId: "session" });
        const token = manager.claimRecording({
            sessionId: "session",
            cwd: ".",
            promptHash: hash(
                Buffer.from("Retrieve the complete original file"),
            ),
        })!;
        const trace = sourceTrace({});
        trace.toolCalls[0].resultArtifact = {} as PrivateResultReference;
        await expect(
            manager.finalizeRecording({ tokenId: token.id, trace }),
        ).rejects.toThrow("incomplete");
    });

    it("fails capture honestly on invalid payload evidence rather than publishing a ready trace", async () => {
        const manager = new MacroManager(root);
        manager.armRecording({ sessionId: "session" });
        const token = manager.claimRecording({
            sessionId: "session",
            cwd: ".",
            promptHash: hash(
                Buffer.from("Retrieve the complete original file"),
            ),
        })!;
        await expect(
            manager.finalizeRecording({
                tokenId: token.id,
                trace: sourceTrace({ base64Content: "!!!!" }),
            }),
        ).rejects.toThrow("encoding");
        expect((await manager.getRecordingState("session")).status).toBe(
            "failed",
        );
    });

    it("rejects missing, tampered, forged and unsupported references", async () => {
        const store = new PrivateResultStore(root);
        const ref = (await store.retain(
            "trace",
            "trace-1",
            "call-1",
            "result",
            blob().result,
        ))!;
        for (const patch of [
            { ownerId: ".." },
            { id: "../outside" },
            { encoding: "base64" },
            { schemaVersion: 99 },
            { sensitive: false },
        ]) {
            await expect(
                store.verify(
                    { ...ref, ...patch } as PrivateResultReference,
                    "trace",
                    "trace-1",
                    "call-1",
                    "result",
                ),
            ).rejects.toThrow("reference");
        }
        await expect(
            store.verify(ref, "run", "trace-1", "call-1", "result"),
        ).rejects.toThrow("owner");
        await expect(
            store.verify(
                { ...ref, view: {} },
                "trace",
                "trace-1",
                "call-1",
                "result",
            ),
        ).rejects.toThrow("view");
        await expect(
            store.verify(
                { ...ref, blobs: [] },
                "trace",
                "trace-1",
                "call-1",
                "result",
            ),
        ).rejects.toThrow("receipts");
        const original = await readFile(filename(ref));
        original[original.length - 2] ^= 1;
        await writeFile(filename(ref), original);
        await expect(
            store.verify(ref, "trace", "trace-1", "call-1", "result"),
        ).rejects.toThrow("digest");
        await rm(filename(ref));
        await expect(
            store.verify(ref, "trace", "trace-1", "call-1", "result"),
        ).rejects.toThrow("missing");
    });

    it("rejects noncanonical base64 and incorrect declared byte size", async () => {
        const store = new PrivateResultStore(root);
        for (const base64Content of ["!!!!", "Zg=", "Zh==", "Zg==\n"]) {
            await expect(
                store.retain("trace", "trace-1", "call", "result", {
                    base64Content,
                }),
            ).rejects.toThrow("encoding");
        }
        await expect(
            store.retain("trace", "trace-1", "call", "result", {
                base64Content: "Zg==",
                sizeBytes: 2,
            }),
        ).rejects.toThrow("size");
    });

    it("preserves owner-before-file and opened-size-before-digest validation ordering", async () => {
        const store = new PrivateResultStore(root);
        const ref = (await store.retain(
            "trace",
            "trace-order",
            "call-order",
            "result",
            blob().result,
        ))!;
        const original = await readFile(filename(ref));
        await writeFile(
            filename(ref),
            original.subarray(0, original.length - 1),
        );
        await expect(
            store.verify(ref, "trace", "trace-order", "call-order", "result"),
        ).rejects.toThrow("file identity or size changed");
        await rm(filename(ref));
        await expect(
            store.verify(ref, "run", "trace-order", "call-order", "result"),
        ).rejects.toThrow("owner or source does not match");
        await expect(
            store.verify(ref, "trace", "trace-order", "call-order", "result"),
        ).rejects.toThrow("missing or unreadable");
    });

    it("rejects oversized raw results and oversized non-body views without truncation", async () => {
        const store = new PrivateResultStore(root);
        await expect(
            store.retain(
                "trace",
                "trace-1",
                "call",
                "result",
                "a".repeat(17 * 1024 * 1024),
            ),
        ).rejects.toThrow("bounded evidence size");
        await expect(
            store.retain(
                "trace",
                "trace-1",
                "call",
                "result",
                Array.from({ length: 20_000 }, (_, i) => `field-${i}`),
            ),
        ).rejects.toThrow("view exceeds");
    });

    it("rejects directory junctions and hard-linked files without writing outside ownership", async () => {
        const outside = path.join(root, "outside");
        await mkdir(outside);
        await symlink(outside, path.join(root, "evidence"), "junction");
        const store = new PrivateResultStore(root);
        await expect(
            store.retain("trace", "trace-1", "call", "result", blob().result),
        ).rejects.toThrow("Unsafe");
        await rm(path.join(root, "evidence"));
        const ref = (await store.retain(
            "trace",
            "trace-1",
            "call",
            "result",
            blob().result,
        ))!;
        await link(filename(ref), path.join(outside, "hardlink.json"));
        await expect(
            store.verify(ref, "trace", "trace-1", "call", "result"),
        ).rejects.toThrow("Unsafe");
    });
});

describe("bounded result-derived WorkIQ paths", () => {
    it.each([
        "/content",
        "?$select=id,name,size,eTag,cTag,lastModifiedDateTime",
    ])(
        "induces and resolves %s from current results rather than captured source IDs",
        async (suffix) => {
            const source = sourceTrace({});
            const result = {
                structuredContent: {
                    "application/vnd.ms-workiq.retrieval": {
                        retrievalHits: [
                            { entityUrl: "/drives/drive-A/items/item-A" },
                        ],
                    },
                },
            };
            source.toolCalls.unshift({
                toolCallId: "lookup",
                name: "retrieve",
                arguments: { query: "document A" },
                result,
                modelResult: result,
                status: "completed",
            });
            source.toolCalls[1].arguments = {
                path: `/drives/drive-A/items/item-A${suffix}`,
            };
            const macro = await induceMacroFromTrace(
                "trace-1",
                source,
                "macro-1",
                "Original",
                "",
                source.startedAt,
            );
            expect(macro.schemaVersion).toBe(2);
            expect(macro.capabilities).toEqual(["result-path-v1"]);
            expect(validateMacro(macro, source).valid).toBe(true);
            const step = macro.steps[1];
            const changed = structuredClone(result);
            changed.structuredContent[
                "application/vnd.ms-workiq.retrieval"
            ].retrievalHits[0].entityUrl = "/drives/drive-B/items/item-B";
            expect(
                resolveMacroExpression(
                    step.arguments,
                    {},
                    new Map([["step-1", changed]]),
                ),
            ).toEqual({ path: `/drives/drive-B/items/item-B${suffix}` });
            const exampleInputs = Object.fromEntries(
                macro.inputs.map((input) => [input.name, "document A"]),
            );
            assertLearningProcedure(
                { inputs: macro.inputs, steps: macro.steps, exampleInputs },
                macro,
                source,
            );
            const legacy = { ...macro, schemaVersion: 1 as const };
            delete legacy.capabilities;
            expect(validateMacro(legacy).valid).toBe(false);
            const parsed = parseMacroLearningBuild({
                name: "Original",
                description: "Retrieve original file bytes",
                inputs: macro.inputs,
                steps: macro.steps,
                exampleInputs,
                requests: [
                    source.prompt,
                    "Read file",
                    "Fetch file",
                    "Get original",
                ],
            });
            expect(parsed.steps[1].arguments).toEqual(step.arguments);
        },
    );

    it.each([
        ["https://host/drives/d/items/i", "/content"],
        ["/drives/d/items/../i", "/content"],
        ["/drives/d/items/%2Fi", "/content"],
        ["/drives/d/items/i?x=y", "/content"],
        ["/drives/d/items/i", "/content/../delete"],
        ["/drives/d/items/i", "?$select=id&$expand=content"],
        ["/drives/d/items/i", "?$select=token%0a"],
        ["/drives/d/items/i", "?$select=1bad"],
        ["/drives/d/items/i", "/content\n"],
        ["/drives/d/items/i\n", "/content"],
        ["/drives/d/items/i", "?$select=id\n"],
    ])("rejects unsafe base %s or suffix %s", (base, suffix) => {
        expect(() => constructResultPath(base, suffix)).toThrow();
    });

    it("rejects unknown expressions rather than treating them as references", () => {
        expect(() =>
            resolveMacroExpression(
                {
                    kind: "eval",
                    stepId: "step-1",
                } as unknown as ValueExpression,
                {},
                new Map([["step-1", {}]]),
            ),
        ).toThrow();
    });

    it("checks every step even after finding an admitted extended expression", async () => {
        const source = sourceTrace({});
        const macro = await induceMacroFromTrace(
            "trace-1",
            source,
            "macro-1",
            "Original",
            "",
            source.startedAt,
        );
        macro.schemaVersion = 2;
        macro.capabilities = ["result-path-v1"];
        macro.steps[0].arguments = {
            kind: "resultPath",
            stepId: "earlier",
            path: ["entityUrl"],
            suffix: "/content",
        };
        macro.steps.push({
            ...macro.steps[0],
            id: "invalid",
            arguments: { kind: "eval" } as unknown as ValueExpression,
        });
        expect(validateMacro(macro).issues).toContainEqual(
            expect.objectContaining({ code: "unsupportedCapabilities" }),
        );
        const hiddenSuffix = structuredClone(macro);
        hiddenSuffix.steps = [hiddenSuffix.steps[0]];
        hiddenSuffix.steps[0].arguments = {
            kind: "stepResult",
            stepId: "earlier",
            path: [],
            suffix: "/content",
        } as unknown as ValueExpression;
        expect(validateMacro(hiddenSuffix).valid).toBe(false);
    });
});
