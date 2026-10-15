// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { createHash, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { test } from "node:test";
import tseslint from "typescript-eslint";
import {
    assertNativeWorkiqServiceModules,
    validateWorkiqNativeRuntimeConfig,
} from "../native-workiq-lifecycle.mjs";

const directory = path.dirname(fileURLToPath(import.meta.url));
const sourceFile = path.join(directory, "..", "native-workiq-lifecycle.mjs");
const observer = path.join(
    directory,
    "..",
    "native-workiq-service-module-observer.mjs",
);
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const roles = [
    "recordedReadEvidence",
    "resultEvidence",
    "macroManager",
    "macroLearning",
    "macroLearningRuntime",
];

function sourceFunction(name, context) {
    const source = fs.readFileSync(sourceFile, "utf8");
    const ast = tseslint.parser.parseForESLint(source, {
        range: true,
        sourceType: "module",
    }).ast;
    const find = (node) => {
        if (!node || typeof node !== "object") return undefined;
        if (node.type === "FunctionDeclaration" && node.id.name === name)
            return node;
        for (const value of Object.values(node)) {
            if (Array.isArray(value)) {
                for (const child of value) {
                    const found = find(child);
                    if (found) return found;
                }
            } else if (value && typeof value === "object") {
                const found = find(value);
                if (found) return found;
            }
        }
    };
    const found = find(ast);
    assert.ok(found);
    return vm.runInNewContext(`(${source.slice(...found.range)})`, context);
}

async function fixture(
    t,
    {
        missing = false,
        tampered = false,
        query = false,
        duplicate = false,
        planTampered = false,
    } = {},
) {
    const root = path.join(directory, `.service-load-fixture-${randomUUID()}`);
    fs.mkdirSync(root);
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    fs.writeFileSync(
        path.join(root, "package.json"),
        JSON.stringify({ type: "module" }),
    );
    const modules = roles.map((role) => {
        const realPath = path.join(root, role + ".js");
        fs.writeFileSync(
            realPath,
            `export const ${role} = ${JSON.stringify(role)};\n`,
        );
        const bytes = fs.readFileSync(realPath);
        return {
            role,
            realPath,
            sha256: digest(bytes),
            sizeBytes: bytes.length,
        };
    });
    const entry = path.join(root, "entry.mjs");
    const imports = modules
        .slice(0, missing ? 4 : 5)
        .map(
            (module, index) =>
                `import ${JSON.stringify(pathToFileURL(module.realPath).href + (query && index === 0 ? "?foreign" : ""))};`,
        );
    if (duplicate)
        imports.push(
            `import ${JSON.stringify(pathToFileURL(modules[0].realPath).href + "?duplicate")};`,
        );
    fs.writeFileSync(entry, imports.join("\n") + "\n");
    const plan = {
        owner: "test-owned",
        ownedRoot: root,
        manifestDigest: "a".repeat(64),
        nonce: randomUUID(),
        createdAtMs: Date.now(),
        createdMonotonicNs: process.hrtime.bigint().toString(),
        nodeExecutable: process.execPath,
        serviceEntry: entry,
        serviceEntrySha256: digest(fs.readFileSync(entry)),
        serviceEntrySizeBytes: fs.statSync(entry).size,
        observer: {
            file: fs.realpathSync(observer),
            sha256: digest(fs.readFileSync(observer)),
        },
        modules,
    };
    const planFile = path.join(root, "plan.json");
    fs.writeFileSync(planFile, JSON.stringify(plan));
    plan.planDigest = digest(fs.readFileSync(planFile));
    if (tampered)
        fs.appendFileSync(
            modules[0].realPath,
            "// changed after qualification\n",
        );
    if (planTampered) fs.appendFileSync(planFile, " ");
    const child = spawn(
        process.execPath,
        ["--import", pathToFileURL(observer).href, entry],
        {
            cwd: root,
            env: {
                ...process.env,
                NODE_OPTIONS: "",
                TYPEAGENT_NATIVE_SERVICE_MODULE_PLAN: planFile,
                TYPEAGENT_NATIVE_SERVICE_MODULE_PLAN_SHA256: plan.planDigest,
            },
            windowsHide: true,
            stdio: ["ignore", "pipe", "pipe", "ipc"],
        },
    );
    t.after(() => child.kill());
    const messages = [];
    let stderr = "",
        stdout = "";
    child.on("message", (message) =>
        messages.push({
            message,
            receivedAtMs: Date.now(),
            receivedMonotonicNs: process.hrtime.bigint().toString(),
        }),
    );
    child.stderr.on("data", (bytes) => (stderr += bytes.toString()));
    child.stdout.on("data", (bytes) => (stdout += bytes.toString()));
    const result = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            child.kill();
            reject(new Error("Owned module fixture deadline"));
        }, 10000);
        child.once("error", (error) => {
            clearTimeout(timer);
            reject(error);
        });
        child.once("close", (code) => {
            clearTimeout(timer);
            resolve({ code });
        });
    });
    return { ...result, plan, messages, stderr, stdout, pid: child.pid };
}

