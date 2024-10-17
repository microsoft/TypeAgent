// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { getMimeType } from "common-utils";
import { existsSync, readFileSync } from "node:fs";
import { createServer, Server } from "node:http";
import path from "node:path";

export type TypeAgentAPIServerConfig = {
    wwwroot: string;
    broadcast: boolean;
};

export class TypeAgentAPIWebServer {
    private server: Server<any, any>;

    constructor(config: TypeAgentAPIServerConfig) {
        // web server
        this.server = createServer(async (req, res) => {
            // serve up the requested file if we have it
            const requestedFile: string = path.join(
                config.wwwroot,
                req.url == "/" || req.url === undefined
                    ? "index.html"
                    : req.url,
            );
            if (existsSync(requestedFile)) {
                res.writeHead(200, {
                    "Content-Type": getMimeType(path.extname(requestedFile)),
                    "Access-Control-Allow-Origin": "*",
                });
                res.end(readFileSync(requestedFile).toString());

                console.log(`Served '${requestedFile}' as '${req.url}'`);
            } else {
                res.writeHead(404, { "Content-Type": "text/plain" });
                res.end("File Not Found!\n");

                console.log(`Unable to serve '${req.url}', 404.`);
            }
        });
    }

    start() {
        // starts a simple http server locally on port 3000
        this.server.listen(3000, "127.0.0.1", () => {
            console.log("Listening on 127.0.0.1:3000");
        });
    }

    stop() {
        this.server.close();
    }
}
