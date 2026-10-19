// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";
import { createRequire } from "node:module";
import { verifyShellArtifacts } from "../verify-shell-artifacts.mjs";

const scripts = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
);
const repo = path.resolve(scripts, "..", "..", "..");
const windows = process.platform === "win32";
const installer = "typeagentshell-1.0.0-win32-x64-setup.exe";
const policy = JSON.parse(
    readFileSync(path.join(scripts, "windows-package-trust.json"), "utf8"),
);
const shellRequire = createRequire(
    path.join(repo, "ts", "packages", "shell", "package.json"),
);
const quote = (value) => `'${value.replaceAll("'", "''")}'`;

function importFunctions(file) {
    return `
        $ast = [Management.Automation.Language.Parser]::ParseFile(${quote(file)}, [ref]$null, [ref]$null)
        foreach ($function in $ast.FindAll({ param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] }, $false)) {
            . ([scriptblock]::Create($function.Extent.Text))
        }
    `;
}

function runPowerShell(code) {
    const result = spawnSync(
        path.join(
            process.env.SystemRoot,
            "System32",
            "WindowsPowerShell",
            "v1.0",
            "powershell.exe",
        ),
        [
            "-NoProfile",
            "-NonInteractive",
            "-ExecutionPolicy",
            "Bypass",
            "-EncodedCommand",
            Buffer.from(
                `$ErrorActionPreference = 'Stop'\n${code}`,
                "utf16le",
            ).toString("base64"),
        ],
        {
            encoding: "utf8",
            timeout: 30000,
            env: Object.fromEntries(
                Object.entries(process.env).filter(
                    ([key]) => key.toLowerCase() !== "psmodulepath",
                ),
            ),
        },
    );
    assert.ifError(result.error);
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
}

function fixture(t) {
    const dir = mkdtempSync(path.join(os.tmpdir(), "typeagent trust "));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    const bytes = Buffer.from("isolated non-executable installer fixture");
    writeFileSync(path.join(dir, installer), bytes);
    const sha512 = createHash("sha512").update(bytes).digest("base64");
    const metadata = {
        path: installer,
        sha512,
        files: [{ url: installer, sha512, size: bytes.length }],
    };
    writeFileSync(path.join(dir, "ci-x64.yml"), JSON.stringify(metadata));
    return { dir, metadata };
}

test("publication verifies final hashes, metadata and signatures", (t) => {
    const { dir, metadata } = fixture(t);
    let calls = 0;
    assert.equal(
        verifyShellArtifacts(dir, () => calls++),
        1,
    );
    assert.equal(calls, 1);
    assert.throws(
        () =>
            verifyShellArtifacts(dir, () => {
                throw new Error("wrong publisher");
            }),
        /wrong publisher/,
    );
    writeFileSync(path.join(dir, installer), "tampered");
    assert.throws(() => verifyShellArtifacts(dir, () => {}), /final bytes/);
    metadata.path = "..\\outside.exe";
    writeFileSync(path.join(dir, "ci-x64.yml"), JSON.stringify(metadata));
    assert.throws(
        () => verifyShellArtifacts(dir, () => {}),
        /Unsafe installer/,
    );
});

test("electron-builder validates the required Windows signing and publisher configuration", async () => {
    const builderRequire = createRequire(
        shellRequire.resolve("electron-builder"),
    );
    const { validateConfiguration } = builderRequire(
        "app-builder-lib/out/util/config/config.js",
    );
    const { default: config } = await import(
        pathToFileURL(
            path.join(
                repo,
                "ts",
                "packages",
                "shell",
                "electron-builder.config.js",
            ),
        ).href
    );
    await validateConfiguration(config, null);
    assert.equal(config.forceCodeSigning, windows);
    assert.equal(config.win.verifyUpdateCodeSignature, true);
    assert.equal(config.win.signtoolOptions.publisherName, policy.publisher);
    assert.deepEqual(config.win.signtoolOptions.signingHashAlgorithms, [
        "sha256",
    ]);
    const trustResource = config.extraResources.find(
        (resource) => resource.to === "windows-package-trust",
    );
    assert.ok(trustResource.filter.includes("verify-windows-package.ps1"));
    assert.ok(trustResource.filter.includes("windows-package-trust.json"));
});

test(
    "actual Windows signature API rejects an unsigned fixture",
    { skip: !windows },
    (t) => {
        const { dir } = fixture(t);
        runPowerShell(`
        . ${quote(path.join(scripts, "windows-package-trust.ps1"))}
        $rejected = $false
        try { $s = Open-TypeAgentPackage ${quote(path.join(dir, installer))}; $s.Dispose() }
        catch { $rejected = $_.Exception.Message -like '*Untrusted TypeAgent*' }
        if (-not $rejected) { throw 'Unsigned fixture accepted by actual signature verifier' }
    `);
    },
);

