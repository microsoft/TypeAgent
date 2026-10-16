// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
    CallToolRequestSchema,
    ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import {
    loadScenarioCorpus,
    validateScenarioCorpus,
} from "./macro-eval-corpus.mjs";

const annotations = {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
};
const tool = (name, field, description) => ({
    name,
    description,
    inputSchema: {
        type: "object",
        properties: { [field]: { type: "string", minLength: 1 } },
        required: [field],
        additionalProperties: false,
    },
    annotations,
});
const tools = [
    tool(
        "lookup_document",
        "title",
        "Read-only lookup by unique exact title. Clarify missing or vague titles. Returns an ID or explicit not-found; never invent a title.",
    ),
    tool(
        "fetch_document",
        "id",
        "Read-only fetch by the exact ID returned by lookup_document for this task. Returns the full exact synthetic document.",
    ),
];
const result = (value) => ({
    content: [{ type: "text", text: JSON.stringify(value) }],
    structuredContent: value,
});
const errorResult = (text) => ({
    isError: true,
    content: [{ type: "text", text }],
});

function validAuditRecord(entry) {
    if (
        !entry ||
        typeof entry !== "object" ||
        Array.isArray(entry) ||
        typeof entry.timestamp !== "string" ||
        !Number.isFinite(Date.parse(entry.timestamp))
    )
        return false;
    const nonemptyString = (value) =>
        typeof value === "string" && value.trim() !== "";
    if (entry.operation === "lookup_document")
        return (
            nonemptyString(entry.title) &&
            (entry.returnedId === null || nonemptyString(entry.returnedId))
        );
    if (entry.operation === "fetch_document") return nonemptyString(entry.id);
    return (
        entry.operation === "rejected_tool_call" &&
        (entry.tool === undefined ||
            entry.tool === null ||
            typeof entry.tool === "string")
    );
}

function validateAuditContents(contents) {
    if (contents === "") return;
    if (!contents.endsWith("\n"))
        throw new Error(
            "nonempty audit must end with a complete JSONL newline",
        );
    const lines = contents.slice(0, -1).split("\n");
    for (let index = 0; index < lines.length; index++) {
        let entry;
        try {
            entry = JSON.parse(lines[index]);
        } catch {
            throw new Error(`invalid JSONL at audit line ${index + 1}`);
        }
        if (!validAuditRecord(entry))
            throw new Error(
                `invalid fixture audit record at line ${index + 1}`,
            );
    }
}

function openOwnedAudit(auditPath, appendAudit) {
    if (!appendAudit) return fs.openSync(auditPath, "wx");
    let fd;
    try {
        const before = fs.lstatSync(auditPath);
        if (before.isSymbolicLink() || !before.isFile())
            throw new Error(
                "audit must be an existing regular non-symlink file",
            );
        fd = fs.openSync(
            auditPath,
            fs.constants.O_RDWR |
                fs.constants.O_APPEND |
                (fs.constants.O_NOFOLLOW ?? 0),
        );
        const opened = fs.fstatSync(fd);
        const after = fs.lstatSync(auditPath);
        if (
            !opened.isFile() ||
            after.isSymbolicLink() ||
            !after.isFile() ||
            before.dev !== opened.dev ||
            before.ino !== opened.ino ||
            after.dev !== opened.dev ||
            after.ino !== opened.ino
        )
            throw new Error("audit path changed while opening the owned file");
        validateAuditContents(
            new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
                fs.readFileSync(fd),
            ),
        );
        return fd;
    } catch (error) {
        if (fd !== undefined) fs.closeSync(fd);
        throw new Error(
            `Invalid owned audit file for append: ${error.message}`,
            { cause: error },
        );
    }
}

