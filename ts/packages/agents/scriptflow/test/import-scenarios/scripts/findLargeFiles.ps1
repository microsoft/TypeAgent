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
    $files | ForEach-Object {
        [PSCustomObject]@{
            SizeMB   = [math]::Round($_.Length / 1MB, 2)
            Modified = $_.LastWriteTime.ToString("yyyy-MM-dd HH:mm")
            Path     = $_.FullName
        }
    } | Format-Table -AutoSize

    $totalGB = ($files | Measure-Object -Property Length -Sum).Sum / 1GB
    Write-Output "`nTotal: $([math]::Round($totalGB, 2)) GB across $($files.Count) file(s)"
}
