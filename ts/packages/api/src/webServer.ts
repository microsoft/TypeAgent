// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { getMimeType } from "common-utils";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { createServer, Server } from "node:http";
//import { createServer as createSecureServer, Server as SecureServer } from "node:https"
import path from "node:path";

export type TypeAgentAPIServerConfig = {
    wwwroot: string;
    port: number;
    broadcast: boolean;
};

export class TypeAgentAPIWebServer {
    private server: Server<any, any>;
    //private secureServer: SecureServer<any, any>;
    private config: TypeAgentAPIServerConfig;

    constructor(config: TypeAgentAPIServerConfig) {
        this.config = config;

        // web server
        this.server = createServer(this.serve);

        // secure webserver
        // this.secureServer = createServer(
        //     {
        //         key: fs.readFileSync('./localhost+2-key.pem'), // path to localhost+2-key.pem
        //         cert: fs.readFileSync('./localhost+2.pem'), // path to localhost+2.pem
        //         requestCert: false,
        //         rejectUnauthorized: false,
        //     },
        //     this.serve);
    }

    async serve(request: any, response: any) {
        // serve up the requested file if we have it
        let root: string = path.resolve(this.config.wwwroot);
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
                    "Content-Type": getMimeType(
                        path.extname(requestedFile),
                    ),
                    "Access-Control-Allow-Origin": "*",
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
        // starts a simple http server locally on port 3000
        // this.server.listen(3000, "127.0.0.1", () => {
        //     console.log("Listening on 127.0.0.1:3000");
        // });
        this.server.listen(3000, () => {
            console.log("Listening on all local IPs at port 3000");
        });

        // this.secureServer.listen(3003, () => {
        //     console.log("Listening securely on all local IPs at port 3003")
        // });

        // this.server.listen(3000, "10.137.63.33", () => {
        //     console.log("Listening on 10.137.63.33:3000");
        // });

        // // starts a simple http server locally on port 3000
        // this.server.listen(3000, "192.168.1.142", () => {
        //     console.log("Listening on 192.168.1.142:3000");
        // });
    }

    stop() {
        this.server.close();
    }
}
