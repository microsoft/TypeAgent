// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const workspaceRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
    "..",
);
const tag = `typeagent-api-smoke-${process.pid}`;
const smokeTag = `${tag}-runner`;
const sentinels = [
    "graph-secret-sentinel",
    "cosmos-key-sentinel",
    "speech-key-sentinel",
    "unrelated-api-key-sentinel",
];

function run(command, args, options = {}) {
    const result = spawnSync(command, args, {
        cwd: workspaceRoot,
        encoding: "utf8",
        stdio: options.capture ? "pipe" : "inherit",
        timeout: options.timeout ?? 20 * 60 * 1000,
    });
    if (result.error) {
        throw result.error;
    }
    return result;
}

const dockerInfo = run("docker", ["info"], {
    capture: true,
    timeout: 30_000,
});
if (dockerInfo.status !== 0) {
    console.error(
        "Docker is installed but its engine is unavailable; container smoke was not run.",
    );
    process.exit(2);
}

try {
    assert.equal(
        run("docker", [
            "build",
            "--target",
            "api",
            "--tag",
            tag,
            "--file",
            "Dockerfile",
            ".",
        ]).status,
        0,
        "production image build failed",
    );
    assert.equal(
        run("docker", [
            "build",
            "--target",
            "api-smoke",
            "--tag",
            smokeTag,
            "--file",
            "Dockerfile",
            ".",
        ]).status,
        0,
        "smoke image build failed",
    );

    const imageUser = run(
        "docker",
        ["image", "inspect", "--format", "{{.Config.User}}", tag],
        { capture: true },
    );
    assert.equal(imageUser.status, 0);
    assert.equal(imageUser.stdout.trim(), "typeagent");

    for (const sentinel of sentinels) {
        const fileScan = run(
            "docker",
            [
                "run",
                "--rm",
                "--entrypoint",
                "grep",
                tag,
                "-R",
                "-F",
                "-l",
                sentinel,
                "/prod/api",
            ],
            { capture: true },
        );
        assert.equal(
            fileScan.status,
            1,
            `unrelated sentinel found in production runtime files: ${sentinel}`,
        );
    }

    const smoke = run(
        "docker",
        [
            "run",
            "--rm",
            "--env",
            "TYPEAGENT_API_CONFIG_VAULT=offline-smoke-vault",
            smokeTag,
        ],
        { capture: true, timeout: 120_000 },
    );
    assert.equal(
        smoke.status,
        0,
        `container smoke failed:\n${smoke.stdout}\n${smoke.stderr}`,
    );
    assert.match(smoke.stdout, /API container smoke passed/);
    const smokeOutput = `${smoke.stdout}\n${smoke.stderr}`;
    for (const sentinel of sentinels) {
        assert.equal(
            smokeOutput.includes(sentinel),
            false,
            `unrelated sentinel leaked to container logs: ${sentinel}`,
        );
    }

    const missing = run("docker", ["run", "--rm", tag], {
        capture: true,
        timeout: 30_000,
    });
    assert.notEqual(missing.status, 0);
    assert.doesNotMatch(
        `${missing.stdout}\n${missing.stderr}`,
        /Listening at|WebSocket server started/,
    );

    console.log("API production container checks passed.");
} finally {
    run("docker", ["image", "rm", "--force", smokeTag, tag], {
        capture: true,
        timeout: 60_000,
    });
}
