# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

param(
    [Parameter(Mandatory = $true)][string]$OutputDir,
    [string]$WixBin
)
$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..\..\..')).Path
$OutputDir = [IO.Path]::GetFullPath($OutputDir)
New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null
$baseline = 'd7bbde6bf88b442cab7f412acf4fd74b00becb96'
$upgradeCode = '528E3F97-8B53-4D80-92FA-AF3919D029BE'
$rootName = 'TypeAgent-MsiLifecycle'
$script:iceValidated = $true

if (-not $WixBin) {
    $archive = Join-Path $OutputDir 'wix314-binaries.zip'
    Invoke-WebRequest -UseBasicParsing -Uri 'https://github.com/wixtoolset/wix3/releases/download/wix3141rtm/wix314-binaries.zip' -OutFile $archive
    if ((Get-FileHash $archive -Algorithm SHA256).Hash -ne '6AC824E1642D6F7277D0ED7EA09411A508F6116BA6FAE0AA5F2C7DAA2FF43D31') {
        throw 'WiX release checksum mismatch.'
    }
    $WixBin = Join-Path $OutputDir 'wix'
    Expand-Archive -LiteralPath $archive -DestinationPath $WixBin
}

function Invoke-Wix([string]$tool, [string[]]$arguments, [string]$log) {
    & (Join-Path $WixBin $tool) @arguments 2>&1 | Tee-Object -FilePath $log | Out-Host
    if ($LASTEXITCODE -ne 0) { throw "$tool failed; see $log" }
    if (Select-String -LiteralPath $log -Pattern 'LGHT1105') {
        $script:iceValidated = $false
        if ($env:GITHUB_ACTIONS -eq 'true') {
            throw 'ICE validation did not run. Use a Windows build host permitting MSI validation.'
        }
        Write-Warning 'Local compilation only: ICE unavailable. The lifecycle runner will reject these packages.'
    }
}

function Add-WixElement($parent, [string]$name, [hashtable]$attributes) {
    $element = $parent.OwnerDocument.CreateElement($name, 'http://schemas.microsoft.com/wix/2006/wi')
    foreach ($key in $attributes.Keys) { $element.SetAttribute($key, [string]$attributes[$key]) }
    [void]$parent.AppendChild($element)
    return $element
}

