// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createWebSocketChannelServer } from "websocket-channel-server";
import {
    createConversationManager,
    ConversationManager,
} from "./conversationManager.js";
import { createAgentServerConnectionHandler } from "./connectionHandler.js";
import { startStaleBuildWatcher, isStaleBuild } from "./staleBuild.js";
import {
    getInstanceDirAsync,
    getTraceIdAsync,
} from "agent-dispatcher/helpers/data";
import {
    getDefaultAppAgentProviders,
    getDefaultAppAgentSource,
    getIndexingServiceRegistry,
    getDefaultConstructionProvider,
} from "default-agent-provider";
import { getFsStorageProvider } from "dispatcher-node-providers";
import {
    AGENT_SERVER_DEFAULT_PORT,
    AGENT_SERVER_DISCOVERY_NAME,
    UserIdentity,
} from "@typeagent/agent-server-protocol";
import { PortRegistrar, SYSTEM_SESSION_CONTEXT_ID } from "agent-dispatcher";
import { loadConfig } from "@typeagent/config";
import {
    writeServerPid,
    removeServerPid,
} from "@typeagent/agent-server-client";
import registerDebug from "debug";
import os from "node:os";
import { spawn } from "node:child_process";
import { DefaultAzureCredential } from "@azure/identity";

// Load config from YAML layers + Key Vault (replacing legacy dotenv).
// vault.shared is auto-discovered from config.local.yaml / config.defaults.yaml.
await loadConfig({ keyVault: {}, strict: false });

const debugStartup = registerDebug("agent-server:startup");

// User identity resolution. Precedence:
//   1. TYPEAGENT_USER_NAME env var (dev override / CI)
//   2. Claims from the Azure AD token DefaultAzureCredential acquires for
//      the Cognitive Services scope — this is the same credential the
//      agent-server uses to talk to Azure OpenAI, so if the server can talk
//      to the model at all, the token's `name`/`upn` claims give us the
//      real user. Works without any extra setup (no git config, no Office
//      SSO).
//   3. OS username as a last resort.
//
// The Azure step is async and involves a network call, so we resolve it
// after startup and overwrite the cached identity when it arrives. The
// first few RPC calls may see the OS-username fallback; subsequent calls
// see the real display name.
function parseJwtClaims(token: string): Record<string, unknown> | undefined {
    const [, payload] = token.split(".");
    if (!payload) return undefined;
    const b64 = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
    try {
        return JSON.parse(Buffer.from(padded, "base64").toString("utf-8"));
    } catch {
        return undefined;
    }
}

function identityFromClaims(
    claims: Record<string, unknown>,
    fallbackUsername: string,
): UserIdentity | undefined {
    // Azure AD `name` is typically "First Last" or "Last, First". Prefer
    // just the first name so the chat header stays compact. Split on
    // whitespace or comma and take the first non-empty part.
    const fullName =
        typeof claims.name === "string" && claims.name.trim()
            ? claims.name.trim()
            : undefined;
    if (!fullName) return undefined;
    // "Last, First" → prefer "First" after the comma; otherwise first token.
    const firstName = fullName.includes(",")
        ? (fullName.split(",")[1]?.trim().split(/\s+/)[0] ?? fullName)
        : (fullName.split(/\s+/)[0] ?? fullName);
    const upn =
        (typeof claims.upn === "string" && claims.upn) ||
        (typeof claims.preferred_username === "string" &&
            claims.preferred_username) ||
        (typeof claims.unique_name === "string" && claims.unique_name) ||
        undefined;
    const initial = (firstName[0] ?? "U").toUpperCase();
    return {
        username: upn || fallbackUsername,
        displayName: firstName,
        initial,
    };
}

async function resolveIdentityFromAzureToken(
    fallbackUsername: string,
): Promise<UserIdentity | undefined> {
    try {
        const token = await new DefaultAzureCredential().getToken(
            "https://cognitiveservices.azure.com/.default",
        );
        if (!token?.token) return undefined;
        const claims = parseJwtClaims(token.token);
        if (!claims) return undefined;
        return identityFromClaims(claims, fallbackUsername);
    } catch {
        return undefined;
    }
}

function initialIdentity(): UserIdentity {
    const username = os.userInfo().username || "user";
    const envName = process.env.TYPEAGENT_USER_NAME?.trim();
    const displayName = envName || username;
    const initial = (displayName[0] ?? "U").toUpperCase();
    return { username, displayName, initial };
}

let userIdentity: UserIdentity = initialIdentity();

