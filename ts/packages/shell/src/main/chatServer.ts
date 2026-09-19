// Copyright (c) Microsoft Corporation and Henry Lucco.
// Licensed under the MIT License.
import { createServer, Server, IncomingMessage } from "node:http";

import registerDebug from "debug";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import WebSocket, { WebSocketServer } from "ws";
import { getMimeType } from "@typeagent/typechat-utils";
import {
    isLoopbackHost,
    LOOPBACK_HOST,
} from "@typeagent/websocket-utils/loopback";
import {
    createConfiguredOriginAllowlist,
    parseAllowedOrigins,
} from "@typeagent/websocket-utils/originAllowlist";
import path from "node:path";

const debug = registerDebug("typeagent:shell:chatServer");

/**
 * Origins allowed to open the chat socket, beyond the loopback baseline.
 * Comma separated, each an exact scheme://host[:port].
 *
 * The page connects back to whatever host it was loaded from, so widening the
 * bind alone is not enough: a phone loading the view from `http://192.168.1.5:port`
 * sends that as its `Origin`, which the loopback baseline refuses. Naming the
 * origin here reopens exactly that case while still refusing a DNS rebinding
 * attacker, whose Origin is its own domain.
 */
const ALLOWED_ORIGINS_ENV = "TYPEAGENT_SHELL_CHAT_SERVER_ALLOWED_ORIGINS";

/**
 * Rejects upgrades from web pages that are not part of TypeAgent. Without this
 * any page the user happens to have open could open a socket to the chat view
 * port and read the conversation. A sandboxed frame sends "Origin: null", which
 * carries no useful identity, so it is refused too.
 */
function createChatOriginAllowlist() {
    return createConfiguredOriginAllowlist(
        { allowNullOrigin: false },
        parseAllowedOrigins(process.env[ALLOWED_ORIGINS_ENV]),
    );
}

/**
 * Resolves the interface the chat view server listens on.
 *
 * Loopback is the default because the server is unauthenticated and pushes the
 * whole chat log to every client that connects. Binding all interfaces would
 * let any peer on the same network read the conversation. Set
 * TYPEAGENT_SHELL_CHAT_SERVER_HOST to expose it deliberately, for instance to
 * read the chat view from a phone on a trusted home network.
 */
export function resolveChatServerHost(): string {
    const host = process.env.TYPEAGENT_SHELL_CHAT_SERVER_HOST?.trim();
    return host !== undefined && host !== "" ? host : LOOPBACK_HOST;
}

export class ChatServer {
    private server: Server<any, any>;
    private socketServer: WebSocketServer;
    private port: number;
    private host: string;

    onConnection(callback: (ws: WebSocket, req: IncomingMessage) => void) {
        this.socketServer.on(
            "connection",
            (ws: WebSocket, req: IncomingMessage) => {
                console.log(`New client ${ws} ${req}`);

                callback(ws, req);
            },
        );
    }

    constructor(port: number) {
        this.port = port;
        this.host = resolveChatServerHost();

        // web server for HTML page
        this.server = createServer((request: any, response: any) => {
            this.serve(request, response);
        });

        // socket server for web page IPC calls. Built per instance so the
        // allowlist reflects configuration loaded after module import.
        const isOriginAllowed = createChatOriginAllowlist();
        this.socketServer = new WebSocketServer({
            server: this.server,
            verifyClient: ({ origin }) => isOriginAllowed(origin),
        });

        this.server.on("listening", () => {
            console.log(`WebSocket server started!`);
        });

        this.server.on("error", (error: string) => {
            console.error(`WebSocket server error: ${error}`);
            this.server.close();
        });

        // this.server.on("connection", (ws: WebSocket, req: IncomingMessage) => {
        //     console.log(`New client ${ws} ${req}`);

        //     // send the contents of the chat log upon the initial connection
        //     this.socketServer.clients.forEach((client) => {
        //         if (client.readyState === WebSocket.OPEN) {
        //             client.send();
        //         }
        //     });
        // });
    }

    async start() {
        if (!isLoopbackHost(this.host)) {
            console.warn(
                `WARNING: binding ${this.host} exposes the chat view to the network. It has no authentication - anyone who can reach the port can read your conversation.`,
            );
        }
        this.server.listen(this.port, this.host, () => {
            console.log(`ChatServer is listening on ${this.host}:${this.port}`);
        });
    }

    stop() {
        this.server.close(() => {
            console.log("ChatServer has been stopped.");
        });

        this.socketServer.close(() => {
            console.log("WebSocket server has been stopped.");
        });
    }

    serve(request: any, response: any) {
        debug(`Received request: ${request.url}`);

        // serve up the requested file if we have it
        const root: string = path.resolve("out/renderer");
        let requestedFile: string =
            request.url == "/" || request.url === undefined
                ? "index.html"
                : request.url;

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
                response.writeHead(200, {
                    "Content-Type": getMimeType(path.extname(requestedFile)),
                    "Access-Control-Allow-Origin": "*",
                    //"Permissions-Policy": "camera=(self)", // allow access to getUserMedia() for the camera
                });
                response.end(readFileSync(requestedFile).toString());

                console.log(`Served '${requestedFile}' as '${request.url}'`);
            }
        } catch (error) {
            response.writeHead(404, { "Content-Type": "text/plain" });
            response.end("File Not Found!\n");

            console.log(`Unable to serve '${request.url}', 404. ${error}`);
        }
    }

    broadcast(message: string) {
        this.socketServer.clients.forEach((client) => {
            if (client.readyState === WebSocket.OPEN) {
                client.send(message);
            }
        });
    }
}
