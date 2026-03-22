param(
    [string]$Directory = ".",
    [int]$MinSizeMB = 100,
    [int]$TopN = 20
)

$minBytes = $MinSizeMB * 1MB

$files = Get-ChildItem -Path $Directory -Recurse -File -ErrorAction SilentlyContinue |
    Where-Object { $_.Length -ge $minBytes } |
    Sort-Object Length -Descending |
    Select-Object -First $TopN

if ($files.Count -eq 0) {
    Write-Output "No files found larger than ${MinSizeMB}MB in $Directory"
} else {
    $totalBytes = 0
    foreach ($f in $files) {
        $sizeMB = $f.Length / 1MB
        $sizeStr = "{0:N2}" -f $sizeMB
        $dateStr = Get-Date $f.LastWriteTime -Format "yyyy-MM-dd HH:mm"
        Write-Output "  ${sizeStr} MB  $dateStr  $($f.FullName)"
        $totalBytes += $f.Length
    }

    $totalGB = "{0:N2}" -f ($totalBytes / 1GB)
    Write-Output "`nTotal: $totalGB GB across $($files.Count) file(s)"
}