test(
    "actual NSIS updater rejects a checksum-matching unsigned installer",
    { skip: !windows },
    async (t) => {
        const { dir } = fixture(t);
        const { NsisUpdater } = shellRequire("electron-updater");
        const updater = new NsisUpdater(null, { version: "1.0.0" });
        const configPath = path.join(dir, "app-update.yml");
        updater.updateConfigPath = configPath;
        writeFileSync(configPath, `publisherName: ${policy.publisher}\n`);
        let checked = false;
        updater.verifyUpdateCodeSignature = async (
            _publishers,
            packagePath,
        ) => {
            checked = true;
            const result = spawnSync(
                "powershell.exe",
                [
                    "-NoProfile",
                    "-NonInteractive",
                    "-ExecutionPolicy",
                    "Bypass",
                    "-File",
                    path.join(scripts, "verify-windows-package.ps1"),
                    "-Path",
                    packagePath,
                ],
                {
                    encoding: "utf8",
                    env: Object.fromEntries(
                        Object.entries(process.env).filter(
                            ([key]) => key.toLowerCase() !== "psmodulepath",
                        ),
                    ),
                },
            );
            assert.ifError(result.error);
            return result.status === 0 ? null : "untrusted publisher";
        };
        assert.equal(
            await updater.verifySignature(path.join(dir, installer)),
            "untrusted publisher",
        );
        assert.equal(checked, true);
    },
);

for (const status of [
    "NotSigned",
    "HashMismatch",
    "NotTrusted",
    "UnknownError",
]) {
    test(`installer rejects ${status} signatures`, { skip: !windows }, (t) => {
        const { dir } = fixture(t);
        runPowerShell(`
            . ${quote(path.join(scripts, "windows-package-trust.ps1"))}
            function Get-AuthenticodeSignature { return @{ Status = '${status}'; SignerCertificate = $null } }
            $rejected = $false
            try { $s = Open-TypeAgentPackage ${quote(path.join(dir, installer))}; $s.Dispose() }
            catch { $rejected = $_.Exception.Message -like '*Untrusted TypeAgent*' }
            if (-not $rejected) { throw 'Untrusted package accepted' }
        `);
    });
}

test(
    "installer rejects a valid signature from a different publisher or certificate",
    { skip: !windows },
    (t) => {
        const { dir } = fixture(t);
        runPowerShell(`
        . ${quote(path.join(scripts, "windows-package-trust.ps1"))}
        foreach ($cert in @(
            @{ Subject = 'CN=attacker'; Thumbprint = '${policy.thumbprints[0]}' },
            @{ Subject = '${policy.publisher}'; Thumbprint = ('0' * 40) }
        )) {
            function Get-AuthenticodeSignature { return @{ Status = 'Valid'; SignerCertificate = $cert } }
            $rejected = $false
            try { $s = Open-TypeAgentPackage ${quote(path.join(dir, installer))}; $s.Dispose() }
            catch { $rejected = $_.Exception.Message -like '*Untrusted TypeAgent*' }
            if (-not $rejected) { throw 'Wrong publisher accepted' }
        }
    `);
    },
);

test(
    "Install-only revalidates, checks state and holds a write/delete lock through launch",
    { skip: !windows },
    (t) => {
        const { dir } = fixture(t);
        runPowerShell(`
        . ${quote(path.join(scripts, "windows-package-trust.ps1"))}
        ${importFunctions(path.join(scripts, "install-shell.ps1"))}
        function Write-Log {}
        function Fail { param($Message) throw $Message }
        $dest = ${quote(dir)}
        $statePath = Join-Path $dest 'install-state.json'
        $packagePath = Join-Path $dest '${installer}'
        function Get-AuthenticodeSignature { return @{ Status = 'Valid'; SignerCertificate = @{
            Subject = '${policy.publisher}'; Thumbprint = '${policy.thumbprints[0]}' } } }
        $script:launches = 0
        function Start-Process {
            param($FilePath, $ArgumentList, [switch]$Wait, [switch]$PassThru)
            $blocked = $false
            try { [IO.File]::WriteAllText($FilePath, 'replacement') } catch { $blocked = $true }
            if (-not $blocked) { throw 'Package was writable during launch' }
            $script:launches++
            return @{ ExitCode = 0 }
        }
        @{packagePath=$packagePath;sha512=(Get-FileHash $packagePath -Algorithm SHA512).Hash} |
            ConvertTo-Json | Set-Content $statePath
        Install-ShellPayload
        if ($script:launches -ne 1) { throw 'Trusted fixture did not launch' }
        [IO.File]::WriteAllText($packagePath, 'replaced after Download')
        $rejected = $false
        try { Install-ShellPayload } catch { $rejected = $_.Exception.Message -like '*changed after Download*' }
        if (-not $rejected -or $script:launches -ne 1) { throw 'Replaced package launched' }
        @{packagePath='C:\\outside.exe';sha512='untrusted'} | ConvertTo-Json | Set-Content $statePath
        $rejected = $false
        try { Install-ShellPayload } catch { $rejected = $_.Exception.Message -like '*outside the expected*' }
        if (-not $rejected) { throw 'Outside state path accepted' }
    `);
    },
);

