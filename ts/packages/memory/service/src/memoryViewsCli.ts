// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { readFile } from "node:fs/promises";
import { FileMemoryService } from "./fileMemoryService.js";
import { createMemoryServiceRpcFacade } from "./rpcFacade.js";
import type { ViewSaveRequest, ViewArchiveRequest } from "./viewTypes.js";

const usage = `Developer draft-only views:
node dist/memoryViewsCli.js --store <private-store> --enable-view-drafts <command> [arguments]
  corpora
  create-corpus <name>
  list <corpusId>
  sources <corpusId>
  source <corpusId> <sourceId> [revisionId]
  read <corpusId> <viewId> [revisionId]
  history <corpusId> <viewId>
  save <request.json>
  archive <request.json>
  publish <corpusId> <viewId> (explicitly unsupported)
The store must not be owned by a running server. Actor comes from the local OS identity.
No reset, source deletion, model generation, or publication is performed.`;

export async function runMemoryViewsCli(args: string[]): Promise<unknown> {
    const [storeFlag, store, capability, command, ...values] = args;
    if (
        storeFlag !== "--store" ||
        !store ||
        capability !== "--enable-view-drafts" ||
        !command
    )
        throw new Error(usage);
    const service = new FileMemoryService(store, { viewDrafts: true });
    const rpc = createMemoryServiceRpcFacade(service);
    try {
        if (command === "corpora" && values.length === 0)
            return await rpc.listCorpora();
        if (command === "create-corpus" && values.length === 1)
            return await rpc.createCorpus(values[0]);
        if (command === "list" && values.length === 1)
            return await rpc.listViews(values[0]);
        if (command === "sources" && values.length === 1)
            return await rpc.listSources(values[0]);
        if (command === "source" && values.length >= 2 && values.length <= 3)
            return await rpc.getSourceContent({
                corpusId: values[0],
                sourceId: values[1],
                ...(values[2] === undefined ? {} : { revisionId: values[2] }),
            });
        if (command === "read" && values.length >= 2 && values.length <= 3)
            return (
                (await rpc.getView({
                    corpusId: values[0],
                    viewId: values[1],
                    ...(values[2] === undefined
                        ? {}
                        : { revisionId: values[2] }),
                })) ?? null
            );
        if (command === "history" && values.length === 2)
            return await rpc.getViewHistory({
                corpusId: values[0],
                viewId: values[1],
            });
        if (command === "save" && values.length === 1) {
            const request: ViewSaveRequest = JSON.parse(
                await readFile(values[0], "utf8"),
            );
            return await rpc.saveViewDraft(request);
        }
        if (command === "archive" && values.length === 1) {
            const request: ViewArchiveRequest = JSON.parse(
                await readFile(values[0], "utf8"),
            );
            return await rpc.archiveView(request);
        }
        if (command === "publish" && values.length === 2)
            return await rpc.publishView({
                corpusId: values[0],
                viewId: values[1],
            });
        throw new Error(usage);
    } finally {
        await service.close();
    }
}

// An import is testable without starting a service.
if (process.argv[1]?.endsWith("memoryViewsCli.js")) {
    runMemoryViewsCli(process.argv.slice(2)).then(
        (result) => console.log(JSON.stringify(result, null, 2)),
        (error: unknown) => {
            console.error(
                error instanceof Error ? error.message : String(error),
            );
            process.exitCode = 1;
        },
    );
}
