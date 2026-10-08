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

const argumentCounts = new Map<string, readonly [number, number]>([
    ["corpora", [0, 0]],
    ["create-corpus", [1, 1]],
    ["list", [1, 1]],
    ["sources", [1, 1]],
    ["source", [2, 3]],
    ["read", [2, 3]],
    ["history", [2, 2]],
    ["save", [1, 1]],
    ["archive", [1, 1]],
    ["publish", [2, 2]],
]);

export async function runMemoryViewsCli(args: string[]): Promise<unknown> {
    const [storeFlag, store, capability, command, ...values] = args;
    if (
        storeFlag !== "--store" ||
        !store ||
        capability !== "--enable-view-drafts" ||
        !command
    )
        throw new Error(usage);
    const counts = argumentCounts.get(command);
    if (!counts || values.length < counts[0] || values.length > counts[1])
        throw new Error(usage);
    const service = new FileMemoryService(store, { viewDrafts: true });
    const rpc = createMemoryServiceRpcFacade(service);
    try {
        switch (command) {
            case "corpora":
                return await rpc.listCorpora();
            case "create-corpus":
                return await rpc.createCorpus(values[0]);
            case "list":
                return await rpc.listViews(values[0]);
            case "sources":
                return await rpc.listSources(values[0]);
            case "source":
                return await rpc.getSourceContent({
                    corpusId: values[0],
                    sourceId: values[1],
                    ...(values[2] === undefined
                        ? {}
                        : { revisionId: values[2] }),
                });
            case "read":
                return (
                    (await rpc.getView({
                        corpusId: values[0],
                        viewId: values[1],
                        ...(values[2] === undefined
                            ? {}
                            : { revisionId: values[2] }),
                    })) ?? null
                );
            case "history":
                return await rpc.getViewHistory({
                    corpusId: values[0],
                    viewId: values[1],
                });
            case "save": {
                const request: ViewSaveRequest = JSON.parse(
                    await readFile(values[0], "utf8"),
                );
                return await rpc.saveViewDraft(request);
            }
            case "archive": {
                const request: ViewArchiveRequest = JSON.parse(
                    await readFile(values[0], "utf8"),
                );
                return await rpc.archiveView(request);
            }
            case "publish":
                return await rpc.publishView({
                    corpusId: values[0],
                    viewId: values[1],
                });
        }
        throw new Error(usage);
    } finally {
        await service.close();
    }
}

// An import is testable without starting a service.
if (process.argv[1]?.endsWith("memoryViewsCli.js")) {
    runMemoryViewsCli(process.argv.slice(2)).then(
        (result) =>
            process.stdout.write(`${JSON.stringify(result, null, 2)}\n`),
        (error: unknown) => {
            console.error(
                error instanceof Error ? error.message : String(error),
            );
            process.exitCode = 1;
        },
    );
}