test("actual scoped child hook reports exact five loaded module byte digests and normal entry, without source bodies", async (t) => {
    const f = await fixture(t);
    assert.equal(f.code, 0, f.stderr);
    assert.equal(f.stdout, "");
    assert.equal(f.messages.length, 6);
    assert.deepEqual(
        f.messages.map(({ message }) => message.role).sort(),
        [...roles, "normal-service-entry"].sort(),
    );
    const validate = sourceFunction("validateNativeServiceModuleLoad", {
        pathToFileURL,
        process,
        requireNative: (condition, message) => assert.ok(condition, message),
    });
    const actor = {
        ProcessId: f.pid,
        ParentProcessId: process.pid,
        StartedMs: f.plan.createdAtMs,
        ExecutablePath: process.execPath,
    };
    for (const { message, receivedMonotonicNs } of f.messages) {
        assert.equal(
            validate(f.plan, actor, message, receivedMonotonicNs),
            message,
        );
        assert.equal(
            message.boundary,
            "normal-node-load-source-not-module-evaluation",
        );
        assert.equal(JSON.stringify(message).includes("export const"), false);
        assert.throws(
            () => assertNativeWorkiqServiceModules(message),
            /actual owned load callback/u,
        );
        assert.throws(() =>
            assertNativeWorkiqServiceModules(
                JSON.parse(JSON.stringify(message)),
            ),
        );
    }
});

test("source load observer does not manufacture missing modules or accept changed bytes/plan, URL aliases or duplicate queried loads", async (t) => {
    const missing = await fixture(t, { missing: true });
    assert.equal(missing.code, 0, missing.stderr);
    assert.equal(missing.messages.length, 5);
    assert.equal(
        missing.messages.some(({ message }) => message.role === roles[4]),
        false,
    );
    for (const options of [
        { tampered: true },
        { query: true },
        { duplicate: true },
        { planTampered: true },
    ]) {
        const f = await fixture(t, options);
        assert.notEqual(f.code, 0);
        assert.match(
            f.stderr,
            /observer has no owned launch binding|load path\/format\/source changed|load bytes differ/u,
        );
        assert.equal(f.stdout, "");
    }
});

test("module metadata validation rejects forged scope, chronology, identity, hashes, paths and extra authority without branding DTOs", async (t) => {
    const f = await fixture(t);
    const { message, receivedMonotonicNs } = f.messages.find(
        ({ message }) => message.role === roles[0],
    );
    const actor = {
        ProcessId: f.pid,
        ParentProcessId: process.pid,
        StartedMs: f.plan.createdAtMs,
        ExecutablePath: process.execPath,
    };
    const validate = sourceFunction("validateNativeServiceModuleLoad", {
        pathToFileURL,
        process,
        requireNative: (condition, message) => assert.ok(condition, message),
    });
    for (const change of [
        { owner: "foreign" },
        { ownedRoot: "foreign" },
        { manifestDigest: "f".repeat(64) },
        { planDigest: "f".repeat(64) },
        { observerDigest: "f".repeat(64) },
        { nonce: "foreign" },
        { pid: f.pid + 1 },
        { parentPid: 0 },
        { executable: "foreign" },
        { serviceEntry: "foreign" },
        { role: "foreign" },
        { realPath: "foreign" },
        { url: message.url + "?forged" },
        { sha256: "f".repeat(64) },
        { sizeBytes: message.sizeBytes + 1 },
        { format: "commonjs" },
        {
            observedMonotonicNs: (
                BigInt(f.plan.createdMonotonicNs) - 1n
            ).toString(),
        },
        { observedMonotonicNs: (BigInt(receivedMonotonicNs) + 1n).toString() },
        { observedMonotonicNs: "NaN" },
        { boundary: "evaluated" },
        { approved: true },
        { kind: "native-workiq-service-entry-load-v1" },
    ]) {
        assert.throws(
            () =>
                validate(
                    f.plan,
                    actor,
                    { ...message, ...change },
                    receivedMonotonicNs,
                ),
            /foreign\/stale\/path\/byte\/manifest/u,
        );
    }
    for (const key of Object.keys(message)) {
        const copy = { ...message };
        delete copy[key];
        assert.throws(() => validate(f.plan, actor, copy, receivedMonotonicNs));
    }
    assert.throws(() =>
        validate(
            f.plan,
            { ...actor, ProcessId: actor.ProcessId + 1 },
            message,
            receivedMonotonicNs,
        ),
    );
    assert.throws(() =>
        assertNativeWorkiqServiceModules({
            owner: f.plan.owner,
            modules: f.messages,
        }),
    );
});

