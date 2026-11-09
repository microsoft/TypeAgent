// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { isDeepStrictEqual } from "node:util";
import { readLists } from "./ghcp-eval-lists.mjs";

export const listRequiredContracts = [
    ...[
        "listLists",
        "getList",
        "createList",
        "addItems",
        "removeItems",
        "clearList",
    ].map((action) => ["list", action]),
    ["github-cli", "issueView"],
    ["powershell.powershell-files", "readFile"],
];

export function preflightListPolicy(store) {
    return {
        version: 1,
        category: "lists",
        store,
        enabled: true,
        rules: [
            { actionName: "listLists" },
            ...["getList", "createList", "clearList"].map((actionName) => ({
                actionName,
                listName: "preflight",
            })),
            ...["addItems", "removeItems"].map((actionName) => ({
                actionName,
                listName: "preflight",
                items: ["milk", "eggs"],
            })),
        ],
        externalReads: [
            {
                schemaName: "github-cli",
                actionName: "issueView",
                repo: "microsoft/TypeAgent",
                number: 2617,
            },
        ],
    };
}

export async function verifyListPreflight(client, scopeId, env, result) {
    const invoke = async (actionName, parameters) => {
        const action = { schemaName: "list", actionName, parameters };
        let response = await client.callTool(
            {
                name: "typeagent-executeAction",
                arguments: { protocolVersion: 1, scopeId, ...action },
            },
            undefined,
            { timeout: 60_000 },
        );
        const pending = response.structuredContent;
        if (
            pending?.status === "requires_interaction" &&
            pending.scopeId === scopeId &&
            pending.prompt?.type === "confirmation" &&
            pending.prompt.action?.schemaName === "list" &&
            pending.prompt.action.actionName === actionName &&
            isDeepStrictEqual(pending.prompt.action.parameters, parameters)
        ) {
            response = await client.callTool(
                {
                    name: "typeagent-continueAction",
                    arguments: {
                        protocolVersion: 1,
                        scopeId,
                        operationId: pending.operationId,
                        interactionId: pending.interactionId,
                        response: { type: "confirmation", approved: true },
                    },
                },
                undefined,
                { timeout: 60_000 },
            );
        }
        assert.notEqual(response.isError, true);
        assert.equal(response.structuredContent?.status, "completed");
        result.externalEvidence.push({
            schemaName: "list",
            actionName,
            capturedAt: new Date().toISOString(),
            outcome: response.structuredContent,
        });
    };
    await invoke("listLists", {});
    const stores = fs
        .readdirSync(env.TYPEAGENT_USER_DATA_DIR, { recursive: true })
        .filter((name) => path.basename(name) === "lists.json")
        .map((name) => path.join(env.TYPEAGENT_USER_DATA_DIR, name));
    assert.equal(stores.length, 1);
    const store = stores[0];
    assert.deepEqual(readLists(store), {});
    fs.writeFileSync(
        env.TYPEAGENT_GHCP_EVAL_LIST_POLICY,
        JSON.stringify(preflightListPolicy(store)),
    );
    await invoke("createList", { listName: "preflight" });
    assert.deepEqual(readLists(store), { preflight: [] });
    await invoke("addItems", {
        listName: "preflight",
        items: ["milk", "eggs"],
    });
    assert.deepEqual(readLists(store), { preflight: ["eggs", "milk"] });
    await invoke("getList", { listName: "preflight" });
    await invoke("removeItems", { listName: "preflight", items: ["milk"] });
    assert.deepEqual(readLists(store), { preflight: ["eggs"] });
    await invoke("clearList", { listName: "preflight" });
    assert.deepEqual(readLists(store), { preflight: [] });
    return store;
}
