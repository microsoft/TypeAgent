$pfxPath = "TypeAgent_TemporaryKey.pfx"
$packagePath = "bin\x64\Debug\net8.0-windows10.0.26100.0\AppPackages\WindowlessAgentLauncher_1.0.0.0_x64_Debug_Test\WindowlessAgentLauncher_1.0.0.0_x64_Debug.msix"
$signtool = Get-ChildItem "C:\Program Files (x86)\Windows Kits\" -Recurse -Filter "signtool.exe" -ErrorAction SilentlyContinue | Select-Object -First 1
& $signtool.FullName sign /fd SHA256 /a /f $pfxPath /p "test123" $packagePath
Write-Host "Package signed"
