#!/usr/bin/env node
// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { spawn, spawnSync } from "node:child_process";
import {
    existsSync,
    statSync,
    mkdirSync,
    mkdtempSync,
    openSync,
    closeSync,
    writeFileSync,
    readFileSync,
} from "node:fs";
import { createServer, createConnection } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { stageCopilotPlugin } from "../../../tools/scripts/stageCopilotPlugin.mjs";

const pluginRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
);
const tsRoot = path.resolve(pluginRoot, "..", "..");
const help = `Usage (from ts): pnpm copilot:discovery [options]
Change to ts first so Corepack can resolve the pinned pnpm version.
  --skip-build                 Reuse existing plugin/server builds
  --install-dependencies       Explicitly run pnpm install --frozen-lockfile
  --install-plugin             Also register the plugin globally (opt-in)
  --config-dir <directory>     Use existing TypeAgent model/embedding configuration
  --port <1-65535>              Isolated server port (default 9024)
  --startup-timeout <seconds>  Readiness timeout (default 120)
  --model <model>              Optional Copilot model
  --same-window                Keep interactive Copilot in this console
  --smoke-test                 Verify MCP catalog and discovery; do not execute actions
  --help                      Show this help

Requires Node 22+, Copilot CLI, and provisioned TypeAgent configuration.
By default uses a fresh session-local plugin snapshot, not the global install.
Interactive Copilot opens in a new console; keep this window open until it exits.
Logs and disposable data are retained in the printed temporary run directory.`;

export const testPrompt =
    "Use the typeagent-e2e tools to discover an action that shows which lists exist. " +
    "Inspect the returned contract, then execute the matching inventory action with concrete parameters. " +
    "Do not use processCommand, shell commands, or create or modify any lists. " +
    "If TypeAgent requires confirmation, show me the full prompt and wait for my answer before continuing. " +
    "Show the final structured result.";

export function makeBuildCommand(root) {
    return {
        command: process.execPath,
        args: [
            path.join(
                root,
                "node_modules",
                "@fluidframework",
                "build-tools",
                "bin",
                "fluid-build",
            ),
            "^(@typeagent/copilot-plugin|agent-server)$",
            "-t",
            "build",
            "--dep",
        ],
    };
}

export function parseArgs(argv) {
    const options = { port: 9024, startupTimeout: 120 };
    const flags = {
        "--skip-build": "skipBuild",
        "--install-dependencies": "installDependencies",
        "--install-plugin": "installPlugin",
        "--smoke-test": "smokeTest",
        "--same-window": "sameWindow",
        "--help": "help",
    };
    const values = {
        "--port": "port",
        "--startup-timeout": "startupTimeout",
        "--config-dir": "configDir",
        "--model": "model",
    };
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (Object.hasOwn(flags, arg)) {
            options[flags[arg]] = true;
        } else if (Object.hasOwn(values, arg)) {
            const value = argv[++i];
            if (!value || value.startsWith("--"))
                throw new Error(`Missing value for ${arg}`);
            options[values[arg]] = value;
        } else {
            throw new Error(`Unknown option: ${arg}`);
        }
    }
    for (const [key, max] of [
        ["port", 65535],
        ["startupTimeout", 1800],
    ]) {
        if (
            !/^\d+$/.test(String(options[key])) ||
            Number(options[key]) < 1 ||
            Number(options[key]) > max
        ) {
            throw new Error(`${key} must be an integer between 1 and ${max}`);
        }
        options[key] = Number(options[key]);
    }
    if (options.configDir) options.configDir = path.resolve(options.configDir);
    return options;
}

export function makeConfiguration(runDir, port, inheritedEnv, configDir) {
    const pluginData = path.join(runDir, "plugin-data");
    const env = {
        ...inheritedEnv,
        TYPEAGENT_MODE: "bypass",
        TYPEAGENT_HOST: "127.0.0.1",
        TYPEAGENT_PORT: String(port),
        TYPEAGENT_USER_DATA_DIR: path.join(runDir, "data"),
        TYPEAGENT_PLUGIN_DATA: pluginData,
        CLAUDE_PLUGIN_DATA: pluginData,
        INSTANCE_NAME: "discovery-e2e",
    };
    delete env.TYPEAGENT_CONVERSATION_ID;
    if (configDir) env.TYPEAGENT_CONFIG_DIR = configDir;
    const mcp = {
        mcpServers: {
            "typeagent-e2e": {
                type: "stdio",
                command: process.execPath,
                args: [path.join(runDir, "plugin", "dist", "mcp", "server.js")],
                env: {
                    TYPEAGENT_MODE: "mcp",
                    TYPEAGENT_HOST: "127.0.0.1",
                    TYPEAGENT_PORT: String(port),
                    TYPEAGENT_PLUGIN_DATA: pluginData,
                    CLAUDE_PLUGIN_DATA: pluginData,
                },
                tools: ["*"],
            },
        },
    };
    return { env, mcp };
}

