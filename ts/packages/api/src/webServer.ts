// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { getMimeType } from "@typeagent/typechat-utils";
import { isAllowedApiOrigin, resolveCorsOrigin } from "./originPolicy.js";
import {
    LOOPBACK_HOST,
    isLoopbackHost,
} from "@typeagent/websocket-utils/loopback";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import {
    createServer,
    IncomingHttpHeaders,
    OutgoingHttpHeaders,
    Server,
} from "node:http";
import {
    createServer as createSecureServer,
    Server as SecureServer,
} from "node:https";
import path from "node:path";

const DEFAULT_PORT = 3000;
const SECURE_PORT = 3443;

export type TypeAgentAPIServerConfig = {
    wwwroot: string;
    port: number;
    /**
     * Address to bind. Defaults to loopback so the unauthenticated
     * `/action/` endpoint and dispatcher WebSocket are reachable only from
     * this machine. Set it (or TYPEAGENT_API_HOST, which wins) to
     * `0.0.0.0` when hosting the container image, where the port is
     * published deliberately and the container is the isolation boundary.
     */
    host?: string;
    broadcast: boolean;
    blobBackupEnabled: boolean;
    storageProvider?: "azure" | "aws";
};

/**
 * Address the servers bind to. TYPEAGENT_API_HOST overrides the config file
 * so the container image can widen the bind without editing `data/config.json`.
 */
export function resolveListenHost(config: TypeAgentAPIServerConfig): string {
    return (
        process.env.TYPEAGENT_API_HOST?.trim() ||
        config.host?.trim() ||
        LOOPBACK_HOST
    );
}

/**
 * Whether a request is allowed to submit an action. `/action/` runs the
 * request through the dispatcher with the local user's permissions - it can
 * send mail, write files, and drive the browser - and carries no
 * authentication, so a request that a web page could have caused must be
 * refused.
 *
 * Two header checks, because neither covers every case on its own:
 *  - `Origin` is sent by fetch/XHR and by form posts, and identifies the page
 *    that made the request. Only the served loopback origins are honored.
 *  - `Sec-Fetch-Site` is sent by current browsers on *every* request,
 *    including `<img src=...>` and top-level navigations that carry no
 *    Origin. `cross-site` and `same-site` (another loopback port counts as
 *    same-site) are refused; `same-origin` (the chat view this server
 *    serves) and `none` (the user typed the URL) are allowed.
 *
 * Non-browser clients (curl, an IoT device) send neither header and are
 * allowed - the loopback bind is what keeps them local. That is also the
 * limit of this check: browsers without fetch metadata support (before
 * roughly Firefox 90 and Safari 16.4) send neither header on an image load
 * either, so on those a cross-site `<img>` to `/action/` is indistinguishable
 * from an IoT client and still gets through. Current browsers label it
 * `cross-site` and are refused. Closing that off completely means dropping
 * GET or requiring a secret, both of which break existing callers.
 */
export function isTrustedActionRequest(headers: IncomingHttpHeaders): boolean {
    const origin = headers.origin;
    if (origin !== undefined && !isAllowedApiOrigin(origin)) {
        return false;
    }
    const site = headers["sec-fetch-site"];
    return site === undefined || site === "same-origin" || site === "none";
}

export class TypeAgentAPIWebServer {
    public server: Server<any, any>;
    private secureServer: SecureServer<any, any> | undefined;
    private actionHandler: (action: any) => any;
    private config: TypeAgentAPIServerConfig;

    constructor(
        config: TypeAgentAPIServerConfig,
        actionHandler: (action: any) => any,
    ) {
        this.config = config;

        // web server
        this.server = createServer((request: any, response: any) => {
            this.serve(config, request, response);
        });

        // secure webserver
        if (
            existsSync(".cert/localhost+2-key.pem") &&
            existsSync(".cert/localhost+2.pem")
        ) {
            this.secureServer = createSecureServer(
                {
                    key: readFileSync(".cert/localhost+2-key.pem"), // path to localhost+2-key.pem
                    cert: readFileSync(".cert/localhost+2.pem"), // path to localhost+2.pem
                    requestCert: false,
                    rejectUnauthorized: true,
                },
                (request: any, response: any) => {
                    this.serve(config, request, response);
                },
            );
        } else {
            console.warn(
                "SSL Certificates NOT found, cannot listen for https:// requests!",
            );
        }

        // action handler
        this.actionHandler = actionHandler;
    }

