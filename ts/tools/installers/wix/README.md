# TypeAgent Agent-Server MSI Builder

Automated build and signing for the TypeAgent headless agent-server MSI installer.

## Overview

This implementation builds a lightweight Windows Installer (MSI) that:

- Downloads the `agent-server.<rid>` artifact from the ADO feed
- Bundles it with the Copilot plugin and TypeAgent VS Code Chat VSIX
- Installs TypeAgent Chat and creates a desktop shortcut when VS Code 1.133+
  is present
- Signs with the TypeAgent development certificate (from Key Vault)
- Produces a signed `.msi` ready for distribution

## Files

```
ts/tools/scripts/
  ├── build-msi.mjs          # Orchestrate artifact download + WiX build
  ├── sign-msi.mjs           # Sign MSI with dev cert (wraps getCert.mjs)
  └── getCert.mjs            # (existing) Manage dev certs in Key Vault

ts/tools/installers/wix/
  ├── TypeAgent-AgentServer.wxs   # WiX project definition
  ├── extract-payload.ps1         # Deferred CA: unpack payload/*.zip at install time
  ├── install-prereqs.ps1         # Deferred CA: npm i -g claude+copilot, warn on Node<22
  └── register-plugin.ps1         # Deferred CA: register/unregister the Copilot CLI plugin

ts/tools/installers/common/
  └── install-vscode-chat.ps1     # Shared VSIX install + desktop shortcut lifecycle

pipelines/
  └── azure-build-publish-all.yml   # ADO pipeline (build_sign_publish_msi job)
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

Use the local source build to validate WiX changes before pushing to CI. This is the recommended path for catching `LGHT`/`CANDLE` errors early — it runs the same WiX zip → candle → light pipeline that CI does, but stages the artifacts from your local repo build instead of downloading from the ADO feed. No Azure CLI login required.

### Option A: Build from local repo (recommended for WiX development)

#### 1. Build the workspace

```powershell
cd D:\repos\TypeAgent\ts
pnpm run build
```

#### 2. Stage agent-server

```powershell
# From D:\repos\TypeAgent\ts
node tools/scripts/deployAgentServer.mjs `
  --out "$env:TEMP\typeagent-msi-stage\agent-server" `
  --platform win32 --arch x64 `
  --profile inbox `
  --external-cli
```

#### 3. Stage copilot-plugin

```powershell
$plugin = "packages/copilot-plugin"
$out    = "$env:TEMP\typeagent-msi-stage\copilot-plugin"
New-Item -ItemType Directory -Force $out | Out-Null
Copy-Item -Recurse "$plugin/dist"       "$out/dist"
Copy-Item          "$plugin/hooks.json" "$out/hooks.json"
Copy-Item          "$plugin/.mcp.json"  "$out/.mcp.json"
Copy-Item          "$plugin/plugin.json" "$out/plugin.json"
Copy-Item -Recurse "$plugin/agents"     "$out/agents"
Copy-Item -Recurse "$plugin/skills"     "$out/skills"
```

#### 4. Run the WiX build with local staged artifacts

```powershell
pnpm --filter vscode-chat run package

node tools/scripts/build-msi.mjs `
  --skip-download `
  --agent-dir  "$env:TEMP\typeagent-msi-stage\agent-server" `
  --plugin-dir "$env:TEMP\typeagent-msi-stage\copilot-plugin" `
  --vscode-chat-vsix "packages\vscode-chat\dist-pub\vscode-chat.vsix" `
  --version 0.0.1-local `
  --plugin-version 0.0.1-local `
  --vscode-chat-version 0.0.1-local `
  --output "$env:TEMP\typeagent-msi-stage\out"
```

**Output:**

```
$env:TEMP\typeagent-msi-stage\out\TypeAgent-0.0.1-local-win32-x64.msi
```

This is the same code path CI uses. If WiX fails here it will fail in CI.

---

### Option B: Build from ADO feed artifact (requires az login)

Pull pre-published artifacts from the `typeagent` feed instead of staging locally.

#### 1. Pull the Certificate from Key Vault

```powershell
cd D:\repos\TypeAgent\ts\tools\scripts
node getCert.mjs pull
```

This downloads the cert to `~/.typeagent/TypeAgent-Development-Certificate.pfx`.

Status check:

```powershell
node getCert.mjs status
```

#### 2. Build the MSI

```powershell
cd D:\repos\TypeAgent\ts\tools\scripts

