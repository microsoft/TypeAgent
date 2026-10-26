// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { randomUUID } from "node:crypto";
import { link, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import {
    PrivateResultStore,
    cloneVerifiedLearningTrace,
    verifiedLearningEvidence,
    type RecordedInteractionTrace,
} from "@typeagent/copilot-macros";

let root: string;
beforeEach(async () => {
    root = path.resolve(".learning-evidence-tests", randomUUID());
    await mkdir(path.join(root, "traces"), { recursive: true });
});
afterEach(async () => {
    await rm(root, { recursive: true, force: true });
    await rm(path.dirname(root)).catch(() => undefined);
});

function recording(): RecordedInteractionTrace {
    const entityUrl = "/drives/drive/items/item";
    const url = "https://example.invalid/library/document";
    const fields =
        "id,name,size,eTag,cTag,lastModifiedDateTime,file,parentReference,webUrl,sharepointIds";
    const data = {
        id: "item",
        name: "document",
        size: 3,
        eTag: "version-1",
        cTag: "content-1",
        lastModifiedDateTime: "2026-10-01T00:00:00Z",
        file: { mimeType: "text/plain" },
        parentReference: { driveId: "drive" },
        sharepointIds: { siteId: "site", listId: "library" },
        webUrl: url,
    };
    const names = [
        "workiq-retrieve",
        "workiq-fetch",
        "workiq-fetch_blob",
        "workiq-fetch",
    ];
    const args = [
        { capabilities: [{ items_by_url: [{ url }] }] },
        { entityUrls: [`${entityUrl}?$select=${fields}`] },
        { path: `${entityUrl}/content` },
        { entityUrls: [`${entityUrl}?$select=${fields}`] },
    ];
    const results = [
        {
            "application/vnd.ms-workiq.retrieval": {
                resultCount: 1,
                stoppedReason: "completed",
                retrievalHits: [
                    { driveId: "drive", itemId: "item", entityUrl },
                ],
            },
        },
        { results: [{ statusCode: 200, data }] },
        {
            statusCode: 200,
            base64Content: "YWJj",
            sizeBytes: 3,
            blobName: "document",
            contentType: "text/plain",
        },
        { results: [{ statusCode: 200, data: structuredClone(data) }] },
    ];
    return {
        schemaVersion: 1,
        sessionId: "session",
        cwd: ".",
        prompt: "Read and privately retain the original, then report its receipt",
        response: "Recorded response",
        startedAt: "2026-10-01T00:00:00Z",
        completedAt: "2026-10-01T00:01:00Z",
        toolCalls: names.map((name, index) => ({
            name,
            toolCallId: `call-${index}`,
            status: "completed",
            arguments: args[index],
            result: {
                isError: false,
                structuredContent: results[index],
            },
        })),
    };
}

async function persist(trace = recording()) {
    const store = new PrivateResultStore(root);
    const call = trace.toolCalls[2];
    const ref = await store.retain(
        "trace",
        "trace",
        call.toolCallId,
        "result",
        call.result,
        { forceFull: true },
    );
    if (!ref) throw new Error("Missing retained original");
    call.result = ref.view;
    call.resultArtifact = ref;
    trace.schemaVersion = 2;
    trace.capabilities = ["private-result-evidence-v1"];
    await writeFile(
        path.join(root, "traces", "trace.json"),
        JSON.stringify(trace),
    );
    return { store, trace, ref };
}

it("provides body-free current recording facts only after physical verification", async () => {
    const { store, trace } = await persist();
    expect(verifiedLearningEvidence(trace, "trace")).toBeUndefined();
    await store.verifyLearningTrace("trace", trace);
    const evidence = verifiedLearningEvidence(trace, "trace");
    expect(evidence?.workiqRead).toEqual({
        scope: "recorded-current-results-only",
        sourceToolCallIds: ["call-0", "call-1", "call-2", "call-3"],
        lookupHitCount: 1,
        allReturnedHitsMatchRecordedMetadataItemAndDrive: true,
        recordedMetadataUrlMatchesLookupRequestedUrl: true,
        metadataReadsAndBlobUseReturnedEntityBinding: true,
        metadataIdentityLibraryVersionAndSizeUnchanged: true,
        recordedTitleAndIdentityFieldsPresent: true,
        retainedOriginalBlob: {
            sha256: "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
            sizeBytes: 3,
            sizeMatchesRecordedMetadata: true,
        },
    });

    expect(JSON.stringify(evidence)).not.toMatch(
        /https:|base64Content|YWJj|example.invalid/,
    );
    expect(
        verifiedLearningEvidence(
            cloneVerifiedLearningTrace(trace, "trace"),
            "trace",
        ),
    ).toEqual(evidence);
    expect(
        verifiedLearningEvidence(structuredClone(trace), "trace"),
    ).toBeUndefined();
    expect(() => verifiedLearningEvidence(trace, "foreign")).toThrow();
    trace.sessionId = "foreign";
    expect(() => verifiedLearningEvidence(trace, "trace")).toThrow();
});

it("loads and verifies a learning trace without a preliminary evidence pass", async () => {
    const { store, trace } = await persist();
    const verify = import.meta.jest.spyOn(store, "verify");
    const loaded = await store.verifyLearningTrace("trace");
    expect(loaded).toEqual(trace);
    expect(verify).toHaveBeenCalledTimes(1);
    expect(verifiedLearningEvidence(loaded, "trace")).toBeDefined();
});

it("rejects unsupported trace capabilities on a learning-specific read", async () => {
    const { store, trace } = await persist();
    await writeFile(
        path.join(root, "traces", "trace.json"),
        JSON.stringify({ ...trace, capabilities: ["unrecognized"] }),
    );
    await expect(store.verifyLearningTrace("trace")).rejects.toThrow(
        "Unsupported learning trace identity or capabilities.",
    );
});

it.each([
    "foreign physical trace",
    "missing original",
    "tampered original",
    "foreign original owner",
    "tampered view",
    "unsupported capabilities",
    "hardlinked physical trace",
])("rejects %s before minting facts", async (variant) => {
    const { store, trace, ref } = await persist();
    const artifact = path.join(
        root,
        "evidence",
        "trace",
        "trace",
        `${ref.id}.json`,
    );
    if (variant === "foreign physical trace") trace.sessionId = "foreign";
    if (variant === "missing original") await rm(artifact);
    if (variant === "tampered original") {
        const original = await readFile(artifact);
        await writeFile(artifact, Buffer.alloc(original.length, 0x20));
    }
    if (variant === "foreign original owner") ref.ownerId = "foreign";
    if (variant === "tampered view") trace.toolCalls[2].result = {};
    if (variant === "unsupported capabilities") trace.schemaVersion = 1;
    if (variant === "hardlinked physical trace")
        await link(
            path.join(root, "traces", "trace.json"),
            path.join(root, "traces", "linked.json"),
        );
    if (variant !== "foreign physical trace")
        await writeFile(
            path.join(root, "traces", "trace.json"),
            JSON.stringify(trace),
        );
    await expect(store.verifyLearningTrace("trace", trace)).rejects.toThrow();
    expect(verifiedLearningEvidence(trace, "trace")).toBeUndefined();
});

it.each([
    "missing metadata",
    "foreign metadata identity",
    "foreign library",
    "changed version",
    "incomplete original",
    "foreign binding",
    "foreign requested URL",
    "failed capture",
    "foreign lookup hit",
    "missing private original",
])("does not claim verified read observations for %s", async (variant) => {
    const trace = recording();
    const before = (trace.toolCalls[1].result as any).structuredContent
        .results[0].data;
    const after = (trace.toolCalls[3].result as any).structuredContent
        .results[0].data;
    if (variant === "missing metadata") delete before.eTag;
    if (variant === "foreign metadata identity")
        before.id = after.id = "foreign";
    if (variant === "foreign library") after.sharepointIds.listId = "foreign";
    if (variant === "changed version") after.eTag = "changed";
    if (variant === "incomplete original") before.size = after.size = 4;
    if (variant === "foreign binding")
        trace.toolCalls[2].arguments = { path: "/foreign/content" };
    if (variant === "foreign requested URL")
        before.webUrl = after.webUrl = "https://foreign.invalid";
    if (variant === "failed capture") trace.toolCalls[0].status = "failed";
    if (variant === "foreign lookup hit") {
        (trace.toolCalls[0].result as any).structuredContent[
            "application/vnd.ms-workiq.retrieval"
        ].retrievalHits.push({
            driveId: "foreign",
            itemId: "item",
            entityUrl: "/foreign",
        });
    }
    const { store, trace: retained } = await persist(trace);
    if (variant === "missing private original") {
        const call = retained.toolCalls[2];
        delete call.resultArtifact;
        retained.schemaVersion = 1;
        delete retained.capabilities;
        await writeFile(
            path.join(root, "traces", "trace.json"),
            JSON.stringify(retained),
        );
    }
    await store.verifyLearningTrace("trace", retained);
    expect(
        verifiedLearningEvidence(retained, "trace")?.workiqRead,
    ).toBeUndefined();
});
