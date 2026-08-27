// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Static validation that the VS Code Shell install option is fully wired into
// the MSI installer: the WiX source declares the property, folder, component,
// custom actions, and sequence entries; and the build script accepts and
// forwards the corresponding VSIX path. These tests do not run WiX itself -
// they defend against silent regressions in the cross-file plumbing that
// would only be caught by a full pipeline build.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import test from "node:test";

const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
const wxs = readFileSync(
    path.resolve(
        scriptsDir,
        "..",
        "..",
        "installers",
        "wix",
        "TypeAgent-AgentServer.wxs",
    ),
    "utf8",
);
const buildMsi = readFileSync(
    path.resolve(scriptsDir, "..", "build-msi.mjs"),
    "utf8",
);
const buildMsiLocal = readFileSync(
    path.resolve(scriptsDir, "..", "build-msi-local.mjs"),
    "utf8",
);
const helper = readFileSync(
    path.resolve(
        scriptsDir,
        "..",
        "..",
        "installers",
        "common",
        "install-vscode-typeagent.ps1",
    ),
    "utf8",
);
const pipeline = readFileSync(
    path.resolve(
        scriptsDir,
        "..",
        "..",
        "..",
        "..",
        "pipelines",
        "azure-build-publish-all.yml",
    ),
    "utf8",
);

test("WiX declares the VSCODESHELL public property with a default of 1", () => {
    assert.match(
        wxs,
        /<Property Id="VSCODESHELL" Value="1" Secure="yes" \/>/,
        "VSCODESHELL property must exist and default to 1",
    );
});

test("MSI UI exposes VSCODESHELL as an installation option", () => {
    assert.match(
        wxs,
        /<Control Id="VsCodeShellCheckBox"[\s\S]*?Property="VSCODESHELL" CheckBoxValue="1"[\s\S]*?Text="Install TypeAgent Shell Extension for VS Code 1\.90 or newer"/,
    );
});

test("WiX declares the VS Code Shell VSIX component and its directory", () => {
    assert.match(wxs, /<Directory Id="VSCODESHELLFOLDER" Name="vscode-shell"/);
    assert.match(
        wxs,
        /<Component Id="VsCodeShellVsixComponent"[\s\S]*?Source="\$\(var\.VsCodeShellVsix\)"/,
    );
    assert.match(wxs, /<ComponentRef Id="VsCodeShellVsixComponent" \/>/);
});

test("WiX registers Install/Uninstall custom actions for the shell", () => {
    for (const id of ["InstallVsCodeShell", "UninstallVsCodeShell"]) {
        assert.match(
            wxs,
            new RegExp(
                `<CustomAction Id="${id}"[\\s\\S]*?BinaryKey="WixCA"`,
                "m",
            ),
            `Missing CustomAction ${id}`,
        );
    }
});

test("Install CA reuses install-vscode-typeagent.ps1 with shell-specific arguments", () => {
    // Locate the SetProperty command line for InstallVsCodeShell.
    const match = wxs.match(
        /<SetProperty Id="InstallVsCodeShell"[\s\S]*?Value="([^"]*)"/,
    );
    assert.ok(match, "InstallVsCodeShell SetProperty must define a command");
    const commandLine = match[1];
    assert.ok(
        commandLine.includes("install-vscode-typeagent.ps1"),
        "Shell install must reuse the shared VSIX helper",
    );
    assert.ok(
        commandLine.includes("typeagent.vscode-shell"),
        "Shell install must pass the vscode-shell ExtensionId",
    );
    assert.ok(
        commandLine.includes("VSCodeShell"),
        "Shell install must use its own HKCU ownership subkey",
    );
    assert.ok(
        commandLine.includes("-NoShortcut"),
        "Shell install must skip the desktop shortcut",
    );
    assert.ok(
        commandLine.includes("1.90.0"),
        "Shell install must gate on the extension's minimum VS Code version",
    );
});

test("Install sequence gates InstallVsCodeShell on VSCODESHELL=1 during fresh install", () => {
    assert.match(
        wxs,
        /<Custom Action="InstallVsCodeShell"[^>]*>\(NOT Installed\) AND \(VSCODESHELL="1"\)<\/Custom>/,
    );
});

test("Uninstall sequence removes the shell before the chat extension", () => {
    const installLine = wxs.indexOf('Action="UninstallVsCodeShell"');
    const chatLine = wxs.indexOf('Action="UninstallVsCodeChat"');
    assert.ok(installLine > 0 && chatLine > 0);
    assert.ok(
        installLine < chatLine,
        "UninstallVsCodeShell must be scheduled before UninstallVsCodeChat",
    );
});

test("build-msi.mjs accepts --vscode-shell-vsix and forwards -dVsCodeShellVsix to candle", () => {
    assert.match(buildMsi, /--vscode-shell-vsix/);
    assert.match(buildMsi, /-dVsCodeShellVsix=\$\{vscodeShellVsixFile\}/);
});

test("build-msi.mjs downloads the typeagent-vscode-shell artifact when not skipped", () => {
    assert.match(buildMsi, /"typeagent-vscode-shell"/);
});

test("build-msi-local.mjs packages vscode-shell and passes the resulting VSIX", () => {
    assert.match(
        buildMsiLocal,
        /path\.join\(tsRoot, "packages", "vscode-shell"\)/,
    );
    assert.match(buildMsiLocal, /"--vscode-shell-vsix",\s*vscodeShellVsix,/);
});

test("install-vscode-typeagent.ps1 exposes -OwnershipKey and -NoShortcut parameters", () => {
    assert.match(
        helper,
        /\[string\]\$OwnershipKey\s*=\s*"HKCU:\\Software\\Microsoft\\TypeAgent\\VSCodeChat"/,
    );
    assert.match(helper, /\[switch\]\$NoShortcut/);
    // Ownership key must actually be used, not just accepted.
    assert.match(helper, /\$ownershipKey\s*=\s*\$OwnershipKey/);
    // Shortcut creation must be skipped when -NoShortcut is set.
    assert.match(helper, /if \(-not \$NoShortcut\) \{/);
});

test("release pipeline packages the shell VSIX and passes it to the MSI build", () => {
    assert.match(pipeline, /pnpm --filter vscode-shell run package/);
    assert.match(pipeline, /artifact: vscode-shell/);
    assert.match(
        pipeline,
        /--vscode-shell-vsix "\$vscodeShellVsix"[\s\S]*?--vscode-shell-version "\$\(packageVersion\)"/,
    );
});

test("release pipeline publishes the shell VSIX as a Universal package", () => {
    assert.match(pipeline, /name: publishVsCodeShell/);
    assert.match(pipeline, /name "typeagent-vscode-shell"/);
});
