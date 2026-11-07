// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type {
    CommandHandler,
    CommandHandlerTable,
} from "@typeagent/agent-sdk/helpers/command";
import { displayResult } from "@typeagent/agent-sdk/helpers/display";
import type { ActionContext, ParsedCommandParams } from "@typeagent/agent-sdk";
import type { PackageAgentContext } from "./packageAgent.js";

class MemoryViewCommand implements CommandHandler {
    public readonly description: string;
    public readonly parameters = {
        args: {
            target: {
                description: "Package target or installed name",
                type: "string",
                optional: true,
            },
        },
        flags: {
            source: { description: "Named install source", type: "string" },
            "dry-run": {
                description: "Preview without installation",
                type: "boolean",
            },
            range: {
                description: "Package update version range",
                type: "string",
            },
        },
    } as const;
    public constructor(
        private readonly operation:
            | "list"
            | "available"
            | "install"
            | "update"
            | "uninstall",
    ) {
        this.description = `Memory-view package ${operation}`;
    }
    public async run(
        context: ActionContext<PackageAgentContext>,
        params: ParsedCommandParams<typeof this.parameters>,
    ) {
        const manager = context.sessionContext.agentContext.memoryViews;
        if (!manager)
            throw new Error(
                "Memory-view package installation is unavailable on this host",
            );
        this.validateParameters(params);
        const target = params.args?.target;
        let result: unknown;
        if (this.operation === "list") result = await manager.list();
        else if (this.operation === "available")
            result = await manager.available(params.flags?.source);
        else {
            if (!target)
                throw new Error(
                    `Memory-view ${this.operation} requires a target`,
                );
            if (this.operation === "install")
                result = params.flags?.["dry-run"]
                    ? await manager.preview(target, params.flags?.source)
                    : await manager.install(target, params.flags?.source);
            else if (this.operation === "update")
                result = await manager.update(target, params.flags?.range);
            else {
                await manager.uninstall(target);
                result = { name: target, removed: true };
            }
        }
        if (result === undefined)
            throw new Error("No source could resolve the memory-view package");
        displayResult(JSON.stringify(result, null, 2), context);
    }

    private validateParameters(
        params: ParsedCommandParams<typeof this.parameters>,
    ) {
        const target = params.args?.target;
        if (params.flags?.["dry-run"] && this.operation !== "install")
            throw new Error(
                "--dry-run is supported only for memory-view install",
            );
        if (params.flags?.range && this.operation !== "update")
            throw new Error("--range is supported only for memory-view update");
        if (
            params.flags?.source &&
            !["install", "available"].includes(this.operation)
        )
            throw new Error(
                "--source is supported only for memory-view install/available",
            );
        if (target && ["list", "available"].includes(this.operation))
            throw new Error(
                `Memory-view ${this.operation} does not accept a target`,
            );
    }
}

export function buildMemoryViewCommandTable(): CommandHandlerTable {
    return {
        description:
            "Manage memory-view packs; activation requires an explicit memory host",
        defaultSubCommand: "list",
        commands: {
            list: new MemoryViewCommand("list"),
            available: new MemoryViewCommand("available"),
            install: new MemoryViewCommand("install"),
            update: new MemoryViewCommand("update"),
            uninstall: new MemoryViewCommand("uninstall"),
        },
    };
}
