// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";

export const fixtureDigest = (bytes) =>
    createHash("sha256").update(bytes).digest("hex");

export function approvedSourceFixture(directory, corpus, macro) {
    const root = path.join(directory, "historical-unit-source");
    fs.mkdirSync(root);
    const owner = randomUUID();
    const traceId = randomUUID();
    const sessionId = randomUUID();
    const store = path.join(
        "data",
        "profiles",
        `macro-eval-${owner.slice(0, 8)}`,
        "copilot-macros",
    );
    const files = {};
    const write = (key, relative, value) => {
        const file = path.join(root, relative);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        const bytes = JSON.stringify(value);
        fs.writeFileSync(file, bytes);
        files[key] = { file, sha256: fixtureDigest(bytes) };
        return file;
    };
    macro = {
        ...structuredClone(macro),
        macroId: "a".repeat(64),
        sourceTraceId: traceId,
        version: 2,
        state: "approved",
    };
    for (const step of macro.steps) step.sourceToolCallId = step.id;
    write("owner", "evaluation-owner.json", { owner, unitFixture: true });
    write("corpus", "corpus.json", corpus);
    write("workspace", path.join("workspace", ".mcp.json"), {
        unitFixture: true,
    });
    write("manifest", "manifest.json", {
        corpusHash: fixtureDigest(JSON.stringify(corpus)),
        workspaceFiles: [{ file: ".mcp.json", sha256: files.workspace.sha256 }],
    });
    write(
        "version",
        path.join(store, "macros", macro.macroId, "versions", "2.json"),
        macro,
    );
    write("reviewedDraft", "reviewed-draft.json", {
        ...macro,
        version: 1,
        state: "draft",
    });
    write("trace", path.join(store, "traces", `${traceId}.json`), {
        traceId,
        sessionId,
        unitFixture: true,
    });
    write(
        "originals",
        path.join("data", "native-sdk-originals", `${sessionId}.jsonl`),
        {
            unitFixture: true,
        },
    );
    write("result", "result.json", {
        status: "failed",
        operatorActions: [
            {
                operation: "external bounded synthetic review/approve",
                reference: {
                    macroId: macro.macroId,
                    version: 2,
                    state: "approved",
                },
            },
        ],
        trials: [
            {
                candidate: "training",
                grade: { status: "passed", taskCorrect: true },
            },
        ],
        selectedSourceAudit: {
            kind: "native-finalized-synthetic-source-audit-v1",
            summary: { traceId, sessionId },
            native: { toolCallIds: macro.steps.map((step) => step.id) },
            traceFile: files.trace.file,
            sha256: files.trace.sha256,
        },
    });
    const learningFile = write("learning", path.join(store, "learning.json"), {
        preferences: [
            {
                cwd: path.join(root, "workspace").toLowerCase(),
                mode: "prepare",
                revision: 1,
            },
        ],
        jobs: [{ id: "prior-unit-job" }],
        suppressed: [],
    });
    return {
        root,
        macro,
        learningFile,
        files,
        config: {
            artifactRoot: root,
            macroId: macro.macroId,
            owner,
            version: 2,
            restartCase: "restart",
            sourceHashes: Object.fromEntries(
                [
                    "owner",
                    "manifest",
                    "result",
                    "corpus",
                    "reviewedDraft",
                    "version",
                    "trace",
                    "originals",
                ].map((key) => [key, files[key].sha256]),
            ),
        },
    };
}
