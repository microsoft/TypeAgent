// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

interface DockerStage {
    readonly base: string;
    readonly name: string;
    readonly body: string;
}

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

function parseDockerStages(dockerfile: string): DockerStage[] {
    const matches = [
        ...dockerfile.matchAll(/^FROM\s+(\S+)(?:\s+AS\s+(\S+))?\s*$/gim),
    ];
    return matches.map((match, index) => ({
        base: match[1],
        name: match[2] ?? "",
        body: dockerfile.slice(
            match.index,
            matches[index + 1]?.index ?? dockerfile.length,
        ),
    }));
}

describe("production API image definition", () => {
    const root = workspaceRoot();
    const dockerfile = fs.readFileSync(path.join(root, "Dockerfile"), "utf8");
    const stages = parseDockerStages(dockerfile);
    const stage = (name: string): DockerStage => {
        const match = stages.find((candidate) => candidate.name === name);
        if (match === undefined) {
            throw new Error(`Docker stage '${name}' is missing.`);
        }
        return match;
    };
    const apiImage = stage("api");
    const smokeImage = stage("api-smoke");
    const defaultImage = stages.at(-1);
    const startScript = fs.readFileSync(
        path.join(root, "packages", "api", "container", "start.sh"),
        "utf8",
    );
    const smokeScript = fs.readFileSync(
        path.join(root, "packages", "api", "container", "smoke.mjs"),
        "utf8",
    );
    const packageJson = JSON.parse(
        fs.readFileSync(
            path.join(root, "packages", "api", "package.json"),
            "utf8",
        ),
    ) as { files?: string[] };
    const deploymentPipeline = fs.readFileSync(
        path.join(root, "..", "pipelines", "azure-build-docker-container.yml"),
        "utf8",
    );
    const acrBuildTask = fs.readFileSync(
        path.join(root, "acr-build.yaml"),
        "utf8",
    );

    test("runs as the dedicated account without Azure CLI bootstrap", () => {
        expect(apiImage.body).toContain("USER typeagent");
        expect(apiImage.body).not.toContain("az login");
        expect(apiImage.body).not.toContain("getKeys.mjs");
        expect(apiImage.body).not.toContain("/prod/tools");
        expect(apiImage.body).not.toContain("InstallAzureCLIDeb");
        expect(apiImage.body).not.toContain("pnpm start");
    });

    test("uses the checked-in fail-fast startup script", () => {
        expect(apiImage.body).toContain(
            'CMD ["/usr/local/bin/typeagent-api-start"]',
        );
        expect(startScript).toContain("set -euo pipefail");
        expect(startScript).toContain('"$(id -u)" -eq 0');
        expect(startScript).toContain("${HOME:?HOME must be set}/.azure");
        expect(startScript).toContain("exec node ./dist/index.js");
    });

    test("selects the dedicated managed-identity bootstrap", () => {
        expect(apiImage.body).toContain(
            "TYPEAGENT_API_BOOTSTRAP=hosted-azure-managed-identity-v1",
        );
        expect(apiImage.body).toContain(
            "TYPEAGENT_API_CONFIG_SECRET=typeagent-api-hosted-config",
        );
        expect(apiImage.body).toContain(
            "TYPEAGENT_USER_DATA_DIR=/home/typeagent/.typeagent",
        );
        expect(apiImage.body).not.toContain("TYPEAGENT_AZURE_AUTH_MODE");
    });

    test("keeps production as the targetless deployment image", () => {
        expect(defaultImage).toMatchObject({
            base: "api",
            name: "production",
        });
        expect(defaultImage?.body).not.toContain("container/smoke.mjs");
        expect(defaultImage?.body).not.toContain("container-smoke.mjs");
        expect(apiImage.body).not.toContain("container/smoke.mjs");
        expect(deploymentPipeline).toContain("az acr run");
        expect(acrBuildTask).toContain("-f Dockerfile .");
        expect(acrBuildTask).not.toContain("--target");
    });

    test("installs the smoke harness where its runtime imports resolve", () => {
        const copy = smokeImage.body.match(
            /COPY packages\/api\/container\/smoke\.mjs\s+(\S+)/,
        );
        expect(copy).not.toBeNull();
        const installedPath = copy?.[1] as string;
        expect(smokeImage.body).toContain(`CMD ["node", "${installedPath}"]`);

        const localImports = [
            ...smokeScript.matchAll(/from "(\.\.\/dist\/[^"]+)"/g),
        ].map((match) => match[1]);
        expect(localImports.length).toBeGreaterThan(0);
        for (const specifier of localImports) {
            expect(
                path.posix.resolve(
                    path.posix.dirname(installedPath),
                    specifier,
                ),
            ).toMatch(/^\/prod\/api\/dist\//);
        }
    });

    test("excludes source and test fixtures from the production deploy", () => {
        expect(packageJson.files).toEqual(["dist", "!dist/test", "data"]);
    });
});
