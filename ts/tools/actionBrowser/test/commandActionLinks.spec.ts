// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    findMissingCommandActions,
    resolveCommandActionLinks,
} from "../src/collect.js";
import type {
    ActionInfo,
    AgentInfo,
    CommandActionLink,
    CommandInfo,
    SchemaInfo,
} from "../src/types.js";

function makeAction(actionName: string): ActionInfo {
    return { actionName, description: "", parameters: [], phrasings: [] };
}

function makeSchema(schemaName: string, actionNames: string[]): SchemaInfo {
    return {
        schemaName,
        description: "",
        defaultEnabled: true,
        transient: false,
        actions: actionNames.map(makeAction),
    };
}

function makeAgent(schemas: SchemaInfo[]): AgentInfo {
    return {
        name: "demo",
        category: "Other",
        emoji: "",
        description: "",
        schemas,
    };
}

function makeCommand(action: CommandActionLink): CommandInfo {
    return {
        host: "demo",
        path: "run",
        description: "",
        group: false,
        executable: true,
        args: [],
        flags: [],
        action,
    };
}

describe("resolveCommandActionLinks", () => {
    it("resolves a unique bare action name", () => {
        const command = makeCommand({ actionName: "runTask" });
        const issues = resolveCommandActionLinks(
            [makeAgent([makeSchema("demo", ["runTask"])])],
            [command],
        );

        expect(issues).toEqual([]);
        expect(command.action?.resolvedSchema).toBe("demo");
    });

    it("resolves an action in an explicitly qualified schema", () => {
        const command = makeCommand({
            schema: "demo.admin",
            actionName: "runTask",
        });
        const issues = resolveCommandActionLinks(
            [
                makeAgent([
                    makeSchema("demo", ["runTask"]),
                    makeSchema("demo.admin", ["runTask"]),
                ]),
            ],
            [command],
        );

        expect(issues).toEqual([]);
        expect(command.action?.resolvedSchema).toBe("demo.admin");
    });

    it("rejects an ambiguous bare action name", () => {
        const command = makeCommand({ actionName: "runTask" });
        const issues = resolveCommandActionLinks(
            [
                makeAgent([
                    makeSchema("demo", ["runTask"]),
                    makeSchema("demo.admin", ["runTask"]),
                ]),
            ],
            [command],
        );

        expect(command.action?.resolvedSchema).toBeUndefined();
        expect(issues[0].message).toMatch(/ambiguous/);
        expect(issues[0].message).toMatch(/demo, demo\.admin/);
    });

    it("rejects an unknown qualified schema", () => {
        const command = makeCommand({
            schema: "demo.missing",
            actionName: "runTask",
        });
        const issues = resolveCommandActionLinks(
            [makeAgent([makeSchema("demo", ["runTask"])])],
            [command],
        );

        expect(command.action?.resolvedSchema).toBeUndefined();
        expect(issues[0].message).toMatch(/not registered for host/);
    });

    it("rejects an action absent from the registered schema union", () => {
        const command = makeCommand({
            schema: "demo",
            actionName: "disabledTask",
        });
        const issues = resolveCommandActionLinks(
            [makeAgent([makeSchema("demo", ["runTask"])])],
            [command],
        );

        expect(command.action?.resolvedSchema).toBeUndefined();
        expect(issues[0].message).toMatch(/not registered in schema/);
    });
});

describe("findMissingCommandActions", () => {
    it("reports only executable endpoints without a declaration", () => {
        const missing = makeCommand({ actionName: "unused" });
        delete missing.action;
        const namespace = { ...missing, path: "admin", executable: false };
        const invalid = makeCommand({ actionName: "missingAction" });

        expect(
            findMissingCommandActions([missing, namespace, invalid]),
        ).toEqual([{ host: "demo", path: "run" }]);
    });
});
