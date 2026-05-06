#!/usr/bin/env node
// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Fetches the TypeAgent dev code-signing cert from Azure Key Vault and
// installs it into the local Windows certificate store. Companion to
// getKeys.mjs (string secrets); this script handles the X.509 cert + its
// auto-generated PFX password.
//
// Subcommands:
//   pull     — fetch cert from Key Vault, generate/store PFX password,
//              re-encrypt PFX with that password, save to local PFX path.
//   install  — pull + Import-PfxCertificate into CurrentUser\My and
//              CurrentUser\TrustedPeople. --trusted-root also installs
//              into CurrentUser\Root for self-signed cert trust (one-time
//              UAC/confirm prompt).
//   status   — show whether cert / password exist in vault, whether PFX is
//              on disk, and whether the cert is in the relevant local stores.
//
// Cert/vault names live in getKeys.config.json under the "cert" key. Default
// cert name: TypeAgent-Development-Certificate; default vault: aisystems.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import chalk from "chalk";
import { DefaultAzureCredential } from "@azure/identity";
import { SecretClient } from "@azure/keyvault-secrets";
import { CertificateClient } from "@azure/keyvault-certificates";
import { getAzCliLoggedInInfo } from "./lib/azureUtils.mjs";

const require = createRequire(import.meta.url);
const config = require("./getKeys.config.json");

