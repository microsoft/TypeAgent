// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { mkdtempSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { init } from "../src/init.js";

describe("init", () => {
    it("enables the plugin in repo-local Copilot settings", () => {
        const repo = mkdtempSync(path.join(os.tmpdir(), "gcs-"));
        init(repo);
        const settings = JSON.parse(
            readFileSync(
                path.join(repo, ".github/copilot/settings.local.json"),
                "utf8",
            ),
        );
        expect(settings.enabledPlugins).toEqual({
            "git-commit-story@git-commit-story": true,
        });
    });
});