export function checkPort(port) {
    return new Promise((resolve, reject) => {
        const probe = createServer();
        probe.once("error", (error) =>
            reject(
                new Error(
                    `Port ${port} is unavailable: ${error.message}. Choose --port; no existing server will be stopped.`,
                ),
            ),
        );
        probe.listen({ host: "127.0.0.1", port, exclusive: true }, () =>
            probe.close(resolve),
        );
    });
}

function findExecutable(name) {
    const result = spawnSync(
        process.platform === "win32" ? "where.exe" : "which",
        [name],
        { encoding: "utf8" },
    );
    const paths = (result.stdout ?? "").trim().split(/\r?\n/).filter(Boolean);
    const executable =
        process.platform === "win32"
            ? paths.find((entry) => entry.toLowerCase().endsWith(".exe"))
            : paths[0];
    if (!executable)
        throw new Error(
            `${name} executable not found on PATH${process.platform === "win32" ? " (a native .exe is required)" : ""}.`,
        );
    return executable;
}

function packageManager(name) {
    if (process.platform !== "win32") return { command: name, prefix: [] };
    const result = spawnSync("where.exe", [name], { encoding: "utf8" });
    const paths = (result.stdout ?? "").trim().split(/\r?\n/).filter(Boolean);
    const executable = paths.find((entry) =>
        entry.toLowerCase().endsWith(".exe"),
    );
    if (executable) return { command: executable, prefix: [] };
    for (const entry of paths) {
        for (const relative of [
            "node_modules/pnpm/bin/pnpm.cjs",
            "node_modules/corepack/dist/pnpm.js",
        ]) {
            const cli = path.resolve(path.dirname(entry), relative);
            if (existsSync(cli))
                return { command: process.execPath, prefix: [cli] };
        }
    }
    throw new Error(
        "pnpm executable or npm/Corepack-installed pnpm entry point not found on PATH.",
    );
}

export function startProcess(command, args, options) {
    const child = spawn(command, args, { shell: false, ...options });
    const completion = new Promise((resolve) => {
        child.once("error", (error) => resolve({ error }));
        child.once("exit", (code, signal) => resolve({ code, signal }));
    });
    return { child, completion };
}

function requireSuccess(result, label) {
    if (result.error) throw new Error(`${label}: ${result.error.message}`);
    if (result.code !== 0)
        throw new Error(`${label} exited with ${result.code ?? result.signal}`);
}

export async function stopProcess(processInfo) {
    if (
        !processInfo?.child.pid ||
        processInfo.child.exitCode !== null ||
        processInfo.child.signalCode !== null
    )
        return;
    if (process.platform === "win32") {
        const result = await startProcess(
            "taskkill.exe",
            ["/PID", String(processInfo.child.pid), "/T", "/F"],
            { stdio: "ignore" },
        ).completion;
        if (
            processInfo.child.exitCode === null &&
            processInfo.child.signalCode === null
        )
            requireSuccess(result, "Stopping owned process tree");
    } else {
        processInfo.child.kill("SIGTERM");
    }
    const stopped = await Promise.race([
        processInfo.completion.then(() => true),
        delay(5000, undefined, { ref: false }).then(() => false),
    ]);
    if (!stopped)
        throw new Error(
            `Owned process ${processInfo.child.pid} did not exit; inspect its log.`,
        );
}

export async function runCommand(
    command,
    args,
    env,
    signal,
    processOptions = {},
) {
    signal.throwIfAborted();
    const running = startProcess(command, args, {
        cwd: tsRoot,
        env,
        stdio: "inherit",
        ...processOptions,
    });
    running.child.stdout?.pipe(process.stdout);
    running.child.stderr?.pipe(process.stderr);
    const abort = () => {
        void stopProcess(running).catch((error) =>
            console.error(error.message),
        );
    };
    signal.addEventListener("abort", abort, { once: true });
    try {
        const result = await running.completion;
        signal.throwIfAborted();
        requireSuccess(result, command);
    } finally {
        signal.removeEventListener("abort", abort);
        await stopProcess(running);
    }
}

