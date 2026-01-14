$pfxPath = "TypeAgent_TemporaryKey.pfx"
$password = "test123"

if (-not (Test-Path $pfxPath)) {
    Write-Host "Creating cert $pfxPath"
    $cert = New-SelfSignedCertificate -Type Custom -KeyUsage DigitalSignature -CertStoreLocation "Cert:\CurrentUser\My" -TextExtension @("2.5.29.37={text}1.3.6.1.5.5.7.3.3", "2.5.29.19={text}") -Subject "CN=TypeAgent" -FriendlyName "TypeAgent Test Cert"
    $pw = ConvertTo-SecureString -String $password -Force -AsPlainText 
    $pfxExport = Export-PfxCertificate -cert $cert -FilePath $pfxPath -Password $pw
    Remove-Item $cert.PSPath
}
$packagePath = "bin\x64\Debug\net8.0-windows10.0.26100.0\AppPackages\AgentLauncher_1.0.0.0_x64_Debug_Test\AgentLauncher_1.0.0.0_x64_Debug.msix"
$signtool = Get-ChildItem "C:\Program Files (x86)\Windows Kits\" -Recurse -Filter "signtool.exe" -ErrorAction SilentlyContinue | Select-Object -First 1
& $signtool.FullName sign /fd SHA256 /a /f $pfxPath /p $password $packagePath
Write-Host "Package signed"
