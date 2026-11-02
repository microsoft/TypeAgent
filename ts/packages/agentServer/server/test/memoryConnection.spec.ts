// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { mkdir, rm, stat, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { FileMemoryService } from "@typeagent/memory-service";
import { MemoryServiceHost } from "@typeagent/memory-mcp-server";
import {
    createConfiguredMemoryService,
    parseMemoryConnectionConfig,
} from "../src/memoryConnection.js";
import type { MemoryServiceClient } from "@typeagent/memory-client";

const fakeIndexUrl = new URL(
    "../../../../memory/service/dist/test/fakeSemanticCorpusIndex.js",
    import.meta.url,
);
const {
    FakeSemanticCorpusIndex,
}: typeof import("../../../memory/service/dist/test/fakeSemanticCorpusIndex.js") =
    await import(fakeIndexUrl.href);

test.each(["http", "stdio"])(
    "native configured %s connection uses the private corpus and never creates the instance store",
    async (kind) => {
        const root = path.resolve(".memory-connection-fixtures", randomUUID());
        await mkdir(root, { recursive: true });
        const unused = path.join(root, "unrelated-instance");
        const directory = path.join(root, "private");
        const options = {
            viewDrafts: false,
            informationalViews: false,
            sourceSynopses: false,
            discoveryPolicy: "off" as const,
            maintenanceMode: "manual" as const,
            extensionBuilds: true,
            indexFactory: (_id: string, directory: string) =>
                new FakeSemanticCorpusIndex(directory),
        };
        const host =
            kind === "http"
                ? await MemoryServiceHost.start(
                      new FileMemoryService(directory, options),
                  )
                : undefined;
        let client: MemoryServiceClient | undefined;
        try {
            let connection: unknown;
            if (host)
                connection = {
                    kind,
                    url: host.endpoint,
                    headers: { authorization: `Bearer ${host.bearerToken}` },
                };
            else {
                await writeFile(
                    path.join(root, "host.mjs"),
                    `
import { FileMemoryService } from "@typeagent/memory-service";
import { MemoryMcpServer } from "@typeagent/memory-mcp-server";
import { FakeSemanticCorpusIndex } from ${JSON.stringify(fakeIndexUrl.href)};
const service = new FileMemoryService("private", {
viewDrafts: false, informationalViews: false, sourceSynopses: false,
discoveryPolicy: "off", maintenanceMode: "manual", extensionBuilds: true,
indexFactory: (_id, directory) => new FakeSemanticCorpusIndex(directory),
});
await new MemoryMcpServer(service, { previews: false }).start();
`,
                );
                connection = {
                    kind,
                    command: process.execPath,
                    args: ["host.mjs"],
                    cwd: ".",
                };
            }
            const config = path.join(root, "connection.json");
            await writeFile(config, JSON.stringify(connection));
            client = (await createConfiguredMemoryService(
                unused,
                config,
            )) as MemoryServiceClient;
            const corpus = await client.createCorpus(
                "Configured private corpus",
            );
            expect(await client.getCorpus(corpus.corpusId)).toMatchObject({
                name: "Configured private corpus",
            });
            expect(
                (await client.getCapabilities()).derivedViews?.extension
                    ?.apiVersion,
            ).toBe(1);
            await expect(stat(unused)).rejects.toMatchObject({
                code: "ENOENT",
            });
            await client.close();
            client = undefined;
        } finally {
            await client?.close();
            await host?.close();
            await rm(root, { recursive: true, force: true });
        }
    },
    30000,
);

test("explicit invalid native connection never falls back or accepts executable presentation fields", async () => {
    expect(() =>
        parseMemoryConnectionConfig({ kind: "http", url: "file:host" }),
    ).toThrow();
    expect(() =>
        parseMemoryConnectionConfig({
            kind: "stdio",
            command: "node",
            args: [],
            renderer: "remote",
        }),
    ).toThrow();
    await expect(
        createConfiguredMemoryService(
            ".unused-instance",
            ".missing-explicit-connection.json",
        ),
    ).rejects.toThrow();
});