test("preprompt private runtime proof rejects missing/ambiguous coverage, reused actor, tampered parents and never trusts serialized snapshots", () => {
    const source = fs.readFileSync(sourceFile, "utf8");
    assert.match(
        source,
        /child\.on\("message", state\.serviceModuleHandler\)/u,
    );
    assert.match(
        source,
        /state\.serviceDeclaredArgs\.map\(\(argument\) => \[argument\]\)/u,
    );
    assert.match(source, /nativeServiceModuleSnapshots\.add\(proof\)/u);
    assert.match(
        source,
        /proveCurrentServiceModules\(state\.lease\.sessionId\)/u,
    );
    assert.match(source, /Math\.min\(5000, budget\.remaining\(\)\)/u);
    const config = {
        cliExecutable: path.resolve("copilot.exe"),
        configDirectory: path.resolve("config"),
        helperDirectory: path.resolve("helpers"),
        port: 20577,
        maxTargetModelTurns: 20,
        maxDurationMs: 300000,
        extensionMode: "load_only",
        exposureOverride: "user-authorized-unverified-model-exposure",
        rootModel: "test",
        cliVersion: "1.0.95",
        budgetAuthorization: {
            futureCompiledLineage: { path: "planned", sha256: "a".repeat(64) },
        },
    };
    assert.throws(
        () => validateWorkiqNativeRuntimeConfig(config),
        /source-owned service module witness/u,
    );
    assert.throws(() =>
        assertNativeWorkiqServiceModules({ serializedNativeAuthority: true }),
    );
});

test("actual child observations exercise the real collector completeness/OS/source checks in an explicitly TEST-only VM, never minting public native authority", async (t) => {
    const f = await fixture(t);
    const actor = {
        ProcessId: f.pid,
        ParentProcessId: process.pid,
        StartedMs: f.plan.createdAtMs,
        ExecutablePath: process.execPath,
    };
    const declaredArgs = [
        process.execPath,
        "--import",
        pathToFileURL(observer).href,
        f.plan.serviceEntry,
    ];
    actor.CommandLine = declaredArgs.map((arg) => `"${arg}"`).join(" ");
    f.plan.planFile = path.join(f.plan.ownedRoot, "plan.json");
    const state = {
        serviceModulePlan: f.plan,
        service: { child: { pid: f.pid } },
        serviceIdentity: actor,
        serviceDeclaredArgs: declaredArgs,
        serviceModuleMessages: f.messages,
        serviceModuleProofIndex: 0,
    };
    const testOnlyBrands = new WeakSet(),
        writes = [];
    const context = {
        state,
        fs,
        path,
        process,
        hash: digest,
        budget: { remaining: () => 10000 },
        layout: { owner: f.plan.owner, run: f.plan.ownedRoot },
        execFileSync: () => JSON.stringify(actor),
        requireNative: (condition, message) => assert.ok(condition, message),
        identityMatches: (left, right) =>
            left?.ProcessId === right.ProcessId &&
            left.StartedMs === right.StartedMs &&
            left.ExecutablePath === right.ExecutablePath,
        matchesNativeCommandLine: sourceFunction(
            "matchesNativeCommandLine",
            {},
        ),
        validateNativeServiceModuleLoad: sourceFunction(
            "validateNativeServiceModuleLoad",
            {
                pathToFileURL,
                process,
                requireNative: (condition, message) =>
                    assert.ok(condition, message),
            },
        ),
        nativeServiceModuleSnapshots: testOnlyBrands,
        assertNativeWorkiqServiceModules: (proof) => {
            assert.equal(testOnlyBrands.has(proof), true);
            return proof;
        },
        write: (_file, value) => writes.push(value),
    };
    const prove = sourceFunction("proveCurrentServiceModules", context);
    const testProof = prove("actual-test-sid");
    assert.equal(testProof.modules.length, 5);
    assert.equal(testProof.entryLoad.role, "normal-service-entry");
    assert.equal(testProof.sessionId, "actual-test-sid");
    assert.equal(Object.isFrozen(testProof), true);
    assert.equal(Object.isFrozen(testProof.modules), true);
    assert.equal(writes[0].serializedNativeAuthority, false);
    assert.throws(() => assertNativeWorkiqServiceModules(testProof));
    assert.throws(() =>
        assertNativeWorkiqServiceModules(JSON.parse(JSON.stringify(testProof))),
    );
    state.serviceModuleMessages = f.messages.slice(1);
    assert.throws(() => prove("sid"), /coverage is missing\/ambiguous/u);
    state.serviceModuleMessages = [...f.messages, f.messages[0]];
    assert.throws(() => prove("sid"), /coverage is missing\/ambiguous/u);
    state.serviceModuleMessages = f.messages;
    context.execFileSync = () =>
        JSON.stringify({ ...actor, StartedMs: actor.StartedMs + 1 });
    assert.throws(() => prove("sid"), /OS\/source\/argv lifetime changed/u);
    context.execFileSync = () =>
        JSON.stringify({
            ...actor,
            CommandLine: actor.CommandLine + " --foreign",
        });
    assert.throws(() => prove("sid"), /OS\/source\/argv lifetime changed/u);
    context.execFileSync = () => {
        throw new Error("OS identity unreadable");
    };
    assert.throws(() => prove("sid"), /OS identity unreadable/u);
    context.execFileSync = () => JSON.stringify(actor);
    state.serviceModuleFailure = new Error(
        "Foreign native service module callback",
    );
    assert.throws(() => prove("sid"), /Foreign native/u);
    state.serviceModuleFailure = undefined;
    fs.appendFileSync(f.plan.modules[0].realPath, "// post-load tamper\n");
    assert.throws(
        () => prove("sid"),
        /coverage is missing\/ambiguous or bytes changed/u,
    );
});