test(
    "metadata rejects traversal, URLs, ADS, separators and unexpected executables",
    { skip: !windows },
    (t) => {
        const { dir } = fixture(t);
        runPowerShell(`
        ${importFunctions(path.join(scripts, "install-shell.ps1"))}
        function Fail { param($Message) throw $Message }
        $yml = ${quote(path.join(dir, "input.yml"))}
        foreach ($value in @('../evil.exe', '..\\evil.exe', 'C:\\evil.exe', '\\\\host\\evil.exe',
            'https://host/evil.exe', 'file:evil.exe', 'setup.exe:evil', 'random.exe')) {
            Set-Content $yml "path: $value"
            $rejected = $false
            try { Get-PackagePathFromYml $yml | Out-Null } catch { $rejected = $true }
            if (-not $rejected) { throw "Accepted metadata: $value" }
        }
        Set-Content $yml 'path: ${installer}'
        if ((Get-PackagePathFromYml $yml) -ne '${installer}') { throw 'Valid path rejected' }
        function Invoke-WebRequest { throw 'Insecure request reached network' }
        $BlobBaseUrl = 'http://untrusted.test/container'
        $rejected = $false
        try { Get-BlobFile -Name channel.yml -Destination $yml -Anonymous }
        catch { $rejected = $_.Exception.Message -like '*absolute HTTPS*' }
        if (-not $rejected) { throw 'Insecure transport accepted' }
    `);
    },
);

for (const source of ["az-blob", "feed", "anon-blob"]) {
    test(
        `Download verifies trusted fixtures from ${source}`,
        { skip: !windows },
        (t) => {
            const { dir } = fixture(t);
            runPowerShell(`
            . ${quote(path.join(scripts, "windows-package-trust.ps1"))}
            ${importFunctions(path.join(scripts, "install-shell.ps1"))}
            $dest = ${quote(path.join(dir, "download"))}
            $statePath = Join-Path $dest 'install-state.json'
            $Storage = ''; $Feed = ''; $FeedPackage = ''; $BlobBaseUrl = ''; $Channel = 'ci'
            ${source === "feed" ? "$Feed='feed';$FeedPackage='shell'" : source === "az-blob" ? "$Storage='storage'" : "$BlobBaseUrl='https://fixture.test'"}
            function Confirm-AgentServer {}
            function Get-Arch { 'x64' }
            function Write-Log {}
            function Fail { param($Message) throw $Message }
            function Get-AuthenticodeSignature { return @{ Status = 'Valid'; SignerCertificate = @{
                Subject = '${policy.publisher}'; Thumbprint = '${policy.thumbprints[0]}' } } }
            function Write-Fixture {
                Copy-Item ${quote(path.join(dir, installer))} (Join-Path $dest '${installer}')
                $hash = [Convert]::ToBase64String([Security.Cryptography.SHA512]::Create().ComputeHash(
                    [IO.File]::ReadAllBytes((Join-Path $dest '${installer}'))))
                Set-Content (Join-Path $dest 'ci-x64.yml') "path: ${installer}\`nsha512: $hash"
            }
            function Get-BlobFile { param($Name,$Destination,[switch]$Anonymous) Write-Fixture }
            function Get-ShellFromFeed { param($Destination) Write-Fixture }
            Download-ShellPayload
            if (-not (Test-Path $statePath)) { throw 'Download state missing' }
            function Get-AuthenticodeSignature { return @{ Status = 'NotSigned'; SignerCertificate = $null } }
            $rejected = $false
            try { Download-ShellPayload } catch { $rejected = $true }
            if (-not $rejected) { throw 'Unsigned download accepted' }
        `);
        },
    );
}

