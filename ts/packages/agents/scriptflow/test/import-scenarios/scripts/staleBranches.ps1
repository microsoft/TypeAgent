<#
.SYNOPSIS
    Reports local git branches with no commits in the last N days.

.DESCRIPTION
    Scans a git repository for local branches and checks the date of the
    last commit on each. Branches older than the threshold are listed in a
    table. Optionally deletes them after confirmation.

.PARAMETER RepoPath
    Path to the git repository. Defaults to the current directory.

.PARAMETER DaysStale
    Number of days since last commit to consider a branch stale. Default: 30.

.PARAMETER Delete
    If set, deletes stale branches (with confirmation prompt per branch).

.EXAMPLE
    .\staleBranches.ps1 -RepoPath C:\repos\myproject -DaysStale 14
#>
param(
    [string]$RepoPath = ".",
    [int]$DaysStale = 30,
    [switch]$Delete
)

Push-Location $RepoPath
try {
    $cutoffDate = (Get-Date) - (New-TimeSpan -Days $DaysStale)
    $branches = git branch --format="%(refname:short)" | Where-Object { $_ -ne "main" -and $_ -ne "master" }

    $staleLines = @()
    $staleCount = 0
    $staleBranches = @()
    foreach ($branch in $branches) {
        $dateStr = git log -1 --format="%ci" $branch 2>$null
        if (-not $dateStr) { continue }
        $commitDate = Get-Date $dateStr
        if ($commitDate -lt $cutoffDate) {
            $daysAgo = ((Get-Date) - $commitDate).Days
            $dateOnly = Get-Date $commitDate -Format "yyyy-MM-dd"
            $staleLines += "  $branch  (last commit: $dateOnly, $daysAgo days ago)"
            $staleBranches += $branch
            $staleCount++
        }
    }

    if ($staleCount -eq 0) {
        Write-Output "No stale branches found (threshold: $DaysStale days)."
    } else {
        Write-Output "Stale branches (older than $DaysStale days):"
        Write-Output ($staleLines -join "`n")
        Write-Output "`n$staleCount stale branch(es) found."

        if ($Delete) {
            foreach ($b in $staleBranches) {
                $confirm = Read-Host "Delete branch '$b'? (y/n)"
                if ($confirm -eq 'y') {
                    git branch -D $b
                    Write-Output "  Deleted: $b"
                }
            }
        }
    }
} finally {
    Pop-Location
}
