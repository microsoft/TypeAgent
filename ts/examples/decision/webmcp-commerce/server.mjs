// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";

const files = new Map([
    ["/", "./fixture.html"],
    ["/fixture.html", "./fixture.html"],
    ["/page.mjs", "./page.mjs"],
    ["/registry.mjs", "./registry.mjs"],
    ["/catalog.mjs", "./catalog.mjs"],
    ["/schema.mjs", "./schema.mjs"],
    ["/execute.mjs", "./execute.mjs"],
    ["/images/apple.svg", "./images/apple.svg"],
    ["/images/kale.svg", "./images/kale.svg"],
    ["/images/roll.svg", "./images/roll.svg"],
    ["/images/loaf.svg", "./images/loaf.svg"],
    ["/images/carton.svg", "./images/carton.svg"],
    ["/images/cakes.svg", "./images/cakes.svg"],
    ["/images/jar.svg", "./images/jar.svg"],
]);

export async function startServer() {
    const server = createServer(async (request, response) => {
        const file = files.get(request.url);
        if (!file || request.method !== "GET" || request.url.includes("..")) {
            response.writeHead(404).end();
            return;
        }
        try {
            const body = await readFile(new URL(file, import.meta.url));
            response.writeHead(200, {
                "Content-Type": contentType(file),
                "Cache-Control": "no-store",
                "X-Content-Type-Options": "nosniff",
                "Content-Security-Policy":
                    "default-src 'none'; style-src 'unsafe-inline'; script-src 'self'; img-src 'self'; connect-src 'none'; form-action 'none'; base-uri 'none'",
            });
            response.end(body);
        } catch {
            response.writeHead(404).end();
        }
    });
    await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", resolve);
    });
    return {
        url: `http://127.0.0.1:${server.address().port}`,
        close: () => new Promise((resolve) => server.close(resolve)),
    };
}

function contentType(file) {
    if (file.endsWith(".svg")) return "image/svg+xml";
    if (file.endsWith(".mjs")) return "text/javascript; charset=utf-8";
    return "text/html; charset=utf-8";
}
