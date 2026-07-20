// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import fs from "node:fs";
import path from "node:path";

const location = process.argv[2];
if (!location) {
    console.error("ERROR: No location provided.");
}

const fullLocation = path.resolve(location);
if (!fs.existsSync(fullLocation) || !fs.statSync(fullLocation).isDirectory()) {
    console.error(`ERROR: Invalid location ${location} provided.`);
    process.exit(1);
}

const binBaseName = "build-extension";
const dest = path.join(fullLocation, "node_modules", ".bin");
const nodeBin = process.execPath;
if (process.platform === "win32") {
    // Windows script
    const script = [
        `@echo off`,
        `"${nodeBin}" "${path.join(fullLocation, "scripts", "buildExtension.mjs")}" %*`,
    ];
    await fs.promises.writeFile(
        path.join(dest, `${binBaseName}.cmd`),
        script.join("\n"),
        "utf8",
    );
} else {
    // Linux/MacOS script
    const script = [
        `#!/bin/bash`,
        `"${nodeBin}" "${path.join(fullLocation, "scripts", "buildExtension.mjs")}" "$@"`,
    ];
    const outfile = path.join(dest, binBaseName);
    await fs.promises.writeFile(outfile, script.join("\n"), "utf8");
    await fs.promises.chmod(
        outfile,
        0o755, // Make it executable
    );
}
