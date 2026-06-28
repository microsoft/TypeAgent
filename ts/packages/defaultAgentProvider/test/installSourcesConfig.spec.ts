// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
    getInstallDir,
    getInstanceConfigProvider,
    getResolvedInstallSources,
} from "../src/utils/config.js";

function tmpInstanceDir(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), "ta-cfg-"));
}

describe("getResolvedInstallSources", () => {
    it("uses the shipped seed defaults when nothing is persisted", () => {
        const dir = tmpInstanceDir();
        const instanceConfigs = getInstanceConfigProvider(dir);
        const sources = getResolvedInstallSources(instanceConfigs);
        // path + builtin + typeagent are always present, in resolution order:
        // path first, the feed last.
        const names = sources.map((s) => s.name);
        expect(names).toContain("path");
        expect(names).toContain("builtin");
        expect(names).toContain("typeagent");
        expect(names[0]).toBe("path");
        expect(names[names.length - 1]).toBe("typeagent");
        // default installDir is <instanceDir>/installedAgents
        expect(getInstallDir(instanceConfigs)).toBe(
            path.join(dir, "installedAgents"),
        );
    });

    it("honors persisted sources, ignoring legacy order", () => {
        const dir = tmpInstanceDir();
        fs.writeFileSync(
            path.join(dir, "config.json"),
            JSON.stringify({
                installSources: {
                    // Legacy field from an older build; ignored on read.
                    order: ["typeagent", "path"],
                    sources: [
                        { kind: "path", name: "path" },
                        {
                            kind: "catalog",
                            name: "builtin",
                            catalog: "<bundled>",
                        },
                    ],
                },
            }),
        );
        const instanceConfigs = getInstanceConfigProvider(dir);
        const sources = getResolvedInstallSources(instanceConfigs);
        // The persisted sources array order IS the resolution order; the legacy
        // `order` field has no effect.
        expect(sources.map((s) => s.name)).toEqual(["path", "builtin"]);
        // installDir is always derived from the instance dir, never persisted.
        expect(getInstallDir(instanceConfigs)).toBe(
            path.join(dir, "installedAgents"),
        );
    });
});
