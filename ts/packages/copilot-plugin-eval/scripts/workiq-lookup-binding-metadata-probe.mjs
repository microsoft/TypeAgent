// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import fs from "node:fs";
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import {
    createWorkiqMcpServer,
    workiqLookupBindingGuidance,
    workiqReadArguments,
    workiqModelVisibleTools,
    verifyWorkiqModelVisibleMetadata,
} from "./macro-eval-workiq-adapter.mjs";
import {
    workiqMacroCorrectnessContract,
    workiqRequestMatches,
} from "./macro-eval-workiq-evidence.mjs";

// In-memory protocol only: no Agency, CLI, model, network or document calls.
async function probe() {
    if (
        process.argv.length !== 6 ||
        process.argv[2] !== "--admission" ||
        process.argv[4] !== "--sha256" ||
        !/^[a-f0-9]{64}$/u.test(process.argv[5])
    )
        throw new Error("metadataProbeArguments");
    const bytes = fs.readFileSync(process.argv[3]);
    const hash = createHash("sha256").update(bytes).digest("hex");
    if (hash !== process.argv[5]) throw new Error("metadataProbeAdmissionHash");
    const admission = JSON.parse(bytes);
    let dataCalls = 0;
    const probes = [];
    for (const entityKey of ["A", "B"]) {
        const expected = workiqReadArguments(admission, entityKey, 0);
        const tools = admission.runtime.advertisedToolSchemas.map((tool) => ({
            name: tool.advertisedName,
            inputSchema: tool.inputSchema,
            annotations: tool.annotations,
        }));
        const server = createWorkiqMcpServer({
            tools: () => tools,
            lookupBindingGuidance: () =>
                workiqLookupBindingGuidance(admission, entityKey),
            call: () => {
                dataCalls++;
                throw new Error("offlineDataCallForbidden");
            },
        });
        const client = new Client({
            name: "offline-binding-probe",
            version: "1",
        });
        const [left, right] = InMemoryTransport.createLinkedPair();
        try {
            await Promise.all([client.connect(left), server.connect(right)]);
            const instructions = client.getInstructions();
            const binding = JSON.parse(
                instructions.match(
                    /Frozen lookup scalar binding JSON: ([^\n]+)/u,
                )[1],
            );
            const entity = admission.entities.find(
                (item) => item.key === entityKey,
            );
            const other = admission.entities.find(
                (item) => item.key !== entityKey,
            );
            const lookup = {
                content: [],
                isError: false,
                structuredContent: {
                    "application/vnd.ms-workiq.retrieval": {
                        markdown: "",
                        resultCount: 1,
                        stoppedReason: "completed",
                        retrievalHits: [
                            {
                                itemId: entity.itemId,
                                driveId: entity.driveId,
                                entityUrl: entity.entityPath,
                                webUrl: entity.canonicalWebUrl,
                                resourceMetadata: {},
                            },
                        ],
                    },
                },
            };
            const metadata = workiqReadArguments(
                admission,
                entityKey,
                1,
                lookup,
            );
            const [base, query] = metadata.entityUrls[0].split("?");
            const reverseSelection =
                base +
                "?$select=" +
                new URLSearchParams(query)
                    .get("$select")
                    .split(",")
                    .reverse()
                    .join(",");
            const actual = {
                ...binding,
                capabilities: [
                    {
                        name: "OneDriveAndSharePoint",
                        items_by_url: [{ url: entity.inputs.documentUrl }],
                    },
                ],
            };
            const listed = (await client.listTools()).tools;
            const exposed = workiqModelVisibleTools(
                tools,
                workiqLookupBindingGuidance(admission, entityKey),
            );
            verifyWorkiqModelVisibleMetadata(
                {
                    tools: listed.map((tool) => ({
                        mcpServerName: admission.runtime.mcpServer,
                        mcpToolName: tool.name,
                        input_schema: tool.inputSchema,
                        description: tool.description,
                    })),
                },
                admission.runtime.mcpServer,
                exposed,
            );
            const result = {
                entityKey,
                exactScalars: isDeepStrictEqual(binding, {
                    query: expected.query,
                    strategy: expected.strategy,
                }),
                exactRequestConstruction: isDeepStrictEqual(actual, expected),
                schemasUnchanged: listed.every(
                    (tool, index) =>
                        isDeepStrictEqual(
                            tool.inputSchema,
                            tools[index].inputSchema,
                        ) &&
                        isDeepStrictEqual(
                            tool.annotations,
                            tools[index].annotations,
                        ),
                ),
                modelVisibleDescriptionQualified: isDeepStrictEqual(
                    listed,
                    exposed,
                ),
                urlAbsent: !/https?:\/\//iu.test(instructions),
                otherQueryAbsent: !instructions.includes(
                    other.inputs.documentQuery,
                ),
                ...(workiqMacroCorrectnessContract(admission)
                    ? {
                          optionalDiagnosticBooleans: [true, false].every(
                              (includeDeveloperCard) =>
                                  workiqRequestMatches(
                                      { ...actual, includeDeveloperCard },
                                      expected,
                                      admission,
                                      0,
                                  ),
                          ),
                          invalidDiagnosticRejected: !workiqRequestMatches(
                              { ...actual, includeDeveloperCard: "true" },
                              expected,
                              admission,
                              0,
                          ),
                          obsoleteOmissionGuidanceAbsent:
                              !/omit includeDeveloperCard/iu.test(instructions),
                          metadataSelectionOrderEquivalent:
                              workiqRequestMatches(
                                  { entityUrls: [reverseSelection] },
                                  metadata,
                                  admission,
                                  1,
                              ),
                          unauthorizedSelectionRejected: !workiqRequestMatches(
                              {
                                  entityUrls: [
                                      reverseSelection + "&$expand=permissions",
                                  ],
                              },
                              metadata,
                              admission,
                              1,
                          ),
                          captureCompletionGuidanceQualified:
                              entityKey === "A"
                                  ? listed.every(
                                        (tool) =>
                                            tool.description?.includes(
                                                "Capture completion policy v1:",
                                            ) &&
                                            tool.description.includes(
                                                "Do not start task/subagents",
                                            ),
                                    )
                                  : !listed.some((tool) =>
                                        tool.description?.includes(
                                            "Capture completion policy v1:",
                                        ),
                                    ),
                          metadataFieldGuidanceQualified:
                              entityKey === "A"
                                  ? listed.every(
                                        (tool) =>
                                            tool.description?.includes(
                                                "Metadata binding policy v1:",
                                            ) &&
                                            tool.description.includes(
                                                JSON.stringify(
                                                    admission.workflow.recipe[1]
                                                        .argumentTemplate
                                                        .entityUrls[0].suffix,
                                                ),
                                            ) &&
                                            tool.description.includes(
                                                "including lastModifiedDateTime",
                                            ),
                                    )
                                  : !listed.some((tool) =>
                                        tool.description?.includes(
                                            "Metadata binding policy v1:",
                                        ),
                                    ),
                      }
                    : {}),
            };
            if (Object.values(result).some((value) => value === false))
                throw new Error("metadataProbeBindingMismatch");
            probes.push(result);
        } finally {
            await client.close();
            await server.close();
        }
    }
    if (dataCalls !== 0) throw new Error("metadataProbeDataCall");
    process.stdout.write(
        `${JSON.stringify({ admissionSha256: hash, probes, dataCalls })}\n`,
    );
}

await probe().catch(() => {
    console.error(
        "Offline metadata binding probe failed; no private values emitted.",
    );
    process.exitCode = 1;
});
