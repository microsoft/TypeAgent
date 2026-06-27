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
        // path + builtin + typeagent are always present; order ends with the feed
        expect(resolved.order).toContain("path");
        expect(resolved.order).toContain("builtin");
        expect(resolved.order).toContain("typeagent");
        expect(resolved.order[0]).toBe("path");
        const names = resolved.sources.map((s) => s.name).sort();
        expect(names).toEqual(
            expect.arrayContaining(["builtin", "path", "typeagent"]),
        );
        // default installDir is <instanceDir>/installedAgents
        expect(resolved.installDir).toBe(path.join(dir, "installedAgents"));
    });

    it("honors a persisted override for order, sources, and installDir", () => {
        const dir = tmpInstanceDir();
        fs.writeFileSync(
            path.join(dir, "config.json"),
            JSON.stringify({
                installSources: {
                    order: ["path"],
                    installDir: "/custom/agents",
                    sources: [{ kind: "path", name: "path" }],
                },
            }),
        );
        const resolved = getResolvedInstallSources(
            getInstanceConfigProvider(dir),
        );
        expect(resolved.order).toEqual(["path"]);
        expect(resolved.sources).toEqual([{ kind: "path", name: "path" }]);
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