function Build-Package([string]$name, [string]$version, [string]$revision, [string]$failure) {
    $stage = Join-Path $OutputDir $name
    New-Item -ItemType Directory -Path $stage | Out-Null
    if ($revision) {
        $archive = Join-Path $stage 'source.zip'
        & git -C $repo archive --format=zip "--output=$archive" $revision ts/tools/installers ts/tools/scripts/install-shell.ps1
        if ($LASTEXITCODE -ne 0) { throw "Cannot read pinned legacy source $revision" }
        Expand-Archive -LiteralPath $archive -DestinationPath $stage
    } else {
        $tools = Join-Path $stage 'ts\tools'
        New-Item -ItemType Directory -Path (Join-Path $tools 'scripts') -Force | Out-Null
        Copy-Item -LiteralPath (Join-Path $repo 'ts\tools\installers') -Destination $tools -Recurse
        Copy-Item -LiteralPath (Join-Path $repo 'ts\tools\scripts\install-shell.ps1') -Destination (Join-Path $tools 'scripts')
    }
    $source = Join-Path $stage 'ts\tools\installers\wix'
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'run-serve.ps1') -Destination (Join-Path $source 'run-serve.ps1') -Force
    Copy-Item -LiteralPath (Join-Path $repo 'ts\tools\installers\wix\maintain-server.ps1') -Destination (Join-Path $source 'lifecycle-maintenance.ps1')
    $server = Join-Path $stage 'server'
    $plugin = Join-Path $stage 'plugin'
    New-Item -ItemType Directory -Path (Join-Path $server 'dist'), $plugin | Out-Null
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'server.cjs') -Destination (Join-Path $server 'dist\server.js')
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'stop.cjs') -Destination (Join-Path $server 'dist\stop.js')
    Set-Content -LiteralPath (Join-Path $server 'version.txt') -Value $version -Encoding ASCII
    Set-Content -LiteralPath (Join-Path $server 'locked.dat') -Value 'native-lock-substitute' -Encoding ASCII
    Set-Content -LiteralPath (Join-Path $plugin 'version.txt') -Value $version -Encoding ASCII
    Compress-Archive -Path (Join-Path $server '*') -DestinationPath (Join-Path $stage 'server.zip')
    Compress-Archive -Path (Join-Path $plugin '*') -DestinationPath (Join-Path $stage 'plugin.zip')
    Set-Content -LiteralPath (Join-Path $stage 'marketplace.json') -Value '{}' -Encoding ASCII
    Set-Content -LiteralPath (Join-Path $stage 'unused.vsix') -Value 'not-installed-in-transaction-tests' -Encoding ASCII

    $wxsPath = Join-Path $source 'TypeAgent-AgentServer.wxs'
    [xml]$wxs = Get-Content -LiteralPath $wxsPath -Raw
    $ns = New-Object Xml.XmlNamespaceManager($wxs.NameTable)
    $ns.AddNamespace('w', 'http://schemas.microsoft.com/wix/2006/wi')
    $product = $wxs.SelectSingleNode('//w:Product', $ns)
    $product.SetAttribute('Name', 'TypeAgent MSI Lifecycle Test')
    $product.SetAttribute('UpgradeCode', $upgradeCode)
    $productId = '{' + [guid]::NewGuid().ToString().ToUpperInvariant() + '}'
    $product.SetAttribute('Id', $productId)
    $wxs.SelectSingleNode('//w:Directory[@Id="TYPEAGENTROOT"]', $ns).SetAttribute('Name', $rootName)
    foreach ($key in $wxs.SelectNodes('//w:RegistryKey', $ns)) {
        $key.SetAttribute('Key', $key.GetAttribute('Key').Replace('Microsoft\TypeAgent', 'Microsoft\TypeAgentMsiLifecycle'))
    }
    $directory = $wxs.SelectSingleNode('//w:DirectoryRef[@Id="TYPEAGENTROOT"]', $ns)
    $component = Add-WixElement $directory 'Component' @{ Id = 'LifecycleMaintenanceComponent'; Guid = '*' }
    [void](Add-WixElement $component 'File' @{
        Id = 'LifecycleMaintenance'; Name = 'lifecycle-maintenance.ps1'
        Source = '$(var.InstallerSourceDir)\lifecycle-maintenance.ps1'
        KeyPath = 'yes'
    })
    [void](Add-WixElement ($wxs.SelectSingleNode('//w:Feature[@Id="ProductFeature"]', $ns)) 'ComponentRef' @{
        Id = 'LifecycleMaintenanceComponent'
    })
    $sequence = $wxs.SelectSingleNode('//w:Product/w:InstallExecuteSequence', $ns)
    # These integrations require network accounts/apps, not MSI transaction
    # correctness. Disable them explicitly, never claim their coverage.
    $external = @(
        'RegisterCopilotPlugin', 'UnregisterCopilotPlugin', 'InstallVsCodeChat', 'UninstallVsCodeChat',
        'InstallVsCodeShell', 'UninstallVsCodeShell', 'ProvisionCopilotConfig', 'ProvisionAiSystemsConfig',
        'InstallPrereqs', 'DownloadTypeAgentShell', 'InstallTypeAgentShell', 'VerifyTypeAgentShell', 'LaunchCopilotSetup'
    )
    foreach ($action in $external) {
        $entry = $sequence.SelectSingleNode("w:Custom[@Action='$action']", $ns)
        if ($entry) { $entry.InnerText = '0' }
    }
    if ($failure) {
        Add-Content -LiteralPath (Join-Path $source 'progress.vbs') -Encoding ASCII -Value @'

Function LifecycleFail()
    LifecycleFail = 3
End Function
'@
        [void](Add-WixElement $product 'CustomAction' @{
            Id = 'LifecycleFail'; BinaryKey = 'ProgressVbs'; VBScriptCall = 'LifecycleFail'
            Execute = 'deferred'; Return = 'check'; Impersonate = 'yes'
        })
        $entry = Add-WixElement $sequence 'Custom' @{ Action = 'LifecycleFail'; After = $failure }
        $entry.InnerText = 'NOT REMOVE~="ALL"'
        if ($failure -eq 'BeginMaintenance') {
            $sequence.SelectSingleNode('w:InstallExecute', $ns).SetAttribute('After', 'LifecycleFail')
        }
    }
    $wxs.Save($wxsPath)
    $object = Join-Path $stage 'package.wixobj'
    $msi = Join-Path $OutputDir "$name.msi"
    $defines = @(
        "-dProductVersion=$version", "-dAgentServerZip=$stage\server.zip", "-dCopilotPluginZip=$stage\plugin.zip",
        "-dVsCodeChatVsix=$stage\unused.vsix", "-dVsCodeShellVsix=$stage\unused.vsix",
        "-dMarketplaceDir=$stage", "-dInstallerSourceDir=$source",
        '-dShellBaseUrl=', '-dShellStorage=', '-dShellContainer=', '-dShellChannel=ci',
        '-dShellFeed=', '-dShellPackage=', '-dShellFeedVersion=', '-dShellOrg=', '-dShellProject=',
        '-arch', 'x64', '-o', $object, $wxsPath
    )
    Invoke-Wix 'candle.exe' $defines (Join-Path $stage 'candle.log')
    Invoke-Wix 'light.exe' @('-ext', 'WixUIExtension', '-ext', 'WixUtilExtension', '-sice:ICE38', '-sice:ICE64', '-o', $msi, $object) (Join-Path $stage 'light.log')
    $installer = New-Object -ComObject WindowsInstaller.Installer
    $db = $installer.OpenDatabase($msi, 0)
    $view = $db.OpenView('SELECT `Action`,`Sequence` FROM `InstallExecuteSequence` ORDER BY `Sequence`')
    $view.Execute()
    $actions = @{}
    while ($record = $view.Fetch()) { $actions[$record.StringData(1)] = $record.IntegerData(2) }
    $view.Close()
    $actions | ConvertTo-Json | Set-Content (Join-Path $stage 'sequence.json')
    if (-not $revision) {
        if (-not ($actions.InstallInitialize -lt $actions.RollbackMaintenance -and
            $actions.RollbackMaintenance -lt $actions.BeginMaintenance -and
            $actions.BeginMaintenance -lt $actions.InstallExecute -and
            $actions.InstallExecute -lt $actions.RemoveExistingProducts -and
            $actions.RemoveExistingProducts -lt $actions.ProcessComponents)) {
            throw 'Compiled MSI must flush maintenance before old-product removal and before file installation.'
        }
    }
    @{
        Name = $name; Version = $version; ProductCode = $productId; Path = $msi
        Revision = $revision; Failure = $failure
        ServerHash = (Get-FileHash (Join-Path $server 'dist\server.js')).Hash
    }
}

$packages = @(
    Build-Package 'baseline' '0.0.1.0' $baseline ''
    Build-Package 'candidate' '0.0.2.0' '' ''
    Build-Package 'fail-shutdown' '0.0.3.0' '' 'BeginMaintenance'
    Build-Package 'fail-extraction' '0.0.3.0' '' 'ExtractCopilotPluginPayload'
    Build-Package 'fail-restart' '0.0.3.0' '' 'StartAgentServer'
)
@{
    RootName = $rootName; UpgradeCode = $upgradeCode; BaselineRevision = $baseline
    CandidateRevision = (& git -C $repo rev-parse HEAD)
    IceValidated = $script:iceValidated
    Coverage = 'Production MSI transactions with a deterministic substitute server. External integrations disabled.'
    Packages = $packages
} | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $OutputDir 'manifest.json') -Encoding UTF8