export async function runInNewWindow(command, args, env, signal, runDir) {
    signal.throwIfAborted();
    // A Node bridge forwards argv without Start-Process's lossy array joining.
    const bridge = path.join(runDir, "console-command.mjs");
    const statusPath = path.join(runDir, "console-status.json");
    writeFileSync(statusPath, JSON.stringify({ phase: "pending" }));
    writeFileSync(
        bridge,
        `import { spawn } from "node:child_process";
import { writeFileSync, renameSync } from "node:fs";
const { command, args, cwd } = ${JSON.stringify({ command, args, cwd: tsRoot })};
const statusPath = ${JSON.stringify(statusPath)};
const status = { phase: "starting", bridgePid: process.pid, tty: [process.stdin.isTTY, process.stdout.isTTY, process.stderr.isTTY].map(Boolean) };
const save = (update) => {
    writeFileSync(statusPath + ".tmp", JSON.stringify(Object.assign(status, update)));
    renameSync(statusPath + ".tmp", statusPath);
};
save({});
if (!status.tty.every(Boolean)) {
    save({ phase: "failed", error: "New console has no interactive input/output handles" });
    console.error(status.error);
    process.exitCode = 1;
} else {
const child = spawn(command, args, { cwd, env: process.env, stdio: "inherit", shell: false });
child.once("spawn", () => save({ phase: "running", childPid: child.pid }));
child.once("error", (error) => { save({ phase: "failed", error: error.message }); console.error(error.message); process.exitCode = 1; });
child.once("exit", (code, signal) => { save({ phase: "exited", code, signal }); process.exitCode = code ?? 1; });
}
`,
    );
    const literal = (value) => "'" + value.replaceAll("'", "''") + "'";
    // Only one quoted file path crosses Start-Process's command-line boundary.
    const script = `$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
try {
    Add-Type -TypeDefinition 'using System.Runtime.InteropServices; public static class DiscoveryConsole { [DllImport("kernel32.dll")] public static extern bool FreeConsole(); }'
    [DiscoveryConsole]::FreeConsole() | Out-Null
    $child = Start-Process -FilePath ${literal(process.execPath)} -ArgumentList ${literal(`"${bridge}"`)} -WorkingDirectory ${literal(tsRoot)} -PassThru -Wait
    $child.Refresh()
    exit $child.ExitCode
} catch {
    [Console]::Error.WriteLine($_.Exception.Message)
    exit 1
}`;
    try {
        await runCommand(
            path.join(
                process.env.SystemRoot ?? "C:\\Windows",
                "System32",
                "WindowsPowerShell",
                "v1.0",
                "powershell.exe",
            ),
            [
                "-NoLogo",
                "-NoProfile",
                "-NonInteractive",
                "-OutputFormat",
                "Text",
                "-EncodedCommand",
                Buffer.from(script, "utf16le").toString("base64"),
            ],
            env,
            signal,
            // The wrapper leaves the parent's console group before launching.
            // Pipes preserve its diagnostics after FreeConsole.
            { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] },
        );
    } catch (error) {
        signal.throwIfAborted();
        const status = JSON.parse(readFileSync(statusPath, "utf8"));
        throw new Error(
            `New console: ${status.error ?? error.message}. Launch status: ${statusPath}`,
            { cause: error },
        );
    }
    const status = JSON.parse(readFileSync(statusPath, "utf8"));
    if (status.phase !== "exited" || status.code !== 0)
        throw new Error(
            `New console ended without a successful child exit (phase: ${status.phase}). Launch status: ${statusPath}`,
        );
}

export function startupFailure(result, stderrPath) {
    const reason = result.error?.message ?? result.code ?? result.signal;
    const log =
        stderrPath && existsSync(stderrPath)
            ? readFileSync(stderrPath, "utf8")
            : "";
    // Only surface the setting name, not log lines that may contain credentials.
    const missing = /Missing ApiSetting: ([A-Z][A-Z0-9_]*)\b/.exec(log)?.[1];
    const details = missing
        ? `\nMissing model configuration: ${missing}. Run with --config-dir pointing to an existing TypeAgent configuration directory containing config.local.yaml (or provision this worktree's ts\\config.local.yaml). No credentials were fetched or copied.`
        : "";
    return new Error(
        `Agent server exited before readiness: ${reason}${details}${stderrPath ? `\nServer error log: ${stderrPath}` : ""}`,
    );
}

