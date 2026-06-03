// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Pattern: view-ui — web view renderer with IPC handler.
// Opens a local HTTP server serving site/ and surfaces it in the shell
// via an ActivityContext with openLocalView=true.
//
// Port allocation: the view server binds on an OS-assigned ephemeral
// port (port=0) by default. The actual port is registered with the
// dispatcher via context.registerPort("view", port) so external
// clients can discover it through the agent-server's discovery channel
// (discoverPort("__agentName__", "view")). context.setLocalHostPort(port) is
// also called so the embedding shell knows which port to load when an
// action returns openLocalView=true. Set __PORT_ENV__ to pin the view
// to a fixed port when debugging.

import {
    ActionContext,
    ActionResult,
    ActivityContext,
    AppAgent,
    SessionContext,
    TypeAgentAction,
} from "@typeagent/agent-sdk";
import {
    createActionResult,
    createActionResultFromHtmlDisplay,
} from "@typeagent/agent-sdk/helpers/action";
import { createServer, Server } from "node:http";
import { AddressInfo } from "node:net";
import { __AgentName__Actions } from "./__agentName__Schema.js";

type __AgentName__AgentContext = {
    server?: Server;
    port?: number;
    portRegistration?: { release: () => void };
};

function getViewBindPort(): number {
    const v = process.env["__PORT_ENV__"];
    if (!v) return 0;
    const n = parseInt(v, 10);
    return Number.isFinite(n) && n >= 0 ? n : 0;
}

export function instantiate(): AppAgent {
    return {
        initializeAgentContext,
        updateAgentContext,
        closeAgentContext,
        executeAction,
    };
}

async function initializeAgentContext(): Promise<__AgentName__AgentContext> {
    return {};
}

/**
 * Bind the view server on `port` (0 = OS-assigned). Returns the actual
 * bound port so it can be registered and surfaced to the shell.
 * Rejects on bind failure (EADDRINUSE under a fixed-port override) so
 * callers see the problem instead of having it swallowed by a late
 * error handler.
 */
function startViewServer(
    port: number,
): Promise<{ server: Server; port: number }> {
    return new Promise((resolve, reject) => {
        const server = createServer((req, res) => {
            // TODO: serve static assets from ./site/, plus any
            // JSON/IPC endpoints the view needs. For now, a placeholder.
            res.writeHead(200, { "Content-Type": "text/html" });
            // Escape req.url before echoing it into HTML — it is attacker-
            // controlled and would otherwise be a reflected XSS sink.
            const safePath = String(req.url ?? "/").replace(
                /[&<>"']/g,
                (c) =>
                    ({
                        "&": "&amp;",
                        "<": "&lt;",
                        ">": "&gt;",
                        '"': "&quot;",
                        "'": "&#39;",
                    })[c] as string,
            );
            res.end(`<h1>__AgentName__ view</h1><p>Path: ${safePath}</p>`);
        });
        let settled = false;
        const onError = (e: Error) => {
            if (settled) return;
            settled = true;
            server.removeListener("listening", onListening);
            reject(e);
        };
        const onListening = () => {
            if (settled) return;
            settled = true;
            server.removeListener("error", onError);
            const addr = server.address() as AddressInfo | null;
            if (!addr || typeof addr === "string") {
                server.close();
                reject(
                    new Error(
                        "http server.address() did not return AddressInfo",
                    ),
                );
                return;
            }
            // Re-attach a permanent error handler so post-listen errors
            // are logged rather than crashing the process.
            server.on("error", () => {
                /* TODO: log */
            });
            resolve({ server, port: addr.port });
        };
        server.once("error", onError);
        server.once("listening", onListening);
        server.listen(port);
    });
}

async function updateAgentContext(
    enable: boolean,
    context: SessionContext<__AgentName__AgentContext>,
    _schemaName: string,
): Promise<void> {
    const agentContext = context.agentContext;
    if (enable) {
        if (agentContext.server !== undefined) {
            // Already bound for this session.
            return;
        }
        const { server, port } = await startViewServer(getViewBindPort());
        try {
            agentContext.server = server;
            agentContext.port = port;
            agentContext.portRegistration = context.registerPort("view", port);
            // Tell the embedding shell which port to load when an
            // action returns openLocalView=true. Goes through the
            // registrar with role="default", so the discovery-channel
            // role "view" above keeps a stable contract for out-of-
            // process clients regardless of this back-compat call.
            context.setLocalHostPort(port);
        } catch (e) {
            // Roll back if registration/setLocalHostPort fails so a
            // retry sees a clean slate.
            agentContext.portRegistration?.release();
            await new Promise<void>((resolve) => server.close(() => resolve()));
            delete agentContext.server;
            delete agentContext.port;
            delete agentContext.portRegistration;
            throw e;
        }
    } else {
        if (agentContext.server === undefined) return;
        agentContext.portRegistration?.release();
        delete agentContext.portRegistration;
        const server = agentContext.server;
        delete agentContext.server;
        delete agentContext.port;
        // Resolve when the server has fully released its port —
        // important for a rapid disable→enable cycle under a fixed-
        // port override (`__PORT_ENV__`), where a synchronous return
        // would race the new bind into EADDRINUSE.
        await new Promise<void>((resolve) => server.close(() => resolve()));
    }
}

async function closeAgentContext(
    context: SessionContext<__AgentName__AgentContext>,
): Promise<void> {
    // Backstop: if updateAgentContext(false) wasn't called (e.g. crash
    // during shutdown), release the registration and close the server
    // so the port doesn't leak.
    const agentContext = context.agentContext;
    agentContext.portRegistration?.release();
    delete agentContext.portRegistration;
    if (agentContext.server) {
        const server = agentContext.server;
        delete agentContext.server;
        delete agentContext.port;
        await new Promise<void>((resolve) => server.close(() => resolve()));
    }
}

async function executeAction(
    action: TypeAgentAction<__AgentName__Actions>,
    context: ActionContext<__AgentName__AgentContext>,
): Promise<ActionResult> {
    const port = context.sessionContext.agentContext.port;
    // Returning an ActivityContext with openLocalView=true signals the
    // shell to open the local view (it uses the port published via
    // setLocalHostPort during enable). Drop the activityContext field
    // if your action doesn't need to surface the view.
    const activityContext: ActivityContext | undefined =
        port !== undefined
            ? {
                  appAgentName: "__agentName__",
                  activityName: action.actionName,
                  description: `__AgentName__: ${action.actionName}`,
                  state: {},
                  openLocalView: true,
              }
            : undefined;
    const result = createActionResultFromHtmlDisplay(
        `<p>Executing ${action.actionName} — not yet implemented.</p>`,
    );
    if (activityContext) {
        // ActivityContext is attached so the shell can open the view.
        // The shape comes from the SDK; cast through unknown to keep
        // the template free of internal-only ActionResult fields.
        (
            result as unknown as { activityContext: ActivityContext }
        ).activityContext = activityContext;
    }
    return result;
}

// Silence unused-import warning when the action handler is stripped
// down. `createActionResult` is provided alongside the HTML helper for
// callers that want a richer entity-bearing result.
void createActionResult;
