// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as os from "node:os";
import * as path from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import { startStudioService } from "../src/studioService.js";
import { StudioServiceProxyClient } from "../src/studioServiceProxyClient.js";

/**
 * The standalone service is per-workspace: it binds to one canonical workspace
 * at startup and must refuse requests for a different one (rather than silently
 * multiplexing runtimes for any `repoRoot` a client sends).
 */
describe("studio service workspace binding", () => {
    let boundRoot: string;
    let otherRoot: string;

    beforeAll(() => {
        // Temp dirs with no `packages/agents` anywhere above them, so each
        // resolves to itself (distinct canonical workspaces).
        boundRoot = mkdtempSync(path.join(os.tmpdir(), "studio-bound-"));
        otherRoot = mkdtempSync(path.join(os.tmpdir(), "studio-other-"));
    });

    afterAll(() => {
        rmSync(boundRoot, { recursive: true, force: true });
        rmSync(otherRoot, { recursive: true, force: true });
    });

    it("serves the bound workspace and rejects a different one", async () => {
        const handle = await startStudioService({ repoRoot: boundRoot });
        try {
            // Matching workspace → served.
            const ok = await StudioServiceProxyClient.connect({
                port: handle.port,
                token: handle.token,
                repoRoot: handle.repoRoot,
            });
            expect(ok).toBeDefined();
            const info = await ok!.getStudioInfo();
            expect(info.repoRootInfo.repoRoot).toBe(handle.repoRoot);
            ok!.close();

            // A request for a *different* workspace → rejected.
            const mismatch = await StudioServiceProxyClient.connect({
                port: handle.port,
                token: handle.token,
                repoRoot: otherRoot,
            });
            expect(mismatch).toBeDefined();
            await expect(mismatch!.getStudioInfo()).rejects.toThrow(
                /bound to workspace/i,
            );
            mismatch!.close();
        } finally {
            await handle.close();
        }
    });
});
