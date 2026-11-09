// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import {
    isGhcpEvalFixtureFile,
    readGhcpEvalFilePolicy,
} from "./ghcpEvalFiles.js";

const digest = (value: string) =>
    createHash("sha256").update(value).digest("hex");
const fixtureNames = new Set([
    "report-a.txt",
    "report-b.txt",
    "trip.txt",
    "grocery.txt",
    "pantry.txt",
    "packing.txt",
    "errands.txt",
    "grocery-backup.txt",
]);

function pathDiagnostic(value: unknown, root: string) {
    if (typeof value !== "string") return { kind: "missing_or_non_string" };
    const name = path.basename(value);
    const knownName = fixtureNames.has(name);
    return {
        kind: path.isAbsolute(value) ? "absolute" : "relative",
        requestedSha256: digest(value),
        characters: value.length,
        fixtureName: knownName ? name : null,
        directFixtureFile:
            knownName && isGhcpEvalFixtureFile(value, root, [name], true),
        // Never persist external paths or prose accidentally bound as a path.
        sanitizedRequestedPath: knownName
            ? `<redacted-parent>\\${name}`
            : "<redacted-path>",
    };
}

function fileDenialReason(
    action: string,
    args: Record<string, unknown>,
    root: string,
) {
    const policy = readGhcpEvalFilePolicy();
    if (!policy) return "missing_file_policy";
    if (!["readFile", "writeFile", "copyFile", "listFiles"].includes(action))
        return "file_action_not_in_contract";
    if (action === "listFiles")
        return "inventory_scope_or_recursion_not_allowed";
    const fields = action === "copyFile" ? ["source", "destination"] : ["path"];
    for (const field of fields) {
        const value = args[field];
        if (typeof value !== "string") return `${field}_missing_or_non_string`;
        if (!path.isAbsolute(value)) return `${field}_not_absolute`;
    }
    if (action === "readFile" && !policy.readsEnabled)
        return "read_before_clarification_or_not_in_case";
    if (action !== "readFile" && !policy.writesEnabled)
        return "write_before_clarification_or_not_in_case";
    if (action === "copyFile" && !policy.allowCopy) return "copy_not_in_case";
    if (args.recurse === true) return "recursive_effect_not_allowed";
    if (
        action === "copyFile" &&
        policy.allowCopy &&
        !isGhcpEvalFixtureFile(String(args.source), root, [
            policy.allowCopy.source,
        ])
    )
        return "copy_source_outside_case_or_noncanonical_file";
    const target = String(action === "copyFile" ? args.destination : args.path);
    const names = action === "readFile" ? policy.readFiles : policy.writeFiles;
    if (!isGhcpEvalFixtureFile(target, root, names, action !== "readFile"))
        return "target_outside_case_or_noncanonical_file";
    if (action === "writeFile" && typeof args.content !== "string")
        return "content_missing_or_non_string";
    return "prerequisite_state_mismatch";
}

function correlation() {
    const file = process.env.TYPEAGENT_GHCP_EVAL_CORRELATION;
    if (!file) return { availability: "not_supplied" };
    const input = JSON.parse(fs.readFileSync(file, "utf8"));
    const hashes = Object.fromEntries(
        ["session", "call", "scope", "operation", "interaction"].map((key) => [
            `${key}Sha256`,
            typeof input[`${key}Sha256`] === "string" &&
            /^[a-f0-9]{64}$/.test(input[`${key}Sha256`])
                ? input[`${key}Sha256`]
                : null,
        ]),
    );
    return {
        ...hashes,
        caseId: /^(list-)?[SMRA][1-5]$/.test(input.caseId)
            ? input.caseId
            : null,
        candidate: Number.isInteger(input.candidate) ? input.candidate : null,
        callSequence: Number.isInteger(input.callSequence)
            ? input.callSequence
            : null,
    };
}

export function ghcpEvalDenialDiagnostic(
    schemaName: string,
    actionName: string,
    parameters: unknown,
    root: string,
) {
    const args =
        parameters !== null && typeof parameters === "object"
            ? (parameters as Record<string, unknown>)
            : {};
    const fileAction = schemaName === "powershell.powershell-files";
    return {
        schemaName,
        actionName,
        category:
            process.env.TYPEAGENT_GHCP_EVAL_CATEGORY === "lists"
                ? "lists"
                : "common-files",
        correlation: correlation(),
        reason: fileAction
            ? fileDenialReason(actionName, args, root)
            : "action_outside_active_category_policy",
        canonicalScope: {
            label: "<fixture-root>",
            sha256: digest(fs.realpathSync(root)),
        },
        paths: fileAction
            ? Object.fromEntries(
                  ["path", "source", "destination"].map((field) => [
                      field,
                      pathDiagnostic(args[field], root),
                  ]),
              )
            : undefined,
        content:
            fileAction && typeof args.content === "string"
                ? { characters: args.content.length }
                : undefined,
        recurse: args.recurse === true,
        append: args.append === true,
    };
}