test(
    "legacy launcher validates before per-user install and never changes trust or uninstalls",
    { skip: !windows },
    (t) => {
        const { dir } = fixture(t);
        const launcher = path.join(
            repo,
            "dotnet",
            "agentLauncher",
            "src",
            "Install.ps1",
        );
        runPowerShell(`
        ${importFunctions(launcher)}
        function Test-IsAdministrator { $false }
        function Import-PfxCertificate { throw 'Unexpected trust change' }
        function Import-Certificate { throw 'Unexpected trust change' }
        function Remove-AppxPackage { throw 'Unexpected uninstall' }
        function Start-Process { throw 'Unexpected elevation' }
        $PackagePath = ${quote(path.join(dir, "launcher.msix"))}
        $ExpectedSignerThumbprint = '1111111111111111111111111111111111111111'
        Add-Type -AssemblyName System.IO.Compression
        $stream = [IO.File]::Create($PackagePath)
        $archive = New-Object IO.Compression.ZipArchive($stream, [IO.Compression.ZipArchiveMode]::Create)
        $entry = $archive.CreateEntry('AppxManifest.xml')
        $writer = New-Object IO.StreamWriter($entry.Open())
        $writer.Write('<Package><Identity Name="TypeAgent.AgentLauncher" Publisher="CN=TypeAgent" /></Package>')
        $writer.Dispose(); $archive.Dispose(); $stream.Dispose()
        $script:installs = 0
        function Add-AppxPackage { param($Path) $script:installs++ }
        function Get-AppxPackage { return @{ Version = '1.0.0.0' } }
        function Get-AuthenticodeSignature { return @{Status='Valid';SignerCertificate=@{
            Subject='CN=TypeAgent';Thumbprint=$ExpectedSignerThumbprint}} }
        Install-AgentLauncher
        if ($script:installs -ne 1) { throw 'Trusted launcher did not install' }
        function Get-AuthenticodeSignature { return @{Status='NotSigned';SignerCertificate=$null} }
        $rejected = $false
        try { Install-AgentLauncher } catch { $rejected = $true }
        if (-not $rejected -or $script:installs -ne 1) { throw 'Invalid launcher installed' }
        $PackagePath = Join-Path (Split-Path $PackagePath) 'missing.msix'
        $rejected = $false
        try { Install-AgentLauncher } catch { $rejected = $true }
        if (-not $rejected -or $script:installs -ne 1) { throw 'Missing launcher installed' }
    `);
    },
);

test("pipeline gates signing before staging and verifies before both publication sinks", () => {
    const pipeline = readFileSync(
        path.join(repo, "pipelines", "azure-build-publish-all.yml"),
        "utf8",
    );
    const build = pipeline.slice(
        pipeline.indexOf("- job: build_shell"),
        pipeline.indexOf("- job: build_shell_mac"),
    );
    assert.ok(
        build.indexOf("package-signed-shell.ps1") <
            build.indexOf("artifact: shell-win"),
    );
    const publish = pipeline.slice(
        pipeline.indexOf("- deployment: publish_shell"),
        pipeline.indexOf("- job: build_sign_publish_msi"),
    );
    const gate = publish.indexOf("verify-shell-publication.ps1");
    assert.ok(gate > 0 && gate < publish.indexOf("AzureFileCopy@6"));
    assert.ok(gate < publish.indexOf("az artifacts universal publish"));
    assert.doesNotMatch(publish.slice(0, gate), /continueOnError:\s*true/);
    const parsed = shellRequire("js-yaml").load(pipeline);
    const jobs = parsed.stages.flatMap((stage) => stage.jobs ?? []);
    const shellBuild = jobs.find((job) => job.job === "build_shell");
    const signing = shellBuild.steps.find(
        (step) => step.displayName === "Sign, package and verify Windows shell",
    );
    assert.equal(signing.task, "AzureCLI@2");
    assert.equal(
        signing.inputs.scriptPath,
        "$(buildDirectory)/tools/scripts/package-signed-shell.ps1",
    );
    assert.notEqual(signing.continueOnError, true);
    const deployment = jobs.find((job) => job.deployment === "publish_shell");
    assert.match(deployment.condition, /succeeded\(\)/);
    const steps = deployment.strategy.runOnce.deploy.steps;
    const verifyIndex = steps.findIndex(
        (step) =>
            step.displayName ===
            "Verify signed Windows shell before publication",
    );
    assert.ok(verifyIndex > 0);
    assert.ok(
        verifyIndex <
            steps.findIndex((step) => step.task === "AzureFileCopy@6"),
    );
    assert.ok(
        verifyIndex <
            steps.findIndex(
                (step) =>
                    step.displayName === "Publish shell-win to Universal feed",
            ),
    );
});

test("MSI installs both shared trust files alongside the phased shell installer", () => {
    const wix = readFileSync(
        path.join(
            repo,
            "ts",
            "tools",
            "installers",
            "wix",
            "TypeAgent-AgentServer.wxs",
        ),
        "utf8",
    );
    for (const id of ["WindowsPackageTrustPs1", "WindowsPackageTrustJson"]) {
        assert.ok(wix.includes(`<ComponentRef Id="${id}Component" />`));
        assert.ok(wix.includes(`<File Id="${id}"`));
    }
});
