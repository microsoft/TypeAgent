# TypeAgent Agent-Server MSI Builder

Automated build and signing for the TypeAgent headless agent-server MSI installer.

## Overview

This implementation builds a lightweight Windows Installer (MSI) that:

- Downloads the `agent-server.<rid>` artifact from the ADO feed
- Bundles it with a launcher (`typeagent-serve.mjs`)
- Signs with the TypeAgent development certificate (from Key Vault)
- Produces a signed `.msi` ready for distribution

## Files

```
ts/tools/scripts/
  ├── build-msi.mjs          # Orchestrate artifact download + WiX build
  ├── sign-msi.mjs           # Sign MSI with dev cert (wraps getCert.mjs)
  └── getCert.mjs            # (existing) Manage dev certs in Key Vault

ts/tools/installers/wix/
  └── TypeAgent-AgentServer.wxs   # WiX project definition

pipelines/
  └── azure-build-package-agent-server-msi.yml   # ADO pipeline
```

## Prerequisites

### On Your Development Machine

1. **Node.js ≥ 22**

   ```powershell
   node --version  # Should be v22.x
   ```

2. **WiX Toolset 3.11** (for local testing)

   ```powershell
    winget install -e --id WiXToolset.WiXToolset
   ```

   - Provides: `candle.exe`, `light.exe`, `heat.exe`

3. **Windows SDK** (for `signtool.exe`)

   - Usually installed with Visual Studio
   - Or download standalone from: https://developer.microsoft.com/en-us/windows/downloads/windows-sdk/
   - Provides: `signtool.exe` (sign and verify binaries)

4. **Azure CLI**

   ```powershell
   az --version
   az login  # Authenticate with your Microsoft account
   ```

5. **Key Vault Access**
   - Must have read access to the `aisystems` Key Vault
   - Certificate: `TypeAgent-Development-Certificate`
   - Password: `TypeAgent-Development-Certificate-Password`

### On ADO Pipeline Agents

The pipeline handles this automatically via:

- `AzureCLI@2` task for authentication
- Pipeline secrets for certificate password
- Pre-installed Windows SDK (standard on `windows-latest` image)

## Local Build & Test

### 1. Pull the Certificate from Key Vault

```powershell
cd ts/tools/scripts
node getCert.mjs pull
```

This downloads the cert to `~/.typeagent/TypeAgent-Development-Certificate.pfx`.

Status check:

```powershell
node getCert.mjs status
```

### 2. Build the MSI

```powershell
cd ts/tools/scripts

# Build for win32-x64 (default)
node build-msi.mjs --rid win32-x64 --version 0.0.1-test --output ./msi-out

# Or specify latest published version
node build-msi.mjs --rid win32-x64 --version latest --output ./msi-out
```

**What it does:**

1. Downloads `agent-server.win32-x64` from the `typeagent` feed
2. Extracts to `./msi-out/artifact`
3. Compiles WiX definition (`.wxs` → `.wixobj`)
4. Links to create `TypeAgent-AgentServer-<version>-win32-x64.msi`

**Output:**

```
msi-out/
├── artifact/              # Downloaded and extracted agent-server
├── TypeAgent-AgentServer.wixobj   # Compiled WiX
└── TypeAgent-AgentServer-0.0.1-test-win32-x64.msi
```

### 3. Sign the MSI

```powershell
cd ts/tools/scripts

# Sign with the dev certificate
node sign-msi.mjs ../installers/wix/msi-out/TypeAgent-AgentServer-0.0.1-test-win32-x64.msi
```

**What it does:**

1. Invokes `getCert.mjs pull` (if not already done)
2. Signs the MSI with `signtool.exe` using the dev cert
3. Optionally timestamps the signature (via DigiCert timestamp server)
4. Verifies the signature

**Output:**

```
✅ MSI signed successfully
✔️  Signature verified successfully
```

### 4. Test Installation

On a clean Windows machine (or VM):

```powershell
# Interactive install (shows progress dialog)
msiexec /i TypeAgent-AgentServer-0.0.1-test-win32-x64.msi

# Unattended install (for scripted/Intune deployment)
msiexec /i TypeAgent-AgentServer-0.0.1-test-win32-x64.msi /quiet /norestart

# Verify installation
Get-Item 'C:\Program Files\TypeAgent\agent-server\' -ErrorAction SilentlyContinue
```

