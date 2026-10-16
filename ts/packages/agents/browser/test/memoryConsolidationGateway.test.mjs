// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import test from "node:test";
import { fork } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRpc } from "@typeagent/agent-rpc/rpc";
import { viewMethods } from "@typeagent/browser-control-rpc/viewRpc";
import { FileMemoryService } from "@typeagent/memory-service";
import {
    viewVersionSchema,
    viewBuildJobSchema,
    viewSaveRequestSchema,
} from "@typeagent/memory-client";
import { createMemoryViewFunctions } from "../dist/agent/memoryViews.mjs";

const recorded = JSON.parse(
    await readFile(
        new URL(
            "../../../memory/mcp-server/test/fixtures/p6Canonical.json",
            import.meta.url,
        ),
        "utf8",
    ),
);
const canonical = viewVersionSchema.parse(recorded.canonical);
const alias = viewVersionSchema.parse({
    ...canonical,
    ...recorded.alias,
    state: "archived",
});
class RecordedGateway extends FileMemoryService {
    async getView(request) {
        if (request.corpusId !== canonical.corpusId)
            throw new Error("Wrong recorded corpus");
        const version =
            request.viewId === canonical.viewId
                ? canonical
                : request.viewId === alias.viewId
                  ? alias
                  : undefined;
        if (
            !version ||
            (request.revisionId && request.revisionId !== version.revisionId)
        )
            throw new Error("Wrong exact recorded revision");
        return structuredClone(version);
    }
    async getViewBuild(request) {
        if (
            request.jobId !== recorded.job.jobId ||
            request.corpusId !== canonical.corpusId
        )
            throw new Error("Wrong recorded consolidation job");
        return structuredClone(recorded.job);
    }
    async saveViewDraft(request) {
        viewSaveRequestSchema.parse(request);
        return {
            commitId: recorded.origin.head,
            version: structuredClone(canonical),
        };
    }
}
test("actual indexed P0 multi-page canonical/old-ID/history selection/job/edit survive HTTP and parent IPC gateway", async (t) => {
    const root = await mkdtemp(
        path.join(os.tmpdir(), "consolidation-gateway-"),
    );
    const service = new RecordedGateway(root, {
        viewDrafts: false,
        informationalViews: false,
    });
    const child = fork(
        new URL("../dist/views/server/server.mjs", import.meta.url),
        ["0"],
        { stdio: ["ignore", "ignore", "inherit", "ipc"] },
    );
    t.after(async () => {
        if (child.exitCode === null) {
            const exited = once(child, "exit");
            child.kill();
            await exited;
        }
        await service.close();
        await rm(root, { recursive: true, force: true });
    });
    const handlers = createMemoryViewFunctions(() => service);
    createRpc(
        "recorded-consolidation-parent",
        child,
        Object.fromEntries(
            viewMethods
                .filter((method) => method in handlers)
                .map((method) => [method, handlers[method]]),
        ),
    );
    const ready = await new Promise((resolve, reject) => {
        child.on("message", (message) => {
            if (message.type === "Success") resolve(message);
        });
        child.once("error", reject);
        child.once("exit", () =>
            reject(new Error("Consolidation gateway exited before readiness")),
        );
    });
    async function invoke(method, params) {
        const response = await fetch(
            `http://localhost:${ready.port}/api/views/invoke`,
            {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ method, params }),
            },
        );
        assert.equal(response.status, 200);
        const body = await response.json();
        assert.equal(body.error, undefined);
        return body.data;
    }
    for (const version of [canonical, alias])
        for (const revisionId of [undefined, version.revisionId]) {
            const read = viewVersionSchema.parse(
                await invoke("memoryGetView", {
                    corpusId: version.corpusId,
                    viewId: version.viewId,
                    ...(revisionId ? { revisionId } : {}),
                }),
            );
            assert.deepEqual(read.content, canonical.content);
            assert.deepEqual(read.redirect, version.redirect);
        }
    const job = viewBuildJobSchema.parse(
        await invoke("memoryGetViewBuild", {
            corpusId: canonical.corpusId,
            jobId: recorded.job.jobId,
        }),
    );
    assert.deepEqual(
        job.results.find((result) => result.wikiConsolidation).wikiConsolidation
            .output.content,
        canonical.content,
    );
    const saved = await invoke("memorySaveViewDraft", {
        corpusId: canonical.corpusId,
        viewId: canonical.viewId,
        expectedHead: recorded.origin.head,
        expectedVersion: canonical.version,
        definition: {
            viewId: canonical.viewId,
            kind: "wiki",
            selector: canonical.definition.selector,
            wiki: canonical.definition.wiki,
        },
        content: canonical.content,
        relationships: job.results.find((result) => result.wikiConsolidation)
            .wikiConsolidation.output.relationships,
        unlockProtection: ["title"],
    });
    assert.deepEqual(
        viewVersionSchema.parse(saved.version).content,
        canonical.content,
    );
});
