// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
    readGhcpEvalListPolicy,
    ghcpEvalListActionAllowed,
} from "../src/execute/ghcpEvalLists.js";
import {
    assertGhcpEvalAction,
    isGhcpEvalReadOnlyAction,
    isGhcpEvalRecoverableReadError,
} from "../src/execute/ghcpEvalPolicy.js";

describe("category-specific evaluation list admission", () => {
    let directory: string;
    let saved: NodeJS.ProcessEnv;
    beforeEach(() => {
        saved = { ...process.env };
        directory = fs.mkdtempSync(path.join(os.tmpdir(), "list-policy-"));
        delete process.env.TYPEAGENT_GHCP_EVAL_FIXTURES;
        delete process.env.TYPEAGENT_GHCP_EVAL_TRACE;
        process.env.TYPEAGENT_GHCP_EVAL_CATEGORY = "lists";
        process.env.TYPEAGENT_GHCP_EVAL_LIST_POLICY = path.join(
            directory,
            "policy.json",
        );
        process.env.TYPEAGENT_GHCP_EVAL_FILE_POLICY = path.join(
            directory,
            "files.json",
        );
        fs.writeFileSync(
            process.env.TYPEAGENT_GHCP_EVAL_LIST_POLICY,
            JSON.stringify({
                version: 1,
                category: "lists",
                store: path.join(directory, "lists.json"),
                enabled: true,
                rules: [
                    {
                        actionName: "addItems",
                        listName: "grocery",
                        items: ["apples"],
                    },
                ],
                externalReads: [
                    {
                        schemaName: "github-cli",
                        actionName: "issueView",
                        repo: "microsoft/TypeAgent",
                        number: 2617,
                    },
                ],
            }),
        );
        fs.writeFileSync(
            process.env.TYPEAGENT_GHCP_EVAL_FILE_POLICY,
            JSON.stringify({
                version: 1,
                readFiles: [],
                writeFiles: [],
                readsEnabled: false,
                writesEnabled: false,
                allowInventory: false,
                prerequisites: {},
            }),
        );
    });
    afterEach(() => {
        process.env = saved;
        fs.rmSync(directory, { recursive: true, force: true });
    });
    it("admits only the active case, not global list/file/external access", () => {
        expect(() =>
            assertGhcpEvalAction(
                "list",
                "addItems",
                { listName: "grocery", items: ["apples"] },
                directory,
            ),
        ).not.toThrow();
        expect(() =>
            assertGhcpEvalAction(
                "github-cli",
                "issueView",
                { repo: "microsoft/TypeAgent", number: 2617 },
                directory,
            ),
        ).not.toThrow();
        for (const [schema, action, parameters] of [
            ["list", "clearList", { listName: "grocery" }],
            ["list", "addItems", { listName: "pantry", items: ["apples"] }],
            [
                "github-cli",
                "issueView",
                { repo: "microsoft/TypeAgent", number: 1 },
            ],
            ["github-cli", "prFiles", {}],
            ["ipconfig", "displayFullConfigurationInformation", {}],
            [
                "powershell.powershell-files",
                "writeFile",
                { path: path.join(directory, "trip.txt"), content: "x" },
            ],
        ] as const)
            expect(() =>
                assertGhcpEvalAction(schema, action, parameters, directory),
            ).toThrow("before execution");
    });
    it("never widens common files or normal sessions", () => {
        process.env.TYPEAGENT_GHCP_EVAL_CATEGORY = "common-files";
        expect(() =>
            assertGhcpEvalAction(
                "list",
                "addItems",
                { listName: "grocery", items: ["apples"] },
                directory,
            ),
        ).toThrow("before execution");
        expect(() =>
            assertGhcpEvalAction("list", "clearList", {}),
        ).not.toThrow();
    });
    it("missing or malformed list policies fail closed without legacy read fallback", () => {
        delete process.env.TYPEAGENT_GHCP_EVAL_LIST_POLICY;
        expect(() =>
            assertGhcpEvalAction("list", "addItems", {}, directory),
        ).toThrow("before execution");
        delete process.env.TYPEAGENT_GHCP_EVAL_FILE_POLICY;
        fs.writeFileSync(path.join(directory, "trip.txt"), "private");
        expect(() =>
            assertGhcpEvalAction(
                "powershell.powershell-files",
                "readFile",
                { path: path.join(directory, "trip.txt") },
                directory,
            ),
        ).toThrow("before execution");
        const file = path.join(directory, "bad.json");
        for (const rules of [
            [{ actionName: "deleteList", listName: "grocery" }],
            [{ actionName: "addItems", listName: "grocery", items: [3] }],
            [null],
        ]) {
            fs.writeFileSync(
                file,
                JSON.stringify({
                    version: 1,
                    category: "lists",
                    store: "",
                    enabled: true,
                    rules,
                }),
            );
            expect(() => readGhcpEvalListPolicy(file)).toThrow(
                "Invalid GHCP eval list policy",
            );
        }
    });
    it("disabled ambiguity policy rejects even exact approved item arguments", () => {
        const policy = readGhcpEvalListPolicy()!;
        expect(
            ghcpEvalListActionAllowed(
                "addItems",
                { listName: "grocery", items: ["apples"] },
                { ...policy, enabled: false },
            ),
        ).toBe(false);
    });
    it("safe recovery remains read-only and denial or uncertainty wins", () => {
        expect(isGhcpEvalReadOnlyAction("list", "getList")).toBe(true);
        expect(isGhcpEvalReadOnlyAction("list", "listLists")).toBe(true);
        for (const action of [
            "addItems",
            "removeItems",
            "clearList",
            "createList",
        ])
            expect(isGhcpEvalReadOnlyAction("list", action)).toBe(false);
        expect(
            isGhcpEvalRecoverableReadError("ENOENT: list snapshot missing"),
        ).toBe(true);
        for (const error of [
            undefined,
            "permission denied: ENOENT",
            "uncertain: ETIMEDOUT",
            "cancelled: ECONNRESET",
        ])
            expect(isGhcpEvalRecoverableReadError(error)).toBe(false);
    });
});
