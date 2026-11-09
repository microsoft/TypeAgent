// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import {
    cp,
    lstat,
    mkdir,
    mkdtemp,
    readFile,
    readdir,
    rm,
    writeFile,
} from "node:fs/promises";
import { createServer } from "node:net";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const pluginRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
    "..",
);
const run = promisify(execFile);

const proof = String.raw`
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

assert.equal(existsSync("node_modules"), false);
assert.equal(existsSync("src"), false);
assert.equal(existsSync("config.local.yaml"), false);
assert.throws(() => readFileSync(process.env.CHECKOUT_DENIED), { code: "ERR_ACCESS_DENIED" });
const api = await import(pathToFileURL(resolve("dist", "recipe-runtime", "index.mjs")).href);
assert.equal(typeof api.MacroManager, "function");
assert.equal(typeof api.createMacroLearningRuntime, "function");
assert.equal(typeof api.createMacroProgramAuthor, "function");
const portableSchema = {
    type: "object", properties: { path: { type: "string" } },
    required: ["path"], additionalProperties: false,
};
const portableCapability = {
    id: "read", transport: "native", providerId: "copilot", operation: "read",
    contractVersion: "1", inputSchema: portableSchema, outputSchema: { type: "string" },
    schemaDigest: api.recipeSchemaDigest(portableSchema, { type: "string" }),
    compatibility: "exact", effect: "read",
};
const portableTrace = {
    schemaVersion: 1, sessionId: "recording", cwd: process.cwd(),
    prompt: "read alpha now", response: "alpha body",
    startedAt: "2026-10-15T00:00:00.000Z", completedAt: "2026-10-15T00:00:01.000Z",
    toolCalls: [{
        toolCallId: "call", name: "read", arguments: { path: "alpha" },
        result: "alpha body", status: "completed",
    }],
};
const portableFixture = JSON.parse(readFileSync("portable-child-fixture.json", "utf8"));
const portableMacro = {
    schemaVersion: 1, macroId: "portable", version: 1, sourceTraceId: portableFixture.traceId,
    name: "Read", description: "Read current contents", state: "draft",
    executionClass: "replayable", createdAt: portableTrace.completedAt,
    inputs: [{
        name: "path", description: "Path", required: true, secret: false, valueType: "string",
    }],
    steps: [{
        id: "step", sourceToolCallId: "call", toolName: "read",
        arguments: { kind: "literal", value: { path: "alpha" } },
        executionClass: "replayable",
    }],
    warnings: [],
    learning: {
        jobId: portableFixture.job.jobId, cwd: portableTrace.cwd, mode: "prepare", requiresLivePermissions: true,
        authoring: portableFixture.job.authoring,
        grammarRules: ['<Start> = read $(path:string) now -> { actionName: "run_portable_v2", parameters: { path } };'],
        requests: [portableTrace.prompt], exampleInputs: { path: "alpha" },
    },
};
const portablePlan = {
    inputSchema: portableSchema, outputSchema: { type: "string" },
    specification: {
        id: "read", revision: "1", intent: "Return current file contents",
        outputRequirements: ["Return the current tool result"], rubric: "Read the requested path",
        counterexamples: ["Do not freeze the captured path or result"],
    },
    semanticFunctions: [], applicability: { assumptions: [], unsupported: [] },
    fixtures: [
        {
            id: "observed", origin: "observed", input: { path: "alpha" },
            calls: [{ kind: "capability", id: "read", input: { path: "alpha" }, output: "alpha body" }],
            expectedOutput: "alpha body",
        },
        {
            id: "independent", origin: "independent", input: { path: "beta" },
            calls: [{ kind: "capability", id: "read", input: { path: "beta" }, output: "fresh beta body" }],
            expectedOutput: "fresh beta body",
        },
    ],
};
const portableSource = 'async function execute(api: RecipeApi, params: JsonValue): Promise<JsonValue> { return await api.tools.call("read", params); }';
let sourceQueries = 0;
let verifierQueries = 0;
const unusedQuery = async () => { throw new Error("Unexpected default source query"); };
const author = api.createMacroProgramAuthor({
    query: unusedQuery,
    verifierQuery: async (prompt) => {
        verifierQueries++;
        assert.equal(prompt.includes(portableSource), false);
        return JSON.stringify(portablePlan);
    },
    inspectCapability: async () => portableCapability,
    semanticModelPolicy: { id: "host-approved", revision: "1" },
});
const portableRuntime = api.createMacroLearningRuntime(
    unusedQuery, undefined, undefined, author,
).withAuthorQuery(async (prompt) => {
    sourceQueries++;
    assert.equal(prompt.includes("fresh beta body"), false);
    return JSON.stringify({ source: portableSource });
}, async (_prompt, execute) => execute());
const authored = await portableRuntime.buildProgram(
    portableMacro, portableTrace, new AbortController().signal,
);
assert.deepEqual(api.validateRecipeArtifact(authored), []);
assert.equal(authored.execution, "symbolic");
assert.equal(authored.fixtures.length, 2);
assert.ok(authored.fixtures.every(fixture => fixture.noLiveEffects));
assert.equal(sourceQueries, 1);
assert.equal(verifierQueries, 1);
const capability = {
    id: "fixture-read", transport: "native", providerId: "fixture",
    operation: "read", contractVersion: "1",
    inputSchema: { type: "null" }, outputSchema: { type: "string" },
    schemaDigest: api.recipeSchemaDigest({ type: "null" }, { type: "string" }),
    compatibility: "exact", effect: "read",
};
function program(body, typedParameters = "api, params") {
    const source = "async function execute(" + typedParameters + ") { " + body + " }";
    return api.sealRecipeArtifact({
        schemaVersion: 1, kind: "program", recipeId: "copied-program",
        name: "Copied program", description: "Actual contained package proof",
        execution: "symbolic", authorization: "live_host",
        source: { language: "typescript", text: source, digest: api.recipeDigest(source) },
        executable: api.compileRecipeProgram(source),
        inputSchema: { type: "null" }, outputSchema: { type: "string" },
        output: { kind: "value", requirements: ["Fresh"], identity: "current_run" },
        capabilities: [capability], semanticFunctions: [],
        applicability: { assumptions: [], unsupported: [] }, generalization: [],
        specification: {
            id: "spec", revision: "1", intent: "Read fixture",
            outputRequirements: ["Fresh"], rubric: "Exact", counterexamples: ["Write"],
        },
        matching: {
            grammar: ['<Start> = read fixture -> {};'],
            examples: [{ request: "read fixture", input: null, evidenceIds: ["proof"] }],
            negatives: ["write fixture"], collisionEvidenceIds: [],
        },
        provenance: { captureId: "proof", taskId: "proof", tokenId: "proof", evidenceIds: ["proof"] },
        fixtures: [{
            id: "proof", origin: "synthetic", result: "passed",
            specificationRevision: "1", noLiveEffects: true,
        }],
        createdAt: "2026-10-15T20:00:00Z",
    });
}
let invocations = 0;
let hostOutcome = { status: "completed", value: "fresh" };
const host = new api.FakeRecipeHost();
host.registerCapability(capability, () => {
    invocations++;
    return hostOutcome;
});
function context(signal = new AbortController().signal, fixtureHost = host) {
    return {
        runId: "copy-" + invocations,
        binding: {
            workspaceId: "isolated", profileId: "fixture", providerId: "fixture",
            accountId: "fixture", sessionId: "fixture", generation: "1",
        },
        signal, host: fixtureHost,
    };
}
const authoredHost = new api.FakeRecipeHost();
authoredHost.registerCapability(portableCapability, input => ({
    status: "completed", value: "fresh " + input.path + " body",
}));
const authoredRun = await api.executeRecipeProgram(
    authored, { path: "beta" }, context(new AbortController().signal, authoredHost),
);
assert.equal(authoredRun.status, "completed", authoredRun.message);
assert.equal(authoredRun.output, "fresh beta body");
assert.throws(
    () => api.compileRecipeProgram('async function execute(api, params) { const n: number = "not a number"; return n; }'),
    /Type 'string' is not assignable to type 'number'/,
);
assert.throws(
    () => api.compileRecipeProgram('async function execute(api, params) { return process.env.SECRET; }'),
    /ambient authority/,
);
const artifact = program(
    'const values: Array<string> = await Promise.all([api.tools.call("fixture-read", null).then(String)]); return values.map(value => value.toUpperCase()).join(",");',
);
assert.equal(artifact.executable.compiler.name, "typescript");
assert.equal(artifact.executable.compiler.version, "5.4.5");
assert.notEqual(artifact.source.text, artifact.executable.text);
const compiled = await api.executeRecipeProgram(artifact, null, context());
assert.equal(compiled.status, "completed", compiled.message);
assert.equal(compiled.output, "FRESH");
assert.equal(invocations, 1);
assert.equal(host.calls.length, 1);
const repeated = await api.executeRecipeProgram(artifact, null, context());
assert.equal(repeated.output, "FRESH");
assert.equal(invocations, 2);

hostOutcome = { status: "denied", code: "permission", message: "Fixture denied" };
const denied = await api.executeRecipeProgram(
    program('try { await api.tools.call("fixture-read", null); } catch {} return String(await api.tools.call("fixture-read", null));'),
    null, context(),
);
assert.equal(denied.status, "denied");
assert.equal(denied.fallback, "never");
assert.equal(invocations, 3);

const controller = new AbortController();
let cancelledCall = false;
const waitingHost = new api.FakeRecipeHost();
waitingHost.registerCapability(capability, (_input, call) => new Promise((resolve) => {
    cancelledCall = true;
    call.signal.addEventListener("abort", () => resolve({
        status: "cancelled", code: "cancelled", message: "Stopped",
    }), { once: true });
    setTimeout(() => controller.abort(), 10);
}));
const cancelled = await api.executeRecipeProgram(
    program('return String(await api.tools.call("fixture-read", null));'),
    null, context(controller.signal, waitingHost),
);
assert.equal(cancelledCall, true);
assert.equal(cancelled.status, "cancelled");

const looping = program('while (true) {} return "unreachable";');
const started = Date.now();
const limited = await api.executeRecipeProgram(looping, null, context(), { timeoutMs: 300 });
assert.equal(limited.status, "limit_exceeded", limited.message);
assert.ok(Date.now() - started < 5000);
const unavailableGlobals = program(
    'const global = ({}).constructor.constructor("return this")(); return ["process", "require", "fetch", "WebSocket"].map(name => typeof global[name]).join(",");',
);
const contained = await api.executeRecipeProgram(unavailableGlobals, null, context());
assert.equal(contained.status, "completed", contained.message);
assert.equal(contained.output, "undefined,undefined,undefined,undefined");

const { revision, ...content } = artifact;
const forgedText = 'async function execute() { return "forged"; }';
const forged = api.sealRecipeArtifact({
    ...content,
    executable: { ...artifact.executable, text: forgedText, digest: api.recipeDigest(forgedText) },
});
const corruption = await api.executeRecipeProgram(forged, null, context());
assert.equal(corruption.status, "failed");
assert.match(corruption.message, /checked compiler output/);
const wrongCompiler = api.sealRecipeArtifact({
    ...content,
    executable: { ...artifact.executable, compiler: { ...artifact.executable.compiler, version: "forged" } },
});
assert.equal((await api.executeRecipeProgram(wrongCompiler, null, context())).status, "failed");
assert.equal((await api.executeRecipeProgram(
    { ...artifact, source: { ...artifact.source, text: "corrupted" } }, null, context(),
)).status, "failed");
process.stdout.write(JSON.stringify({
    compiled: compiled.status, symbolic: artifact.execution,
    fixtureCalls: invocations, denied: denied.status, cancelled: cancelled.status,
    deadline: limited.status, contained: contained.output,
    forgery: corruption.status, compiler: artifact.executable.compiler,
    portableAuthor: authoredRun.status, portableFixtures: authored.fixtures.length,
}) + "\n");
`;

