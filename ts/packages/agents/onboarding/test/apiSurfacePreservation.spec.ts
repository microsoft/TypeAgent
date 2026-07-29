// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Verifies CHANGE 1/2 survive the full discovery -> approval round trip
// (parseOpenApiSpec writes api-surface.json, approveApiSurface re-reads and
// re-writes it via `{...surface, ...}`): baseUrl and per-parameter `in`
// must still be present in the approved artifact. Exercises the real
// executeDiscoveryAction handler end-to-end against the real per-integration
// workspace on disk (~/.typeagent/onboarding/<name>), cleaned up afterward.

import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "fs/promises";
import path from "path";
import os from "os";
import { fileURLToPath } from "url";
import { executeDiscoveryAction } from "../src/discovery/discoveryHandler.js";
import type { ApiSurface } from "../src/discovery/discoveryHandler.js";
import { createWorkspace, readArtifactJson } from "../src/lib/workspace.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const INTEGRATION_NAME = `test-book-api-${process.pid}-${Date.now()}`;

function getWorkspaceDir(): string {
    return path.join(
        os.homedir(),
        ".typeagent",
        "onboarding",
        INTEGRATION_NAME,
    );
}

after(async () => {
    await fs.rm(getWorkspaceDir(), { recursive: true, force: true });
});

test("baseUrl and parameter `in` survive parseOpenApiSpec -> approveApiSurface", async () => {
    await createWorkspace({ integrationName: INTEGRATION_NAME });

    const fixturePath = path.resolve(
        __dirname,
        "fixtures/openapi/book-api-absolute-server.json",
    );

    const parseResult = await executeDiscoveryAction(
        {
            actionName: "parseOpenApiSpec",
            parameters: {
                integrationName: INTEGRATION_NAME,
                specSource: fixturePath,
            },
        } as any,
        {} as any,
    );
    assert.ok(
        !("error" in (parseResult as any)),
        `parseOpenApiSpec failed: ${JSON.stringify(parseResult)}`,
    );

    const parsedSurface = await readArtifactJson<ApiSurface>(
        INTEGRATION_NAME,
        "discovery",
        "api-surface.json",
    );
    assert.equal(parsedSurface?.baseUrl, "https://api.example.com/v1");
    const getBook = parsedSurface?.actions.find((a) => a.name === "getBook");
    assert.equal(
        getBook?.parameters?.find((p) => p.name === "book_id")?.in,
        "path",
    );

    const approveResult = await executeDiscoveryAction(
        {
            actionName: "approveApiSurface",
            parameters: { integrationName: INTEGRATION_NAME },
        } as any,
        {} as any,
    );
    assert.ok(
        !("error" in (approveResult as any)),
        `approveApiSurface failed: ${JSON.stringify(approveResult)}`,
    );

    const approvedSurface = await readArtifactJson<ApiSurface>(
        INTEGRATION_NAME,
        "discovery",
        "api-surface.json",
    );
    assert.equal(
        approvedSurface?.baseUrl,
        "https://api.example.com/v1",
        "baseUrl must survive the approval spread",
    );
    const approvedGetBook = approvedSurface?.actions.find(
        (a) => a.name === "getBook",
    );
    assert.equal(
        approvedGetBook?.parameters?.find((p) => p.name === "book_id")?.in,
        "path",
        "parameter `in` must survive the approval spread",
    );
    assert.equal(approvedSurface?.approved, true);
});
