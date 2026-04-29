param(
    [string]$InputFile,           # Path to source CSV
    [string]$OutputFile,          # Path for output CSV (default: inputfile_filtered.csv)
    [string]$FilterColumn,        # Column name to filter on
    [string]$FilterPattern = ".*", # Regex pattern to match in FilterColumn
    [string[]]$SelectColumns,     # Columns to keep (default: all)
    [switch]$NoHeader             # Input CSV has no header row
)

if (-not $InputFile -or -not (Test-Path $InputFile)) {
    Write-Error "Input file not found: $InputFile"
    return
}

if (-not $OutputFile) {
    $item = Get-Item $InputFile
    $base = $item.BaseName
    $dir = $item.DirectoryName
    $OutputFile = Join-Path $dir "${base}_filtered.csv"
}

try {
    $importParams = @{ Path = $InputFile }
    if ($NoHeader) { $importParams["Header"] = @("Col1","Col2","Col3","Col4","Col5") }

    $data = Import-Csv @importParams
    $originalCount = $data.Count

    # Filter rows
    if ($FilterColumn -and $FilterColumn -ne "") {
        $data = $data | Where-Object { $_.$FilterColumn -match $FilterPattern }
    }

    # Select columns
    if ($SelectColumns -and $SelectColumns.Count -gt 0) {
        $data = $data | Select-Object $SelectColumns
    }

    $data | Export-Csv -Path $OutputFile -NoTypeInformation -Encoding UTF8

    Write-Output "Processed: $originalCount rows -> $($data.Count) rows"
    Write-Output "Output:    $OutputFile"

    if ($data.Count -gt 0) {
        Write-Output "`nPreview (first 5 rows):"
        $data | Select-Object -First 5 | Format-Table -AutoSize
    }
} catch {
    Write-Error "Failed to process CSV: $_"
}