async function createChildFixture(directory) {
    const { pathToFileURL } = await import("node:url");
    const api = await import(
        pathToFileURL(
            path.join(pluginRoot, "dist", "recipe-runtime", "index.mjs"),
        ).href
    );
    const manager = new api.MacroManager(
        path.join(directory, "portable-child-capture"),
    );
    const trace = {
        schemaVersion: 1,
        sessionId: "recording",
        cwd: directory,
        prompt: "read alpha now",
        response: "alpha body",
        startedAt: "2026-10-15T00:00:00.000Z",
        completedAt: "2026-10-15T00:00:01.000Z",
        toolCalls: [
            {
                toolCallId: "call",
                name: "read",
                arguments: { path: "alpha" },
                result: "alpha body",
                status: "completed",
            },
        ],
    };
    try {
        await manager.setMacroLearningPreference({
            cwd: directory,
            mode: "prepare",
        });
        const token = manager.armRecording({
            sessionId: trace.sessionId,
            cwd: directory,
            learning: true,
        });
        manager.claimRecording({
            sessionId: trace.sessionId,
            cwd: directory,
            promptHash: api.recipeDigest(trace.prompt),
        });
        const capture = await manager.finalizeRecording({
            tokenId: token.id,
            trace,
            childAuthoring: {
                taskId: "recording:root-user",
                firstEventId: "root-user",
                successEventId: "root-success-receipt",
                outputEventId: "root-final-answer",
                recordingTokenId: token.id,
            },
        });
        const job = await manager.getMacroLearningJob(capture.learningJobId);
        await writeFile(
            path.join(directory, "portable-child-fixture.json"),
            JSON.stringify({ traceId: capture.traceId, job }),
        );
    } finally {
        await manager.close();
    }
}

