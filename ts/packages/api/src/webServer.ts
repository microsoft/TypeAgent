// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { getMimeType } from "common-utils";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { createServer, Server } from "node:http";
import {
    createServer as createSecureServer,
    Server as SecureServer,
} from "node:https";
import path from "node:path";

export type TypeAgentAPIServerConfig = {
    wwwroot: string;
    port: number;
    broadcast: boolean;
    blobBackupEnabled: boolean;
};

export class TypeAgentAPIWebServer {
    public server: Server<any, any>;
    private secureServer: SecureServer<any, any> | undefined;

    constructor(config: TypeAgentAPIServerConfig) {
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
    }

    serve(config: TypeAgentAPIServerConfig, request: any, response: any) {
        // serve up the requested file if we have it
        let root: string = path.resolve(config.wwwroot);
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

    start() {
        this.server.listen(3000, () => {
            console.log("Listening on all local IPs at port 3000");
        });

        this.secureServer?.listen(3443, () => {
            console.log("Listening securely on all local IPs at port 3443");
        });
    }

    stop() {
        this.server.close();
    }
}
