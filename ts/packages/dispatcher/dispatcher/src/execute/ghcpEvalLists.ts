// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import fs from "node:fs";

export type GhcpEvalListRule = {
    actionName: string;
    listName?: string;
    items?: string[];
    before?: Record<string, string[] | null>;
};

export type GhcpEvalListPolicy = {
    version: 1;
    category: "lists";
    store: string;
    enabled: boolean;
    rules: GhcpEvalListRule[];
    externalReads?: {
        schemaName: string;
        actionName: string;
        repo: string;
        number: number;
    }[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function strings(value: unknown): value is string[] {
    return (
        Array.isArray(value) && value.every((item) => typeof item === "string")
    );
}

function validRule(value: unknown): boolean {
    if (!isRecord(value)) return false;
    const { actionName, listName, items, before } = value;
    if (actionName === "listLists")
        return (
            listName === undefined &&
            items === undefined &&
            before === undefined
        );
    if (typeof listName !== "string" || !listName) return false;
    const itemAction =
        actionName === "addItems" || actionName === "removeItems";
    if (
        !(
            itemAction ||
            ["getList", "createList", "clearList"].includes(String(actionName))
        )
    )
        return false;
    if (
        itemAction ? !strings(items) || items.length === 0 : items !== undefined
    )
        return false;
    return (
        before === undefined ||
        (isRecord(before) &&
            Object.values(before).every(
                (value) => value === null || strings(value),
            ))
    );
}

export function readGhcpEvalListPolicy(
    file = process.env.TYPEAGENT_GHCP_EVAL_LIST_POLICY,
): GhcpEvalListPolicy | undefined {
    if (!file) return undefined;
    const policy = JSON.parse(fs.readFileSync(file, "utf8"));
    if (
        !isRecord(policy) ||
        policy.version !== 1 ||
        policy.category !== "lists" ||
        typeof policy.store !== "string" ||
        typeof policy.enabled !== "boolean" ||
        !Array.isArray(policy.rules) ||
        !policy.rules.every(validRule)
    )
        throw new Error("Invalid GHCP eval list policy");
    if (
        policy.externalReads !== undefined &&
        (!Array.isArray(policy.externalReads) ||
            policy.externalReads.some(
                (read) =>
                    !isRecord(read) ||
                    read.schemaName !== "github-cli" ||
                    read.actionName !== "issueView" ||
                    typeof read.repo !== "string" ||
                    !Number.isSafeInteger(read.number) ||
                    Number(read.number) <= 0,
            ))
    )
        throw new Error("Invalid GHCP eval external read policy");
    return policy as GhcpEvalListPolicy;
}

/** The launcher supplies exact per-case operations, never a general list grant. */
export function ghcpEvalListActionAllowed(
    actionName: string,
    parameters: unknown,
    policy: GhcpEvalListPolicy,
): boolean {
    if (
        !policy.enabled ||
        typeof parameters !== "object" ||
        parameters === null ||
        Array.isArray(parameters)
    )
        return false;
    const args = parameters as Record<string, unknown>;
    return policy.rules.some((rule) => {
        if (rule.actionName !== actionName) return false;
        const keys = rule.items
            ? ["listName", "items"]
            : rule.listName
              ? ["listName"]
              : [];
        if (
            Object.keys(args).length !== keys.length ||
            keys.some((key) => !(key in args)) ||
            args.listName !== rule.listName
        )
            return false;
        const allowedItems = rule.items;
        if (
            allowedItems &&
            (!Array.isArray(args.items) ||
                args.items.length === 0 ||
                !args.items.every(
                    (item) =>
                        typeof item === "string" && allowedItems.includes(item),
                ))
        )
            return false;
        if (!rule.before) return true;
        const stat = fs.lstatSync(policy.store);
        if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1)
            throw new Error("Unsafe GHCP eval list store");
        const lists: { name: string; items: string[] }[] = JSON.parse(
            fs.readFileSync(policy.store, "utf8"),
        );
        return Object.entries(rule.before).every(([name, expected]) => {
            const list = lists.find((entry) => entry.name === name);
            return expected === null
                ? list === undefined
                : list !== undefined &&
                      JSON.stringify([...list.items].sort()) ===
                          JSON.stringify([...expected].sort());
        });
    });
}

export function ghcpEvalListExternalReadAllowed(
    schemaName: string,
    actionName: string,
    parameters: unknown,
    policy: GhcpEvalListPolicy,
): boolean {
    if (
        !policy.enabled ||
        typeof parameters !== "object" ||
        parameters === null
    )
        return false;
    const args = parameters as Record<string, unknown>;
    return (
        schemaName === "github-cli" &&
        actionName === "issueView" &&
        Object.keys(args).every((key) => key === "repo" || key === "number") &&
        policy.externalReads?.some(
            (read) =>
                read.schemaName === schemaName &&
                read.actionName === actionName &&
                read.repo === args.repo &&
                read.number === args.number,
        ) === true
    );
}