# Build for win32-x64
node build-msi.mjs --rid win32-x64 --version 0.0.1-<buildId> --output ./msi-out
```

**What it does:**

1. Downloads `agent-server.win32-x64` from the `typeagent` feed
2. Downloads `typeagent-copilot-plugin` and `typeagent-vscode-chat`
3. Extracts/stages the artifacts under `./msi-out/artifact`
4. Compiles WiX definition (`.wxs` → `.wixobj`)
5. Links to create `TypeAgent-<version>-win32-x64.msi`

**Output:**

```
msi-out/
├── artifact/              # Downloaded and extracted agent-server
└── TypeAgent-0.0.1-<buildId>-win32-x64.msi
```

#### 3. Sign the MSI (optional for local testing)

```powershell
cd D:\repos\TypeAgent\ts\tools\scripts
node sign-msi.mjs "$env:TEMP\typeagent-msi-stage\out\TypeAgent-0.0.1-local-win32-x64.msi"
```

Signing requires Key Vault access. For local WiX validation you can skip signing and test install directly.

#### 4. Test installation

```powershell
# Interactive install
msiexec /i "$env:TEMP\typeagent-msi-stage\out\TypeAgent-0.0.1-local-win32-x64.msi"

# Unattended
msiexec /i "$env:TEMP\typeagent-msi-stage\out\TypeAgent-0.0.1-local-win32-x64.msi" /quiet /norestart

# Verify
Get-Item "$env:LOCALAPPDATA\TypeAgent\agent-server" -ErrorAction SilentlyContinue
```

## Native VS Code Chat integration

`VSCODECHAT=1` is enabled by default. During install, the MSI runs the shared
`install-vscode-chat.ps1` helper as the current user. The helper:

1. Finds user- or system-installed VS Code.
2. Requires VS Code 1.133.0 or newer.
3. Installs the bundled `typeagent.vscode-chat` VSIX.
4. Creates `TypeAgent Chat.lnk` on the current user's desktop with:

   ```text
   --new-window --enable-proposed-api=typeagent.vscode-chat
   ```

If compatible VS Code is absent, the step logs a warning and the rest of the
TypeAgent installation continues. Disable the component for a silent install
with:

```powershell
msiexec /i TypeAgent-<version>-win32-x64.msi VSCODECHAT=0
```

The MSI removes the shortcut on uninstall. It removes the extension only when
the installed version still matches the version originally installed by
TypeAgent, so it does not delete an independently upgraded extension.

## Endpoint provider selection (self-host)

TypeAgent needs an LLM endpoint configuration (`config.local.yaml`) at runtime.
By default it is downloaded from the AI Systems Key Vault, but machines without
Key Vault access can instead run against a local **Ollama** server or the
**Copilot** SDK.

During an **interactive** install the MSI shows a provider-selection dialog
(after the license page) with radio-button groups for the chat provider
(AI Systems / Ollama / Copilot), the embedding provider (Local / Ollama / OpenAI
/ None), and an Ollama host field. The same choices can be driven **silently**
through public properties:

| Property     | Values                              | Default                  | Notes                                                                           |
| ------------ | ----------------------------------- | ------------------------ | ------------------------------------------------------------------------------- |
| `PROVIDER`   | `AISYSTEMS`, `OLLAMA`, `COPILOT`    | `AISYSTEMS`              | `OLLAMA`/`COPILOT` generate `config.local.yaml` during install (no Key Vault).  |
| `EMBEDDING`  | `LOCAL`, `OLLAMA`, `OPENAI`, `NONE` | `LOCAL`                  | Embedding source for the self-host providers. `LOCAL` = bundled CPU-only model. |
| `OLLAMAHOST` | any URL                             | `http://localhost:11434` | Ollama base URL (used for `OLLAMA` chat and/or embeddings).                     |

