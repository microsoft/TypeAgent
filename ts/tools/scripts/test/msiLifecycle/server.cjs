// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const { spawn } = require("node:child_process");

const payload = path.dirname(__dirname);
if (fs.existsSync(path.join(payload, "..", ".msi-maintenance")))
    process.exit(1);
const version = fs
    .readFileSync(path.join(payload, "version.txt"), "utf8")
    .trim();
const lockFile = path.join(payload, "locked.dat").replaceAll("'", "''");
// Hold an actual non-delete-sharing Windows handle in a captured child.
const child = spawn(
    "powershell.exe",
    [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        `$f=[IO.File]::Open('${lockFile}','Open','Read','Read'); Write-Output 'LOCKED'; Start-Sleep -Seconds 1800`,
    ],
    { windowsHide: true, stdio: ["ignore", "pipe", "inherit"] },
);
child.once("error", (error) => {
    console.error(error);
    process.exit(1);
});
child.stdout.once("data", () => {
    const server = http.createServer((request, response) => {
        response.setHeader("Content-Type", "application/json");
        response.end(
            JSON.stringify({ version, pid: process.pid, child: child.pid }),
        );
        if (request.url === "/stop") {
            server.close(() => process.exit(0));
            // The orphan deliberately survives so maintenance must stop it.
            setTimeout(() => process.exit(0), 100).unref();
        }
    });
    server.listen(18999, "127.0.0.1");
});
