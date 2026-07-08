// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { TypeAgentAPIWebServer } from "../src/webServer.js";
import type { TypeAgentAPIServerConfig } from "../src/webServer.js";
import type { AddressInfo } from "node:net";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Exercises the real static-file HTTP server (TypeAgentAPIWebServer) against a
// throwaway web root on an ephemeral port. It intentionally does not spin up the
// full TypeAgentServer (which brings up the LLM-backed dispatcher and needs API
// keys + data/config.json); this covers the web-serving behavior the old
// (skipped, no-op) api.spec.ts was meant to check.

describe("api web server", () => {
    let wwwroot: string;
    let server: TypeAgentAPIWebServer;
    let baseUrl: string;

    beforeAll(async () => {
        // realpathSync so the canonical path matches what the server resolves
        // requests against (avoids Windows short/long-name mismatches that would
        // otherwise trip the server's under-web-root check).
        wwwroot = fs.realpathSync(
            fs.mkdtempSync(path.join(os.tmpdir(), "api-webserver-")),
        );
        fs.writeFileSync(
            path.join(wwwroot, "index.html"),
            "<!doctype html><title>TypeAgent</title><h1>ok</h1>",
        );

        const config: TypeAgentAPIServerConfig = {
            wwwroot,
            port: 0, // unused: we bind an ephemeral port directly below
            broadcast: false,
            blobBackupEnabled: false,
        };

        // A no-op action handler is sufficient; these checks don't post actions.
        server = new TypeAgentAPIWebServer(config, () => undefined);

        // Bind an ephemeral loopback port instead of calling start(), which
        // hardcodes 3000 (and 3443) and would conflict / bind all interfaces.
        await new Promise<void>((resolve, reject) => {
            server.server.once("error", reject);
            server.server.listen(0, "127.0.0.1", resolve);
        });
        const { port } = server.server.address() as AddressInfo;
        baseUrl = `http://127.0.0.1:${port}`;
    });

    afterAll(async () => {
        await new Promise<void>((resolve) =>
            server.server.close(() => resolve()),
        );
        fs.rmSync(wwwroot, { recursive: true, force: true });
    });

    it("serves index.html at the web root", async () => {
        const response = await fetch(`${baseUrl}/`);
        expect(response.status).toBe(200);
        expect(response.headers.get("content-type")).toContain("text/html");
        expect(await response.text()).toContain("<h1>ok</h1>");
    });

    it("serves a file requested by name", async () => {
        const response = await fetch(`${baseUrl}/index.html`);
        expect(response.status).toBe(200);
        expect(await response.text()).toContain("<h1>ok</h1>");
    });

    it("returns 404 for a missing file", async () => {
        const response = await fetch(`${baseUrl}/does-not-exist.asdfsdf`);
        expect(response.status).toBe(404);
    });
});