    serve(config: TypeAgentAPIServerConfig, request: any, response: any) {
        // serve up the requested file if we have it
        const root: string = path.resolve(config.wwwroot);
        let requestedFile: string =
            request.url == "/" || request.url === undefined
                ? "index.html"
                : request.url;

        // special case - dev helper
        if (requestedFile == "/__/__headers") {
            return this.printHeaders(request, response);
        }

        // process POST requests
        const url = new URL(request.url, "http://localhost");
        if (
            url.pathname == "/action/" &&
            (request.method === "PUT" || request.method === "GET")
        ) {
            if (!isTrustedActionRequest(request.headers)) {
                console.warn(
                    `Refused action request from origin '${request.headers.origin}' (${request.socket.remoteAddress})`,
                );
                response.writeHead(403, { "Content-Type": "application/json" });
                response.end(JSON.stringify({ error: "Forbidden" }));
                return;
            }

            let data: string | null = "";
            if (request.method === "PUT") {
                data = request.read();
            } else {
                data = url.searchParams.get("a");
            }

            try {
                const action: any = JSON.parse(data?.toString() ?? "");
                console.log(
                    "Received action request: ",
                    JSON.stringify(action, null, 2),
                );

                const actionResult = this.actionHandler(action);

                response.writeHead(200, { "Content-Type": "application/json" });
                response.end(JSON.stringify(actionResult));
            } catch (ex) {
                response.writeHead(500, { "Content-Type": "application/json" });
                response.end(JSON.stringify({ error: ex }));
            }

            return;
        }

        // make sure requested file falls under web root
        try {
            requestedFile = realpathSync(
                path.resolve(path.join(root, requestedFile)),
            );
            if (!requestedFile.startsWith(root)) {
                response.statusCode = 403;
                response.end();
                return;
            }

            // serve requested file
            if (existsSync(requestedFile)) {
                const headers: OutgoingHttpHeaders = {
                    "Content-Type": getMimeType(path.extname(requestedFile)),
                    // Responses differ by Origin, so caches must key on it.
                    Vary: "Origin",
                    //"Permissions-Policy": "camera=(self)", // allow access to getUserMedia() for the camera
                };
                const corsOrigin = resolveCorsOrigin(request.headers?.origin);
                if (corsOrigin !== undefined) {
                    headers["Access-Control-Allow-Origin"] = corsOrigin;
                }
                response.writeHead(200, headers);
                response.end(readFileSync(requestedFile).toString());

                console.log(`Served '${requestedFile}' as '${request.url}'`);
                return;
            }
        } catch (error) {
            response.writeHead(404, { "Content-Type": "text/plain" });
            response.end("File Not Found!\n");

            console.log(`Unable to serve '${request.url}', 404. ${error}`);
            return;
        }

        response.writeHead(400, { "Content-Type": "text/plain" });
        response.end("Invalid Request!\n");
    }

    start() {
        const host = resolveListenHost(this.config);
        const port = this.config.port ?? DEFAULT_PORT;
        if (!isLoopbackHost(host)) {
            console.warn(
                `WARNING: binding ${host} exposes this server to the network. It has no authentication - anyone who can reach the port can dispatch actions as you (send mail, read files, drive the browser).`,
            );
        }

        this.server.listen(port, host, () => {
            console.log(`Listening at http://${host}:${port}`);
        });

        this.secureServer?.listen(SECURE_PORT, host, () => {
            console.log(`Listening securely at https://${host}:${SECURE_PORT}`);
        });
    }

    stop() {
        this.server.close();
    }

    printHeaders(request: any, response: any): boolean {
        const headers = request.headers;

        // Convert headers object to a JSON string
        const headersJson = JSON.stringify(headers, null, 2);

        response.writeHead(200, {
            "Content-Type": "text/html",
        });

        // Send the HTML page with headers
        response.end(`
          <!DOCTYPE html>
          <html lang="en">
          <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>HTTP Headers</title>
          </head>
          <body>
            <h3>Client IP: ${request.socket.remoteAddress}</h3>
            <h2>HTTP Headers</h2>
            <pre>${headersJson}</pre>
          </body>
          </html>
        `);

        console.warn(`Served HTTP headers for ${request.url}`);

        return true;
    }
}
