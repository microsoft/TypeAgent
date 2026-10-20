// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

function workspaceRoot(): string {
    let current = path.dirname(fileURLToPath(import.meta.url));
    while (path.dirname(current) !== current) {
        if (
            fs.existsSync(path.join(current, "pnpm-workspace.yaml")) &&
            fs.existsSync(path.join(current, "Dockerfile"))
        ) {
            return current;
        }
        current = path.dirname(current);
    }
    throw new Error("Could not locate TypeAgent workspace root.");
}

describe("production API image definition", () => {
    const root = workspaceRoot();
    const dockerfile = fs.readFileSync(path.join(root, "Dockerfile"), "utf8");
    const startScript = fs.readFileSync(
        path.join(root, "packages", "api", "container", "start.sh"),
        "utf8",
    );
    const packageJson = JSON.parse(
        fs.readFileSync(
            path.join(root, "packages", "api", "package.json"),
            "utf8",
        ),
    ) as { files?: string[] };
    const runtimeImage = dockerfile.slice(
        dockerfile.indexOf("FROM runtime-base AS api"),
    );

    test("runs as the dedicated account without Azure CLI bootstrap", () => {
        expect(runtimeImage).toContain("USER typeagent");
        expect(runtimeImage).not.toContain("az login");
        expect(runtimeImage).not.toContain("getKeys.mjs");
        expect(runtimeImage).not.toContain("/prod/tools");
        expect(runtimeImage).not.toContain("InstallAzureCLIDeb");
        expect(runtimeImage).not.toContain("pnpm start");
    });

    test("uses the checked-in fail-fast startup script", () => {
        expect(runtimeImage).toContain(
            'CMD ["/usr/local/bin/typeagent-api-start"]',
        );
        expect(startScript).toContain("set -euo pipefail");
        expect(startScript).toContain('"$(id -u)" -eq 0');
        expect(startScript).toContain("${HOME:?HOME must be set}/.azure");
        expect(startScript).toContain("exec node ./dist/index.js");
    });

    test("selects the dedicated managed-identity bootstrap", () => {
        expect(runtimeImage).toContain(
            "TYPEAGENT_API_BOOTSTRAP=hosted-azure-managed-identity-v1",
        );
        expect(runtimeImage).toContain(
            "TYPEAGENT_API_CONFIG_SECRET=typeagent-api-hosted-config",
        );
        expect(runtimeImage).toContain(
            "TYPEAGENT_USER_DATA_DIR=/home/typeagent/.typeagent",
        );
    });

    test("excludes source and test fixtures from the production deploy", () => {
        expect(packageJson.files).toEqual(["dist", "!dist/test", "data"]);
    });
});