if (!config.cert) {
    console.error(
        chalk.red("FATAL: getKeys.config.json is missing the 'cert' section."),
    );
    process.exit(1);
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Resolve ~/<rest> to the user's home dir.
function expandHome(p) {
    return p.startsWith("~") ? path.join(os.homedir(), p.slice(1)) : p;
}

const certVaultName = config.cert.vault;
const certName = config.cert.name;
const passwordSecretName = config.cert.passwordSecretName;
const localPfxPath = path.resolve(expandHome(config.cert.localPfxPath));

let paramTrustedRoot = false;
let paramVerbose = false;

function vlog(msg) {
    if (paramVerbose) console.log(chalk.gray(`  ${msg}`));
}

// ---------------------------------------------------------------------------
// Azure clients
// ---------------------------------------------------------------------------

async function getCredential() {
    try {
        await getAzCliLoggedInInfo();
    } catch {
        console.error(
            chalk.red(
                "ERROR: Not logged in to Azure CLI. Run 'az login' first.",
            ),
        );
        process.exit(1);
    }
    return new DefaultAzureCredential();
}

function vaultUrl(vault) {
    return `https://${vault}.vault.azure.net`;
}

// ---------------------------------------------------------------------------
// PowerShell helpers — cert manipulation is much cleaner via Windows APIs
// than wrestling with node-forge for PKCS12 re-encryption. We're Windows-only
// for this whole flow anyway.
// ---------------------------------------------------------------------------

function runPowerShell(
    script,
    { ignoreExitCode = false, interactive = false } = {},
) {
    const args = [
        "-NoProfile",
        // Interactive mode preserves the parent's stdin/stdout/stderr so any
        // OS-level prompt (e.g. trust-this-CA dialog when importing into
        // Cert:\...\Root) can be answered. Non-interactive blocks them with
        // "UI is not allowed in this operation." Most ops are fine
        // non-interactive; trust-store imports are not.
        ...(interactive ? [] : ["-NonInteractive"]),
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        script,
    ];
    const result = spawnSync("powershell.exe", args, {
        encoding: "utf8",
        stdio: interactive ? "inherit" : "pipe",
    });
    if (result.error) throw result.error;
    if (!ignoreExitCode && result.status !== 0) {
        throw new Error(
            `PowerShell command failed (code ${result.status}): ${result.stderr || result.stdout}`,
        );
    }
    return {
        stdout: (result.stdout ?? "").trim(),
        stderr: (result.stderr ?? "").trim(),
        code: result.status,
    };
}

// Re-encrypts a PFX with a new password. Reads sourcePath, writes destPath.
// sourcePassword may be empty (Key Vault returns unprotected PFX).
function reencryptPfx(sourcePath, sourcePassword, destPath, destPassword) {
    // Use Get-PfxData + Export-PfxCertificate. Export-PfxCertificate writes
    // a PFX with the new password; Get-PfxData reads with the old one.
    const ps = `
        $srcPwd = ConvertTo-SecureString -String '${escapePsString(sourcePassword)}' -AsPlainText -Force
        $dstPwd = ConvertTo-SecureString -String '${escapePsString(destPassword)}' -AsPlainText -Force
        $data = Get-PfxData -FilePath '${escapePsString(sourcePath)}' -Password $srcPwd
        $cert = $data.EndEntityCertificates[0]
        $thumb = $cert.Thumbprint
        # Round-trip via the cert store: import temporarily so we have a key handle,
        # then export with the new password, then remove.
        $imported = Import-PfxCertificate -FilePath '${escapePsString(sourcePath)}' -Password $srcPwd -CertStoreLocation Cert:\\CurrentUser\\My -Exportable
        try {
            Export-PfxCertificate -Cert $imported -FilePath '${escapePsString(destPath)}' -Password $dstPwd -Force | Out-Null
        } finally {
            Remove-Item -Path "Cert:\\CurrentUser\\My\\$thumb" -Force -ErrorAction SilentlyContinue
        }
        Write-Output $thumb
    `;
    const { stdout } = runPowerShell(ps);
    return stdout.trim();
}

function escapePsString(s) {
    // Single-quoted PowerShell strings: escape single quotes by doubling.
    return String(s).replace(/'/g, "''");
}

// ---------------------------------------------------------------------------
// Pull: fetch cert from KV, generate password if needed, re-encrypt + save.
// ---------------------------------------------------------------------------

async function pull() {
    const credential = await getCredential();
    const secretClient = new SecretClient(vaultUrl(certVaultName), credential);
    const certClient = new CertificateClient(
        vaultUrl(certVaultName),
        credential,
    );

    // 1. Fetch the cert from Key Vault. Stored certs are also exposed as
    // secrets — the secret form is the PFX (base64) without password protection.
    console.log(
        `Fetching cert ${chalk.cyanBright(certName)} from vault ${chalk.cyanBright(certVaultName)}…`,
    );
    let pfxBase64;
    try {
        const secret = await secretClient.getSecret(certName);
        pfxBase64 = secret.value;
    } catch (e) {
        console.error(
            chalk.red(
                `Failed to fetch cert '${certName}' from vault '${certVaultName}': ${e.message}`,
            ),
        );
        process.exit(1);
    }
    if (!pfxBase64) {
        console.error(
            chalk.red(
                `Cert '${certName}' returned an empty value from the vault.`,
            ),
        );
        process.exit(1);
    }
    vlog(`fetched ${pfxBase64.length} chars of base64 PFX`);

    // 2. Get-or-create the PFX password secret.
    let password;
    try {
        const passwordSecret = await secretClient.getSecret(passwordSecretName);
        password = passwordSecret.value;
        console.log(
            `Reusing existing PFX password secret ${chalk.cyanBright(passwordSecretName)}.`,
        );
    } catch (e) {
        if (e?.statusCode !== 404) throw e;
        password = generatePassword();
        console.log(
            `Creating new PFX password secret ${chalk.cyanBright(passwordSecretName)} in vault.`,
        );
        await secretClient.setSecret(passwordSecretName, password);
    }

    // 3. Save unprotected PFX to a temp file, then re-encrypt to the local path.
    await fs.promises.mkdir(path.dirname(localPfxPath), { recursive: true });
    const tmpPath = path.join(os.tmpdir(), `typeagent-cert-${process.pid}.pfx`);
    try {
        await fs.promises.writeFile(tmpPath, Buffer.from(pfxBase64, "base64"));
        const thumbprint = reencryptPfx(tmpPath, "", localPfxPath, password);
        console.log(
            `Wrote password-protected PFX to ${chalk.cyanBright(localPfxPath)}`,
        );
        console.log(`  Thumbprint: ${chalk.cyanBright(thumbprint)}`);
        return { thumbprint };
    } finally {
        await fs.promises.unlink(tmpPath).catch(() => {});
    }

    // Note: cert metadata (thumbprint via certClient) is also available, but
    // we get it as a side-effect of the re-encryption above so don't re-fetch.
    void certClient;
}

function generatePassword() {
    // 32 random URL-safe characters. Plenty for a PFX wrapper key.
    return crypto.randomBytes(24).toString("base64url");
}

// ---------------------------------------------------------------------------
// Install: pull + import into local cert store.
// ---------------------------------------------------------------------------

async function install() {
    const { thumbprint } = await pull();

    const credential = await getCredential();
    const secretClient = new SecretClient(vaultUrl(certVaultName), credential);
    const password = (await secretClient.getSecret(passwordSecretName)).value;

    // Cert:\CurrentUser\My — needs the private key (we sign with this), so
    // import the PFX with its password. -Exportable keeps the key extractable
    // for signtool flows that prefer a fresh PFX export.
    console.log("\nImporting into CurrentUser\\My (private key)…");
    runPowerShell(`
        $pwd = ConvertTo-SecureString -String '${escapePsString(password)}' -AsPlainText -Force
        Import-PfxCertificate -FilePath '${escapePsString(localPfxPath)}' -Password $pwd -CertStoreLocation Cert:\\CurrentUser\\My -Exportable | Out-Null
    `);

    // For trust stores (TrustedPeople and Root), we only need the public
    // cert. Microsoft's recommended pattern: export a .cer alongside the PFX
    // and Import-Certificate that. This is more secure (no private key in
    // trust stores) and avoids extra prompts on trusted-store imports.
    const cerPath = path.join(
        path.dirname(localPfxPath),
        path.basename(localPfxPath, ".pfx") + ".cer",
    );
    console.log(`Exporting public cert to ${chalk.cyanBright(cerPath)}…`);
    runPowerShell(`
        $cert = Get-Item Cert:\\CurrentUser\\My\\${escapePsString(thumbprint)}
        Export-Certificate -Cert $cert -FilePath '${escapePsString(cerPath)}' -Type CERT -Force | Out-Null
    `);

    console.log("Importing into CurrentUser\\TrustedPeople (public)…");
    runPowerShell(`
        Import-Certificate -FilePath '${escapePsString(cerPath)}' -CertStoreLocation Cert:\\CurrentUser\\TrustedPeople | Out-Null
    `);

    if (paramTrustedRoot) {
        // Importing a self-signed cert into Root triggers a Windows
        // confirmation prompt ("Are you sure you want to install this
        // certificate?"). Run interactively so the prompt can be answered;
        // -NonInteractive throws "UI is not allowed in this operation."
        console.log(
            chalk.yellow(
                "\nImporting into CurrentUser\\Root (Windows will prompt for confirmation; click Yes)…",
            ),
        );
        runPowerShell(
            `
            Import-Certificate -FilePath '${escapePsString(cerPath)}' -CertStoreLocation Cert:\\CurrentUser\\Root | Out-Null
            `,
            { interactive: true },
        );
    }

    console.log(
        `\n${chalk.green("Done.")} Cert thumbprint: ${chalk.cyanBright(thumbprint)}`,
    );
    console.log(
        `Sign with:  ${chalk.gray(`signtool sign /sha1 ${thumbprint} /fd SHA256 <file>`)}`,
    );
    if (!paramTrustedRoot) {
        console.log(
            chalk.gray(
                "Note: pass --trusted-root once if you also need TrustedRoot install (required for self-signed MSIX trust).",
            ),
        );
    }
}

// ---------------------------------------------------------------------------
// Status: report what's in the vault / on disk / in the local cert stores.
// ---------------------------------------------------------------------------

async function status() {
    const credential = await getCredential();
    const secretClient = new SecretClient(vaultUrl(certVaultName), credential);

    console.log(`Vault: ${chalk.cyanBright(certVaultName)}`);

    let inVault = false;
    try {
        await secretClient.getSecret(certName);
        inVault = true;
    } catch (e) {
        if (e?.statusCode !== 404) throw e;
    }
    console.log(
        `  cert  '${certName}': ${inVault ? chalk.green("present") : chalk.red("missing")}`,
    );

    let pwInVault = false;
    let pfxPassword;
    try {
        const secret = await secretClient.getSecret(passwordSecretName);
        pwInVault = true;
        pfxPassword = secret.value;
    } catch (e) {
        if (e?.statusCode !== 404) throw e;
    }
    console.log(
        `  pwd   '${passwordSecretName}': ${pwInVault ? chalk.green("present") : chalk.yellow("missing (will be generated on next pull)")}`,
    );

    console.log(`\nLocal: ${chalk.cyanBright(localPfxPath)}`);
    const onDisk = fs.existsSync(localPfxPath);
    console.log(
        `  PFX file: ${onDisk ? chalk.green("present") : chalk.yellow("missing (run 'pull')")}`,
    );

    // Match by thumbprint, not Subject — the vault key name and the cert's
    // CN aren't the same thing. Read the thumbprint from the local PFX (or
    // skip this section if neither the PFX nor the password are available).
    let thumbprint;
    if (onDisk && pfxPassword) {
        try {
            const ps = `
                $pwd = ConvertTo-SecureString -String '${escapePsString(pfxPassword)}' -AsPlainText -Force
                $data = Get-PfxData -FilePath '${escapePsString(localPfxPath)}' -Password $pwd
                Write-Output $data.EndEntityCertificates[0].Thumbprint
            `;
            thumbprint = runPowerShell(ps).stdout.trim();
        } catch (e) {
            vlog(`reading PFX thumbprint failed: ${e.message}`);
        }
    }

    console.log(`\nCert stores (matching thumbprint):`);
    if (!thumbprint) {
        console.log(
            chalk.gray(
                "  (skipped — need both local PFX and vault password to determine thumbprint)",
            ),
        );
        return;
    }
    console.log(`  thumbprint: ${chalk.cyanBright(thumbprint)}`);
    const stores = [
        ["CurrentUser\\My", "Cert:\\CurrentUser\\My"],
        ["CurrentUser\\TrustedPeople", "Cert:\\CurrentUser\\TrustedPeople"],
        ["CurrentUser\\Root", "Cert:\\CurrentUser\\Root"],
    ];
    for (const [label, psPath] of stores) {
        const ps = `
            if (Test-Path '${psPath}\\${thumbprint}') { Write-Output 'yes' } else { Write-Output 'no' }
        `;
        const { stdout } = runPowerShell(ps, { ignoreExitCode: true });
        const present = stdout.trim() === "yes";
        console.log(
            `  ${label}: ${present ? chalk.green("installed") : chalk.gray("not installed")}`,
        );
    }
}

// ---------------------------------------------------------------------------
// Help + arg parsing
// ---------------------------------------------------------------------------

function printHelp() {
    console.log(`
${chalk.bold("getCert.mjs")} — manage the TypeAgent dev code-signing cert.

Usage:
  node getCert.mjs <command> [options]

Commands:
  pull        Fetch cert from Key Vault, password-protect locally.
  install     Pull + import into CurrentUser cert stores.
  status      Show vault / local / cert-store state.
  help        Show this help.

Options:
  --trusted-root     (install only) Also install into CurrentUser\\Root —
                     required for self-signed MSIX trust. Triggers a one-
                     time UAC/confirm prompt.
  -v, --verbose      Verbose logging.

Config (ts/tools/scripts/getKeys.config.json under "cert"):
  vault                  Key Vault name (default: aisystems)
  name                   Cert name in vault (default: TypeAgent-Development-Certificate)
  passwordSecretName     Secret name for the auto-generated PFX password
  localPfxPath           Where to save the password-protected PFX (~ supported)
`);
}

const commands = ["pull", "install", "status", "help"];

(async () => {
    const command = process.argv[2];
    if (command === undefined || command === "help" || command === "--help") {
        printHelp();
        return;
    }
    if (!commands.includes(command)) {
        console.error(chalk.red(`Unknown command: ${command}`));
        printHelp();
        process.exit(1);
    }

    for (let i = 3; i < process.argv.length; i++) {
        const arg = process.argv[i];
        if (arg === "--trusted-root") {
            paramTrustedRoot = true;
        } else if (arg === "--verbose" || arg === "-v") {
            paramVerbose = true;
        } else {
            console.error(chalk.red(`Unknown argument: ${arg}`));
            process.exit(1);
        }
    }

    switch (command) {
        case "pull":
            await pull();
            break;
        case "install":
            await install();
            break;
        case "status":
            await status();
            break;
    }
})().catch((e) => {
    console.error(chalk.red(`FATAL ERROR: ${e.stack ?? e.message ?? e}`));
    process.exit(1);
});