```powershell
# AI Systems (default) — provisions via az login + getKeys after install
msiexec /i TypeAgent-<version>-win32-x64.msi

# Local Ollama chat with the bundled local embedding model
msiexec /i TypeAgent-<version>-win32-x64.msi PROVIDER=OLLAMA

# Copilot SDK chat (requires an authenticated `copilot` CLI) + local embeddings
msiexec /i TypeAgent-<version>-win32-x64.msi PROVIDER=COPILOT

# Fully silent
msiexec /i TypeAgent-<version>-win32-x64.msi /quiet PROVIDER=OLLAMA EMBEDDING=LOCAL
```

The UI is a custom scheme (`WixUI_TypeAgent`): WelcomeDlg → **ProviderDlg** →
VerifyReadyDlg. For `OLLAMA`/`COPILOT`, a deferred, impersonated custom action
runs `node "[INSTALLFOLDER]typeagent-serve.mjs" provision --provider [PROVIDER]
--embedding [EMBEDDING] --ollama-host [OLLAMAHOST] --force` as the installing
user, writing `config.local.yaml` to `~/.typeagent`. For `AISYSTEMS`
(the default), the MSI **attempts** provisioning during install via a deferred,
impersonated (interactive) custom action `ProvisionAiSystemsConfig` that runs
`node "[INSTALLFOLDER]typeagent-serve.mjs" provision` (browser/device sign-in as
the installing user). It is **non-fatal**: if sign-in is unavailable during the
install, the final page (ExitDialog) reminds the user to run `provision`
manually. Because the embedding config for `AISYSTEMS` comes from Key Vault, the
embedding radio and Ollama host field are **disabled** in the dialog when
`PROVIDER=AISYSTEMS` (they apply only to the self-host providers). Fine-grained
overrides (chat model, embedding endpoint, API keys) are available on the
`provision`/`generate-selfhost-config` CLI; re-run provisioning post-install to
adjust them.

## Agent-server prerequisites & lifecycle

The MSI ships the **external** agent-server variant, which resolves the `claude`
and `copilot` CLIs from `PATH` at runtime. After extracting the payload the MSI
runs these deferred, impersonated custom actions (each **non-fatal** so a hiccup
never rolls back the agent-server install; issues surface as warnings + the
ExitDialog reminder):

| Action             | Property gate             | What it does                                                                                                                                                                                        |
| ------------------ | ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `InstallPrereqs`   | —                         | Runs `install-prereqs.ps1`: installs `claude` (`@anthropic-ai/claude-code`) and `copilot` (`@github/copilot`) via `npm i -g` when missing, and warns if Node < 22. Mirrors `install-typeagent.ps1`. |
| `StartAgentServer` | `STARTSERVER=1` (default) | `node typeagent-serve.mjs start` — starts the daemon.                                                                                                                                               |
| `EnableAutostart`  | `AUTOSTART=1` (default)   | `node typeagent-serve.mjs autostart enable` — registers a per-user logon Scheduled Task. Removed on uninstall (`DisableAutostart`).                                                                 |

```powershell
# Skip starting/autostarting the daemon (e.g. provisioning happens later)
msiexec /i TypeAgent-<version>-win32-x64.msi STARTSERVER=0 AUTOSTART=0
```

Both CLIs require a one-time interactive sign-in (`claude`, then `copilot`)
before agent actions work; the ExitDialog reminds the user of this.

## Optional: install the TypeAgent Shell (desktop app)

The MSI can optionally download and silently install the **TypeAgent Shell**
(the Electron desktop app) from the same Azure Blob Storage container used by the
shell's auto-update feed. This is off by default. During an interactive install
a checkbox on **ProviderDlg** ("Also install the TypeAgent Shell desktop app")
enables it; silently, set the public properties. **The download location is
baked at build time** (`build-msi.mjs --shell-storage/--shell-container`; the
pipeline overrides the local CI defaults with its storage account/container),
so the checkbox works on a fresh machine without extra input. If a build ships
with neither a blob location nor a complete feed configuration and `SHELL=1` is
requested, the `ShellLocationMissing` action **aborts loudly** with a clear
message rather than silently skipping. Blob access is not required when the
feed fallback is configured.

