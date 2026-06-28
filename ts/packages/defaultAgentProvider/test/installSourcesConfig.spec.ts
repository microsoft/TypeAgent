// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
    getInstanceConfigProvider,
    getResolvedInstallSources,
} from "../src/utils/config.js";

function tmpInstanceDir(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), "ta-cfg-"));
}

describe("getResolvedInstallSources", () => {
    it("uses the shipped seed defaults when nothing is persisted", () => {
        const dir = tmpInstanceDir();
        const resolved = getResolvedInstallSources(
            getInstanceConfigProvider(dir),
        );
        // path + builtin + typeagent are always present, in resolution order:
        // path first, the feed last.
        const names = resolved.sources.map((s) => s.name);
        expect(names).toContain("path");
        expect(names).toContain("builtin");
        expect(names).toContain("typeagent");
        expect(names[0]).toBe("path");
        expect(names[names.length - 1]).toBe("typeagent");
        // default installDir is <instanceDir>/installedAgents
        expect(resolved.installDir).toBe(path.join(dir, "installedAgents"));
    });

    it("honors persisted sources and installDir, ignoring legacy order", () => {
        const dir = tmpInstanceDir();
        fs.writeFileSync(
            path.join(dir, "config.json"),
            JSON.stringify({
                installSources: {
                    // Legacy field from an older build; ignored on read.
                    order: ["typeagent", "path"],
                    installDir: "/custom/agents",
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
        const resolved = getResolvedInstallSources(
            getInstanceConfigProvider(dir),
        );
        // The persisted sources array order IS the resolution order; the legacy
        // `order` field has no effect.
        expect(resolved.sources.map((s) => s.name)).toEqual([
            "path",
            "builtin",
        ]);
        expect(resolved.installDir).toBe("/custom/agents");
    });

    it("expands ${ENV} in a persisted installDir", () => {
        const dir = tmpInstanceDir();
        process.env.TA_TEST_INSTALLDIR = "/env/expanded";
        try {
            fs.writeFileSync(
                path.join(dir, "config.json"),
                JSON.stringify({
                    installSources: {
                        installDir: "${TA_TEST_INSTALLDIR}/installedAgents",
                    },
                }),
            );
            const resolved = getResolvedInstallSources(
                getInstanceConfigProvider(dir),
            );
            expect(resolved.installDir).toBe("/env/expanded/installedAgents");
        } finally {
            delete process.env.TA_TEST_INSTALLDIR;
        }
    });
});