// Kick off the token-based resolution asynchronously. Env override wins
// if set, so skip the network call in that case.
if (!process.env.TYPEAGENT_USER_NAME?.trim()) {
    const fallbackUsername = userIdentity.username;
    resolveIdentityFromAzureToken(fallbackUsername)
        .then((resolved) => {
            if (resolved) {
                userIdentity = resolved;
                debugStartup(
                    `resolved user identity from Azure token: ${resolved.displayName}`,
                );
            }
        })
        .catch(() => {});
}

async function main() {
    debugStartup(`pid=${process.pid} resolving instance dir + traceId`);
    const [instanceDir, traceId] = await Promise.all([
        getInstanceDirAsync(),
        getTraceIdAsync(),
    ]);
    debugStartup(`instanceDir=${instanceDir}`);

    // did the launch request a specific config? (e.g. "test" to load "config.test.json")
    const configIdx = process.argv.indexOf("--config");
    const configName =
        configIdx !== -1 ? process.argv[configIdx + 1] : undefined;

    // `--dev` (or TYPEAGENT_DEV=1) starts every conversation with developer
    // mode enabled — captures translation debug data and shows dev-only UI
    // affordances (per-message delete) without needing `@config dev on`.
    const developerMode =
        process.argv.includes("--dev") ||
        process.env.TYPEAGENT_DEV === "1" ||
        process.env.TYPEAGENT_DEV === "true";
    if (developerMode) {
        debugStartup("developer mode enabled at startup (--dev)");
    }

    debugStartup("creating conversation manager (will lockInstanceDir)");
    // Single PortRegistrar shared across every conversation in this
    // process. Lets external clients (browser extension, VS Code, CLI)
    // discover any agent's port via the discovery channel regardless of
    // which conversation that agent is loaded into. Standalone hosts
    // (shell, CLI dispatcher) skip this and let each dispatcher mint
    // its own — see DispatcherOptions.portRegistrar in agent-dispatcher.
    const portRegistrar = new PortRegistrar();

    const conversationManager: ConversationManager =
        await createConversationManager(
            "agent server",
            {
                appAgentProviders: getDefaultAppAgentProviders(
                    instanceDir,
                    configName,
                ),
                appAgentSources: [
                    getDefaultAppAgentSource(instanceDir, { configName }),
                ],
                persistSession: true,
                storageProvider: getFsStorageProvider(),
                metrics: true,
                dblogging: true,
                developerMode,
                traceId,
                indexingServiceRegistry: await getIndexingServiceRegistry(
                    instanceDir,
                    configName,
                ),
                constructionProvider: getDefaultConstructionProvider(),
                conversationMemorySettings: {
                    requestKnowledgeExtraction: false,
                    actionResultKnowledgeExtraction: false,
                },
                collectCommandResult: true,
                portRegistrar,
                // Grant the browser agent permission to read other agents'
                // local-view ports so inline-browser embedding works in
                // connect mode, matching the standalone (in-process) shell.
                allowSharedLocalView: ["browser"],
            },
            instanceDir,
        );

    debugStartup("conversation manager ready; prewarming default conversation");
    // Pre-initialize the default conversation dispatcher before accepting clients,
    // so the first joinConversation call is fast and concurrent joinConversation calls
    // don't race to initialize the same dispatcher.
    await conversationManager.prewarmMostRecentConversation();
    debugStartup("prewarm complete");

    const portIdx = process.argv.indexOf("--port");
    const port =
        portIdx !== -1
            ? parseInt(process.argv[portIdx + 1], 10)
            : process.env.AGENT_SERVER_PORT
              ? parseInt(process.env.AGENT_SERVER_PORT, 10)
              : AGENT_SERVER_DEFAULT_PORT;

    const idleShutdownIdx = process.argv.indexOf("--idle-timeout");
    const idleShutdownMs =
        idleShutdownIdx !== -1
            ? parseInt(process.argv[idleShutdownIdx + 1], 10) * 1000
            : 0;

    let connectionCount = 0;
    let idleShutdownTimer: ReturnType<typeof setTimeout> | undefined;

    // Shared shutdown logic — used by RPC handler, idle timer, and clientIO intercept.
    // The wss variable is assigned after createWebSocketChannelServer resolves below.
    let wss: Awaited<ReturnType<typeof createWebSocketChannelServer>>;

    // Stop listening, close conversations (which releases the instance-dir
    // lock), and drop the PID file. Shared by shutdown and restart so a
    // relaunched successor finds the port free and the lock released.
    async function teardownServer() {
        wss.close();
        await conversationManager.close();
        removeServerPid(port);
    }

    async function shutdownServer() {
        console.log("Shutdown requested, stopping agent server...");
        await teardownServer();
        process.exit(0);
    }

    // Restart in place: tear this process down, then relaunch an identical
    // successor (same node flags + argv) that loads freshly-rebuilt code. The
    // successor inherits this console, and `detached` + `unref` let it outlive
    // us. Releasing the port/lock *before* spawning keeps the successor's bind
    // and lock acquisition from racing this process.
    async function restartServer() {
        // True 24-bit black on yellow: indexed ANSI black (30) is remapped to a
        // dark gray by most terminal themes, which reads as gray-on-yellow.
        process.stderr.write(
            "\x1b[38;2;0;0;0;43m Restart requested - relaunching agent server... \x1b[0m\n",
        );
        await teardownServer();
        const child = spawn(
            process.execPath,
            [...process.execArgv, ...process.argv.slice(1)],
            { detached: true, stdio: "inherit", windowsHide: false },
        );
        child.unref();
        process.exit(0);
    }

    function scheduleIdleShutdown() {
        if (idleShutdownMs <= 0 || connectionCount > 0) {
            return;
        }
        // Don't tear the process down while an agent still has a port
        // registered: out-of-process clients (Chrome/VS Code extension)
        // may have cached that port and could try to reconnect at any
        // moment. Once the agent releases (or its session-context
        // backstop fires), the next disconnect will re-arm this timer.
        if (portRegistrar.hasActiveAllocations()) {
            debugStartup(
                "skipping idle shutdown: PortRegistrar still has active allocations",
            );
            return;
        }
        idleShutdownTimer = setTimeout(async () => {
            console.log(
                "No clients connected — idle shutdown after " +
                    idleShutdownMs / 1000 +
                    "s. Stopping agent server...",
            );
            await shutdownServer();
        }, idleShutdownMs);
    }

    // The per-connection wiring is shared with the in-process (embedded)
    // agent server used by the Electron shell — both go through the same
    // ConversationManager via createAgentServerConnectionHandler so there is
    // a single connection code path regardless of transport.
    const { handler: connectionHandler, broadcastStaleNotice } =
        createAgentServerConnectionHandler({
            conversationManager,
            shutdown: shutdownServer,
            restart: restartServer,
            isStale: isStaleBuild,
            getUserIdentity: () => userIdentity,
            portRegistrar,
            onConnect: () => {
                connectionCount++;
                if (idleShutdownTimer !== undefined) {
                    clearTimeout(idleShutdownTimer);
                    idleShutdownTimer = undefined;
                }
            },
            onDisconnect: () => {
                connectionCount--;
                scheduleIdleShutdown();
            },
        });

    wss = await createWebSocketChannelServer({ port }, connectionHandler);

    // Register the agent-server's own listen port as a regular
    // allocation under the well-known AGENT_SERVER_DISCOVERY_NAME with
    // the synthetic SYSTEM_SESSION_CONTEXT_ID. This gives discovery
    // clients a uniform lookup path (no special-case in the discovery
    // handler) and lets the registrar's collision guard flag agents
    // that try to bind the same port via the same code path it uses
    // for any other allocation. The system sessionContextId protects
    // the entry from releaseAllForSession when real conversation
    // sessions close — it lives for the lifetime of the process.
    portRegistrar.register(
        AGENT_SERVER_DISCOVERY_NAME,
        "default",
        port,
        SYSTEM_SESSION_CONTEXT_ID,
    );

    console.log(`Agent server started at ws://localhost:${port}`);
    writeServerPid(port, process.pid);
    // Warn (once) in this console if the server's own build changes on disk
    // while this process keeps running the old code, and push the notice to
    // any already-connected clients the moment it's detected.
    startStaleBuildWatcher(import.meta.url, broadcastStaleNotice);
    scheduleIdleShutdown();
}

process.on("unhandledRejection", (reason, _promise) => {
    console.error("[agent-server] Unhandled promise rejection:", reason);
    // Log but do not exit — crashing the server kills all concurrent workers.
});

process.on("uncaughtException", (err) => {
    console.error("[agent-server] Uncaught exception:", err);
    // Log but do not exit for non-fatal errors.
});

await main().catch((err: any) => {
    if (err?.code === "ERR_INSTANCE_LOCKED") {
        // Friendly, single-line message — no stack trace for this expected
        // case (another shell/server already owns the profile directory).
        console.error(`\n[agent-server] ${err.message}\n`);
        process.exit(1);
    }
    console.error("[agent-server] Fatal startup error:", err);
    process.exit(1);
});