async function checkCopiedFiles(root) {
    for (const name of await readdir(root)) {
        const file = path.join(root, name);
        const stat = await lstat(file);
        assert.equal(stat.isSymbolicLink(), false, file);
        assert.notEqual(name, "node_modules");
        if (stat.isDirectory()) await checkCopiedFiles(file);
    }
}

test(
    "copied dist compiles real TypeScript and executes contained QuickJS without checkout access",
    { timeout: 60_000 },
    async () => {
        const directory = await mkdtemp(
            path.join(pluginRoot, ".checkpoint-c-package-"),
        );
        let connections = 0;
        const backend = createServer((socket) => {
            connections++;
            socket.destroy();
        });
        try {
            backend.listen(0, "127.0.0.1");
            await once(backend, "listening");
            const address = backend.address();
            assert.ok(address && typeof address !== "string");
            for (const name of ["hooks", "mcp", "extensions", "recipe-runtime"])
                await cp(
                    path.join(pluginRoot, "dist", name),
                    path.join(directory, "dist", name),
                    { recursive: true, dereference: true },
                );
            await writeFile(
                path.join(directory, "package.json"),
                '{"type":"module"}\n',
            );
            await writeFile(path.join(directory, "proof.mjs"), proof);
            await mkdir(path.join(directory, "home"));
            await checkCopiedFiles(directory);
            await createChildFixture(directory);
            const manifest = JSON.parse(
                await readFile(
                    path.join(
                        directory,
                        "dist",
                        "recipe-runtime",
                        "assets.json",
                    ),
                    "utf8",
                ),
            );
            assert.equal(manifest.typescript, "5.4.5");
            assert.equal(manifest.quickjs.version, "0.23.0");
            assert.ok(manifest.quickjs.wasm.bytes > 100_000);
            assert.ok(
                manifest.assets.some(({ path }) =>
                    path.endsWith("lib.es5.d.ts"),
                ),
            );
            assert.ok(
                manifest.assets.some(({ path }) =>
                    path.endsWith("recipeExecutorWorker.mjs"),
                ),
            );
            for (const asset of manifest.assets) {
                const content = await readFile(
                    path.join(directory, "dist", asset.path),
                );
                assert.equal(content.length, asset.bytes, asset.path);
                assert.equal(
                    createHash("sha256").update(content).digest("hex"),
                    asset.sha256,
                    asset.path,
                );
            }
            const loader = await readFile(
                path.join(directory, "dist", manifest.quickjs.wasm.path),
                "utf8",
            );
            const encoded = loader.match(
                /["']data:application\/octet-stream;base64,([A-Za-z0-9+/=]+)["']/,
            );
            assert.ok(encoded);
            const wasm = Buffer.from(encoded[1], "base64");
            assert.equal(WebAssembly.validate(wasm), true);
            assert.equal(
                createHash("sha256").update(wasm).digest("hex"),
                manifest.quickjs.wasm.sha256,
            );
            const env = {
                ...(process.env.SystemRoot
                    ? { SystemRoot: process.env.SystemRoot }
                    : {}),
                ...(process.env.WINDIR ? { WINDIR: process.env.WINDIR } : {}),
                HOME: path.join(directory, "home"),
                USERPROFILE: path.join(directory, "home"),
                APPDATA: path.join(directory, "home"),
                LOCALAPPDATA: path.join(directory, "home"),
                TYPEAGENT_PLUGIN_DATA: path.join(directory, "data"),
                TYPEAGENT_HOST: "127.0.0.1",
                TYPEAGENT_PORT: String(address.port),
                CHECKOUT_DENIED: path.join(pluginRoot, "package.json"),
            };
            const result = await run(
                process.execPath,
                [
                    "--permission",
                    `--allow-fs-read=${directory}`,
                    "--allow-worker",
                    path.join(directory, "proof.mjs"),
                ],
                {
                    cwd: directory,
                    env,
                    timeout: 45_000,
                    maxBuffer: 1024 * 1024,
                },
            );
            const report = JSON.parse(result.stdout.trim());
            assert.equal(report.compiled, "completed");
            assert.equal(report.symbolic, "symbolic");
            assert.equal(report.fixtureCalls, 3);
            assert.equal(report.deadline, "limit_exceeded");
            assert.equal(report.portableAuthor, "completed");
            assert.equal(report.portableFixtures, 2);
            assert.equal(connections, 0);
        } finally {
            await new Promise((resolve, reject) => {
                backend.close((error) => (error ? reject(error) : resolve()));
            });
            await rm(directory, { recursive: true, force: true });
        }
    },
);
