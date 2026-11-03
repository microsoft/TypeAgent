// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { AjvJsonSchemaValidator } from "@modelcontextprotocol/sdk/validation/ajv";
import type { JsonSchemaType } from "@modelcontextprotocol/sdk/validation";
import { capabilitiesSchema, memoryToolNames } from "@typeagent/memory-client";
import { FileMemoryService } from "@typeagent/memory-service";
import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import path from "node:path";
import { MemoryServiceHost } from "../src/memoryServiceHost.js";

const { FakeSemanticCorpusIndex } = await import(
    new URL(
        "../../../service/dist/test/fakeSemanticCorpusIndex.js",
        import.meta.url,
    ).href
);

test.each([false, true])(
    "actual capabilities satisfy the strict advertised output schema with understanding=%s",
    async (understanding) => {
        const root = path.resolve(
            ".capabilities-protocol-fixtures",
            randomUUID(),
        );
        const service = new FileMemoryService(root, {
            understanding,
            extensionBuilds: true,
            viewDrafts: false,
            informationalViews: false,
            sourceSynopses: false,
            discoveryPolicy: "off",
            maintenanceMode: "manual",
            indexFactory: (_id, directory) =>
                new FakeSemanticCorpusIndex(directory),
            indexedAnswerModel: {
                completionSettings: {},
                complete: async () => {
                    throw new Error("Capabilities must not invoke a model");
                },
            },
        });
        let host: MemoryServiceHost | undefined;
        const client = new Client(
            { name: "strict-capabilities-fixture", version: "1" },
            { capabilities: {} },
        );
        try {
            host = await MemoryServiceHost.start(service);
            await client.connect(
                new StreamableHTTPClientTransport(new URL(host.endpoint), {
                    requestInit: {
                        headers: {
                            authorization: `Bearer ${host.bearerToken}`,
                        },
                    },
                }) as unknown as Transport,
            );
            const { tools } = await client.listTools();
            const tool = tools.find(
                (candidate) => candidate.name === memoryToolNames.capabilities,
            );
            if (!tool?.outputSchema)
                throw new Error("Capabilities output schema is missing");
            const validate = new AjvJsonSchemaValidator().getValidator(
                tool.outputSchema as JsonSchemaType,
            );
            const actual = await service.getCapabilities();
            const checked = validate({ result: actual });
            expect(checked.errorMessage).toBeUndefined();
            expect(checked.valid).toBe(true);
            const result = await client.callTool({
                name: memoryToolNames.capabilities,
                arguments: {},
            });
            expect(result.isError).not.toBe(true);
            expect(result.structuredContent).toEqual({ result: actual });
            expect(capabilitiesSchema.parse(actual)).toEqual(actual);
            expect(actual.features.memoryDocumentUnderstanding).toBe(
                understanding ? true : undefined,
            );
            expect(
                validate({
                    result: {
                        ...actual,
                        features: {
                            ...actual.features,
                            unsupportedFeature: true,
                        },
                    },
                }).valid,
            ).toBe(false);
            expect(
                validate({
                    result: {
                        ...actual,
                        features: {
                            ...actual.features,
                            memoryDocumentUnderstanding: "true",
                        },
                    },
                }).valid,
            ).toBe(false);
        } finally {
            await client.close();
            if (host) await host.close();
            else await service.close();
            await rm(root, { recursive: true, force: true });
        }
    },
);