export function createDocumentFixture({
    corpus,
    auditPath,
    appendAudit = false,
}) {
    validateScenarioCorpus(corpus);
    if (typeof auditPath !== "string" || auditPath.trim() === "")
        throw new Error("An owned audit output path is required");
    if (typeof appendAudit !== "boolean")
        throw new Error("appendAudit must be a boolean");
    const documents = structuredClone(corpus.documents);
    // Append requires the controller's explicit opt-in to an existing owned audit.
    const auditFd = openOwnedAudit(auditPath, appendAudit);
    let closed = false;
    const audit = (entry) => {
        if (closed) throw new Error("Fixture audit is closed");
        fs.writeSync(
            auditFd,
            `${JSON.stringify({ timestamp: new Date().toISOString(), ...entry })}\n`,
        );
        fs.fsyncSync(auditFd);
    };
    const close = () => {
        if (!closed) {
            closed = true;
            fs.closeSync(auditFd);
        }
    };
    const callTool = async (name, args) => {
        const definition = tools.find((entry) => entry.name === name);
        const field = definition?.inputSchema.required[0];
        if (
            !definition ||
            args === null ||
            typeof args !== "object" ||
            Array.isArray(args) ||
            Object.keys(args).length !== 1 ||
            typeof args[field] !== "string" ||
            args[field].trim() === ""
        ) {
            audit({
                operation: "rejected_tool_call",
                tool: typeof name === "string" ? name : null,
            });
            return errorResult("Unsupported tool or arguments.");
        }
        if (name === "lookup_document") {
            const document = documents.find(
                (entry) => entry.title === args.title,
            );
            audit({
                operation: name,
                title: args.title,
                returnedId: document?.expectedId ?? null,
            });
            return result({
                found: document !== undefined,
                id: document?.expectedId ?? null,
                title: document?.title ?? args.title,
            });
        }
        audit({ operation: name, id: args.id });
        const document = documents.find(
            (entry) => entry.expectedId === args.id,
        );
        return document
            ? result({
                  id: document.expectedId,
                  title: document.title,
                  content: document.content,
              })
            : errorResult(
                  "Unknown synthetic document ID; no document was fetched.",
              );
    };
    const server = new Server(
        { name: "macro-eval-documents", version: "1.0.0" },
        { capabilities: { tools: {} } },
    );
    server.setRequestHandler(ListToolsRequestSchema, async () => ({
        tools: structuredClone(tools),
    }));
    server.setRequestHandler(CallToolRequestSchema, async ({ params }) =>
        callTool(params.name, params.arguments),
    );
    return { server, callTool, close, tools: structuredClone(tools) };
}

export function parseFixtureOptions(argv, env = process.env) {
    const options = {
        corpusPath: env.MACRO_EVAL_CORPUS,
        auditPath: env.MACRO_EVAL_AUDIT,
        appendAudit: false,
    };
    const seen = new Set();
    for (let index = 0; index < argv.length; index++) {
        const name = argv[index];
        if (
            !["--corpus", "--audit", "--append-audit"].includes(name) ||
            seen.has(name)
        )
            throw new Error(
                "Usage: macro-eval-fixture --corpus <file> --audit <file> [--append-audit]",
            );
        seen.add(name);
        if (name === "--append-audit") {
            options.appendAudit = true;
            continue;
        }
        if (!argv[index + 1] || argv[index + 1].startsWith("--"))
            throw new Error(
                "Usage: macro-eval-fixture --corpus <file> --audit <file> [--append-audit]",
            );
        options[name === "--corpus" ? "corpusPath" : "auditPath"] =
            argv[++index];
    }
    for (const name of ["corpusPath", "auditPath"]) {
        const value = options[name];
        if (typeof value !== "string" || value.trim() === "")
            throw new Error(`${name} is required`);
    }
    if (path.resolve(options.corpusPath) === path.resolve(options.auditPath))
        throw new Error("Audit output must not be the corpus file");
    return options;
}

async function main() {
    const { corpusPath, auditPath, appendAudit } = parseFixtureOptions(
        process.argv.slice(2),
    );
    const fixture = createDocumentFixture({
        corpus: loadScenarioCorpus(corpusPath),
        auditPath,
        appendAudit,
    });
    process.once("exit", fixture.close);
    fixture.server.onclose = fixture.close;
    try {
        await fixture.server.connect(new StdioServerTransport());
    } catch (error) {
        fixture.close();
        throw error;
    }
}

if (
    process.argv[1] &&
    import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
    main().catch((error) => {
        console.error(error.message);
        process.exitCode = 1;
    });
}