| Property           | Values / example                                      | Default                                        | Notes                                                                        |
| ------------------ | ----------------------------------------------------- | ---------------------------------------------- | ---------------------------------------------------------------------------- |
| `SHELL`            | `0`, `1`                                              | `0`                                            | `1` enables the optional shell download + silent install.                    |
| `SHELLCHANNEL`     | `lkg`, `test`, `ci`                                   | local build: `ci`; pipeline: release channel   | electron-updater channel to read (`<channel>-<arch>.yml`).                   |
| `SHELLSTORAGE`     | Azure Storage account name                            | local build: `typeagentshell`                  | Used with the Azure CLI (`az login`) to read the shell blobs.                |
| `SHELLCONTAINER`   | Azure Storage container name                          | local build: `typeagentshell`                  | Defaults to `SHELLSTORAGE` if omitted.                                       |
| `SHELLBASEURL`     | `https://<account>.blob.core.windows.net/<container>` | build default (derived from storage/container) | Anonymous HTTPS base for a **public** container; when set, `az` is not used. |
| `SHELLFEED`        | Azure Artifacts feed name                             | local build: `typeagent`                       | Fallback source when blob download fails.                                    |
| `SHELLPACKAGE`     | Universal Package name                                | local build: `typeagent-shell.win32-x64`       | Package containing channel metadata and the setup executable.                |
| `SHELLFEEDVERSION` | Exact package version                                 | latest listed version                          | When omitted, prerelease versions are included in latest-version resolution. |

```powershell
# Authenticated (az login) blob read from a private container
msiexec /i TypeAgent-<version>-win32-x64.msi SHELL=1 SHELLSTORAGE=myaccount SHELLCONTAINER=mycontainer SHELLCHANNEL=lkg

# Public container (no az): anonymous HTTPS download
msiexec /i TypeAgent-<version>-win32-x64.msi SHELL=1 SHELLBASEURL=https://myaccount.blob.core.windows.net/mycontainer
```

When `SHELL=1`, a deferred, impersonated custom action runs the bundled
`install-shell.ps1` (`[TYPEAGENTROOT]install-shell.ps1`), which reads the
channel metadata, downloads `typeagentshell-<version>-win32-x64-setup.exe`, and
runs it silently (NSIS `/S`). It runs as the installing user so blob auth and
the per-user shell install target resolve correctly. The action is **non-fatal**
(`Return="ignore"`): a shell download/install failure is logged to
`%LOCALAPPDATA%\TypeAgent\logs\msi-install-shell.log` but does not roll back the
agent-server install. Because the shell shares `~/.typeagent/config.local.yaml`,
no extra config step is needed. `install-shell.ps1` is the Windows sibling of
`install-shell.sh` and can also be run standalone. If no feed version is baked
into the MSI, the script queries Azure Artifacts and downloads the latest listed
version, including prerelease versions. Any blob metadata or installer download
failure is logged and automatically falls back to the package feed.

Local MSI packaging resolves the latest listed shell Universal Package version
and bakes that exact version into the MSI. Pipeline builds continue to pass the
version produced by the current pipeline run.

## Pipeline Usage

### Automatic (on `main` branch)

The pipeline runs automatically on every push to `main`. The MSI is built,
signed, and published by the `build_sign_publish_msi` job in the Publish stage.
It can also be started manually via `Run Pipeline`.

### Manual Trigger

```powershell
az pipelines run --name "azure-build-publish-all" --branch main
```

### Parameters

- **`publishMsi`**: Publish the signed MSI to the Universal feed + Azure Blob
  Storage (requires approval).
- **`channel`**: Release channel for the blob upload (`test`, `lkg`).

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

- The agent-server and copilot-plugin payloads ship as single zip files
  (`payload\*.zip`) that a deferred custom action (`extract-payload.ps1`) unpacks
  at install time. This avoids harvesting a flat `node_modules` into tens of
  thousands of components, which made the installer's "Computing space
  requirements" (CostFinalize) step take minutes. Do **not** reintroduce
  `heat.exe dir` harvesting for these trees.
- Payload extraction uses Windows inbox `tar.exe`, with separate custom actions
  for the agent-server and Copilot plugin so the progress dialog identifies each
  stage.
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