export async function waitForServer(server, port, timeout, signal, stderrPath) {
    const deadline = Date.now() + timeout * 1000;
    while (Date.now() < deadline) {
        signal.throwIfAborted();
        const exited = await Promise.race([
            server.completion,
            Promise.resolve(undefined),
        ]);
        if (exited) throw startupFailure(exited, stderrPath);
        const open = await new Promise((resolve) => {
            const socket = createConnection({ host: "127.0.0.1", port });
            const finish = (value) => {
                socket.destroy();
                resolve(value);
            };
            socket.once("connect", () => finish(true));
            socket.once("error", () => finish(false));
            socket.setTimeout(500, () => finish(false));
        });
        if (open) return;
        await delay(250, undefined, { signal });
    }
    throw new Error(`Agent server readiness timed out after ${timeout}s.`);
}

async function probeMcp(config, env, smokeTest, signal) {
    const { Client } = await import(
        "@modelcontextprotocol/sdk/client/index.js"
    );
    const { StdioClientTransport } = await import(
        "@modelcontextprotocol/sdk/client/stdio.js"
    );
    const transport = new StdioClientTransport({
        command: config.command,
        args: config.args,
        env: { ...env, ...config.env },
        stderr: "inherit",
    });
    const client = new Client({
        name: "typeagent-discovery-e2e",
        version: "1.0.0",
    });
    try {
        await client.connect(transport, { signal, timeout: 30000 });
        const catalog = await client.listTools({}, { signal, timeout: 30000 });
        const names = catalog.tools.map((tool) => tool.name);
        for (const name of [
            "searchActions",
            "executeAction",
            "continueAction",
            "cancelAction",
        ]) {
            if (!names.includes(`typeagent-${name}`))
                throw new Error(`Missing structured tool: ${name}`);
        }
        const status = await client.callTool(
            {
                name: "typeagent-getStatus",
                arguments: {},
            },
            undefined,
            { signal, timeout: 60000 },
        );
        if (status.isError)
            throw new Error(
                `MCP readiness probe failed: ${JSON.stringify(status.content)}`,
            );
        // getStatus historically reports errors as text; require its JSON response.
        const text = status.content
            .filter((item) => item.type === "text")
            .map((item) => item.text)
            .join("\n");
        try {
            if (JSON.parse(text) === null) throw new Error("Empty status");
        } catch {
            throw new Error(`Server did not return a valid status: ${text}`);
        }
        if (smokeTest) {
            const result = await client.callTool(
                {
                    name: "typeagent-searchActions",
                    arguments: { query: "listLists" },
                },
                undefined,
                { signal, timeout: 60000 },
            );
            if (result.isError)
                throw new Error(
                    `MCP discovery failed: ${JSON.stringify(result.content)}`,
                );
            const data = result.structuredContent;
            if (
                !data?.actions?.some(
                    (action) =>
                        action.schemaName === "list" &&
                        action.actionName === "listLists",
                )
            ) {
                throw new Error(
                    "Discovery did not return list.listLists. Check model/embedding configuration and server logs.",
                );
            }
            return { tools: names, discovery: data };
        }
        return { tools: names };
    } finally {
        await client.close();
    }
}