## Pipeline Usage

### Automatic (on `main` branch)

The pipeline runs automatically when:

- Code changes in `ts/tools/scripts/build-msi.mjs`, `sign-msi.mjs`, or `ts/tools/installers/wix/**`
- Or on manual trigger via `Run Pipeline`

### Manual Trigger

```powershell
az pipelines run --name "azure-build-package-agent-server-msi" --branch main
```

### Parameters

- **`rid`**: Target RID (`win32-x64`, `win32-arm64`, etc.)
- **`publishArtifacts`**: Publish to Azure Storage (requires approval)

## Troubleshooting

### "WiX Toolset not found"

**Error:**

```
❌ candle.exe not found. Install WiX Toolset 3.11 or later.
```

**Fix:**

1. Download WiX 3.11 from https://github.com/wixtoolset/wix3/releases
2. Install to default location
3. Restart terminal or reload PATH

### "signtool.exe not found"

**Error:**

```
❌ signtool.exe not found. Install Windows SDK...
```

**Fix:**

1. Install Windows SDK (via Visual Studio or standalone)
2. Or add to PATH: `C:\Program Files (x86)\Windows Kits\10\bin\x64\`

### "Artifact download failed"

**Error:**

```
az artifacts universal download: ... (404 or auth error)
```

**Fix:**

1. Run `az login` and authenticate
2. Verify artifact exists: `az artifacts universal list --feed typeagent`
3. Check RID matches published artifacts (e.g., `agent-server.win32-x64`)

### "Certificate not found"

**Error:**

```
❌ Certificate not found: ~/.typeagent/TypeAgent-Development-Certificate.pfx
```

**Fix:**

```powershell
node getCert.mjs pull
```

### "Not logged in to Azure CLI"

**Error:**

```
ERROR: Not logged in to Azure CLI. Run 'az login' first.
```

**Fix:**

```powershell
az login
az account show  # Verify
```

## Development Notes

### Phase 1-Lite (Current)

- ✅ Download artifact + bundle
- ✅ Compile WiX + link to MSI
- ✅ Sign with dev cert
- ✅ Unattended install support
- ❌ Service registration (deferred to Phase 3)
- ❌ Auto-start on boot (deferred to Phase 3)

### Future Phases

**Phase 2:** Sign shell EXE (currently disabled in pipeline)

- Adapt `sign-msi.mjs` to sign `packages/shell/dist/*.exe`

**Phase 3:** Service management (follow-up)

- Add WiX `ServiceInstall` element
- Registry entries for service config
- Event log integration

### WiX Best Practices

- Use `heat.exe dir` to auto-generate component trees (currently manual)
- Store WiX includes (`.wxi`) in `ts/tools/installers/wix/includes/`
- Keep `.wxs` files simple; delegate complexity to `.wxi` includes
- Test locally before pushing to main (MSI builds are slow)

## References

- **WiX Toolset:** https://wixtoolset.org/
- **signtool.exe:** https://learn.microsoft.com/en-us/windows/win32/seccrypto/signtool
- **Azure Artifacts (Universal Packages):** https://learn.microsoft.com/en-us/azure/artifacts/
- **getCert.mjs:** TypeAgent dev cert management (existing utility)
- **TypeAgent IMPLEMENTATION_PLAN.md:** Project context (T3, T5, T7)

## FAQ

**Q: Can I use the MSI without signing?**
A: Yes. Skip `sign-msi.mjs` in the build process. You'll get a warning on Windows SmartScreen, but it will install.

**Q: Can I use a different certificate?**
A: Yes. Modify `getKeys.config.json` `cert.name` and `passwordSecretName` fields. The pipeline will pull from Key Vault.

**Q: Can this be used for macOS/Linux?**
A: No. MSI is Windows-only. Use `deb`/`rpm` for Linux and `.app` bundles for macOS (separate implementations).

**Q: How often does the certificate expire?**
A: Self-signed dev certs are valid for 5+ years. You can renew with `node getCert.mjs renew`.

**Q: Can I test the MSI on the same machine where I built it?**
A: Yes, but the cert will already be trusted. To test on a truly clean machine, use a VM or another computer.
