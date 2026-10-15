// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import test from "node:test";

const cliRoot = new URL("../../../packages/cli/", import.meta.url);
const require = createRequire(new URL("package.json", cliRoot));
const ts = require("typescript");
const telemetrySource = ts.transpileModule(
    readFileSync(new URL("src/telemetry.ts", cliRoot), "utf8"),
    { compilerOptions: { module: ts.ModuleKind.ESNext } },
).outputText;

for (const entry of ["run.js", "dev.js"]) {
    for (const scenario of [
        "success",
        "run-error",
        "stop-error",
        "init-error",
        "signal",
    ]) {
        test(`${entry} cleans up its SDK client and telemetry on ${scenario}`, () => {
            const source = readFileSync(
                new URL(`bin/${entry}`, cliRoot),
                "utf8",
            );
            const fixture = `
                const { SourceTextModule } = require("node:vm");
                const modules = new Map();
                function moduleFor(name, source) {
                    const module = new SourceTextModule(source, { identifier: name });
                    modules.set(name, module);
                    return module;
                }
                globalThis.scenario = ${JSON.stringify(scenario)};
                moduleFor("@typeagent/config", "export function loadConfigSync() {}");
                moduleFor("debug", "export default function debug() {}");
                moduleFor("@typeagent/telemetry", \`
                    export const otel = {
                        async initTelemetry() {
                            if (scenario === "init-error") throw Error("init failed");
                        },
                        async shutdownTelemetry() { console.log("telemetry stopped"); }
                    };
                \`);
                moduleFor("@typeagent/aiclient", \`
                    let timer;
                    export async function getChatModelNames() {
                        timer = setInterval(() => {}, 1000);
                        return [];
                    }
                    export async function stopCopilotClient() {
                        clearInterval(timer);
                        console.log("client stopped");
                        if (scenario === "stop-error") throw Error("stop failed");
                    }
                \`);
                const lifecycle = moduleFor("lifecycle", ${JSON.stringify(telemetrySource)});
                const core = moduleFor("@oclif/core", \`
                    import { getChatModelNames } from "@typeagent/aiclient";
                    export const settings = {};
                    export async function run() {
                        await getChatModelNames();
                        if (scenario === "run-error") throw Error("run failed");
                        console.log("Full GPT response: fixture");
                        if (scenario === "signal") {
                            process.emit("SIGTERM");
                            await new Promise(() => {});
                        }
                    }
                    export async function flush() { console.log("output flushed"); }
                    export async function handle(error) {
                        console.error(error.message);
                        process.exitCode = 1;
                    }
                \`);
                const linker = async (name) =>
                    name.endsWith("telemetry.ts") || name.endsWith("telemetry.js")
                        ? lifecycle : modules.get(name);
                (async () => {
                    await lifecycle.link(linker);
                    await lifecycle.evaluate();
                    await core.link(linker);
                    await core.evaluate();
                    const entry = new SourceTextModule(${JSON.stringify(source)}, {
                        importModuleDynamically: async (name) => modules.get(name)
                    });
                    await entry.link(linker);
                    await entry.evaluate();
                })().catch(error => { console.error(error); process.exitCode = 1; });
            `;
            const result = spawnSync(
                process.execPath,
                ["--experimental-vm-modules", "--no-warnings", "-e", fixture],
                { encoding: "utf8", timeout: 5_000 },
            );
            assert.ifError(result.error);
            const expectedCode =
                scenario === "success" || scenario === "signal" ? 0 : 1;
            assert.equal(result.status, expectedCode, result.stderr);
            assert.match(result.stdout, /client stopped/);
            assert.match(result.stdout, /telemetry stopped/);
            assert.equal(result.stdout.match(/client stopped/g).length, 1);
            assert.equal(result.stdout.match(/telemetry stopped/g).length, 1);
            assert.ok(
                result.stdout.indexOf("client stopped") <
                    result.stdout.indexOf("telemetry stopped"),
                result.stdout,
            );
        });
    }
}

test("the development loader includes marked-terminal's existing declaration", () => {
    const result = spawnSync(
        process.execPath,
        [
            "--loader",
            "ts-node/esm",
            "--no-warnings=ExperimentalWarning",
            "bin/dev.js",
            "prompt",
            "--help",
        ],
        {
            cwd: fileURLToPath(cliRoot),
            env: {
                PATH: process.env.PATH,
                SystemRoot: process.env.SystemRoot,
                HOME: process.env.HOME,
                USERPROFILE: process.env.USERPROFILE,
                TYPEAGENT_CONFIG_DIR: fileURLToPath(new URL("test/", cliRoot)),
            },
            encoding: "utf8",
            timeout: 60_000,
        },
    );
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stderr);
    assert.doesNotMatch(result.stderr, /TS7016|findCommand \(connect\)/);
    assert.match(result.stdout, /Send a prompt to GPT/);
});