export async function main(argv = process.argv.slice(2)) {
    const options = parseArgs(argv);
    if (options.help) {
        process.stdout.write(`${help}\n`);
        return;
    }
    if (process.platform !== "win32")
        throw new Error(
            "This E2E launcher currently supports Windows only (owned supervisor/worker tree cleanup).",
        );
    if (Number(process.versions.node.split(".")[0]) < 22)
        throw new Error("Node 22 or later is required.");
    if (
        options.configDir &&
        (!existsSync(options.configDir) ||
            !statSync(options.configDir).isDirectory())
    )
        throw new Error(
            `Configuration directory does not exist: ${options.configDir}`,
        );
    if (!options.skipBuild || options.installDependencies) {
        if (!existsSync(path.join(tsRoot, ".npmrc")))
            throw new Error(
                "Provision ts\\.npmrc for the package feed first. This launcher does not copy credentials or run getKeys.",
            );
    }
    const copilot =
        options.smokeTest && !options.installPlugin
            ? undefined
            : findExecutable("copilot");
    await checkPort(options.port);
    const runDir = mkdtempSync(path.join(tmpdir(), "typeagent-discovery-e2e-"));
    const { env, mcp } = makeConfiguration(
        runDir,
        options.port,
        process.env,
        options.configDir,
    );
    mkdirSync(env.TYPEAGENT_PLUGIN_DATA);
    const controller = new AbortController();
    const abort = () => controller.abort(new Error("E2E session interrupted"));
    process.once("SIGINT", abort);
    process.once("SIGTERM", abort);
    let server;
    process.stdout.write(`E2E logs and disposable data: ${runDir}\n`);
    try {
        if (options.installDependencies) {
            const pm = packageManager("pnpm");
            await runCommand(
                pm.command,
                [...pm.prefix, "install", "--frozen-lockfile"],
                process.env,
                controller.signal,
            );
        }
        if (!options.skipBuild) {
            // The root build script includes ".", which selects unrelated packages.
            // --dep includes dependency tasks, not just their graph nodes.
            const build = makeBuildCommand(tsRoot);
            if (!existsSync(build.args[0]))
                throw new Error(
                    "Build dependencies are missing. Retry with --install-dependencies.",
                );
            await runCommand(
                build.command,
                build.args,
                process.env,
                controller.signal,
            );
        }
        controller.signal.throwIfAborted();
        const entry = path.join(
            tsRoot,
            "packages",
            "agentServer",
            "server",
            "dist",
            "server.js",
        );
        if (!existsSync(entry))
            throw new Error(
                "Agent server is not built. Retry without --skip-build.",
            );
        stageCopilotPlugin(path.join(runDir, "plugin"));
        if (options.installPlugin) {
            await runCommand(
                process.execPath,
                [path.join(pluginRoot, "scripts", "install-plugin.mjs")],
                process.env,
                controller.signal,
            );
        }
        const configPath = path.join(runDir, "mcp.json");
        writeFileSync(configPath, JSON.stringify(mcp, null, 2) + "\n");
        writeFileSync(
            path.join(runDir, "prompt.txt"),
            testPrompt +
                "\n\nThen ask: Repeat the same action with the known contract and scope, without rediscovery. Ask again if confirmation is required.\n",
        );
        await checkPort(options.port);
        const stdout = openSync(path.join(runDir, "server.stdout.log"), "a");
        const stderr = openSync(path.join(runDir, "server.stderr.log"), "a");
        try {
            server = startProcess(
                process.execPath,
                [
                    entry,
                    "--port",
                    String(options.port),
                    "--config",
                    "test",
                    "--idle-timeout",
                    "1800",
                ],
                { cwd: tsRoot, env, stdio: ["ignore", stdout, stderr] },
            );
        } finally {
            closeSync(stdout);
            closeSync(stderr);
        }
        await waitForServer(
            server,
            options.port,
            options.startupTimeout,
            controller.signal,
            path.join(runDir, "server.stderr.log"),
        );
        const evidence = await probeMcp(
            mcp.mcpServers["typeagent-e2e"],
            env,
            options.smokeTest,
            controller.signal,
        );
        writeFileSync(
            path.join(runDir, "probe.json"),
            JSON.stringify(evidence, null, 2) + "\n",
        );
        if (options.smokeTest) {
            process.stdout.write(
                "PASS: real MCP catalog and list.listLists discovery. No action was executed.\n",
            );
        } else {
            process.stdout.write(
                `Ready. Paste the following into Copilot (also saved in prompt.txt):\n\n${testPrompt}\n\n${
                    !options.sameWindow
                        ? "Opening Copilot in a new window. Keep this window open; it owns the server. Ctrl+C here stops both.\n"
                        : ""
                }`,
            );
            const launch = options.sameWindow
                ? runCommand
                : (command, args, env, signal) =>
                      runInNewWindow(command, args, env, signal, runDir);
            await launch(
                copilot,
                [
                    "--plugin-dir",
                    path.join(runDir, "plugin"),
                    "--disable-builtin-mcps",
                    ...[
                        "typeagent",
                        "typeagent-workspace",
                        "typeagent-macros",
                    ].flatMap((name) => ["--disable-mcp-server", name]),
                    "--additional-mcp-config",
                    `@${configPath}`,
                    "--no-custom-instructions",
                    "--no-remote-export",
                    "--log-dir",
                    path.join(runDir, "copilot-logs"),
                    ...(options.model ? ["--model", options.model] : []),
                ],
                env,
                controller.signal,
            );
        }
    } catch (error) {
        throw new Error(
            `${error.message}\nLogs and configuration retained at ${runDir}`,
            { cause: error },
        );
    } finally {
        try {
            await stopProcess(server);
        } finally {
            process.removeListener("SIGINT", abort);
            process.removeListener("SIGTERM", abort);
        }
        if (server)
            process.stdout.write(
                `Owned server stopped. Evidence retained at ${runDir}\n`,
            );
    }
}

if (path.resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
    main().catch((error) => {
        console.error(error.message);
        process.exitCode = 1;
    });
}
