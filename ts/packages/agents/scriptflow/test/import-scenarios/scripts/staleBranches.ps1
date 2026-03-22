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
    $cutoff = (Get-Date).AddDays(-$DaysStale)
    $branches = git branch --format="%(refname:short)" | Where-Object { $_ -ne "main" -and $_ -ne "master" }

    $stale = @()
    foreach ($branch in $branches) {
        $dateStr = git log -1 --format="%ci" $branch 2>$null
        if (-not $dateStr) { continue }
        $lastCommit = [datetime]::Parse($dateStr)
        if ($lastCommit -lt $cutoff) {
            $stale += [PSCustomObject]@{
                Branch     = $branch
                LastCommit = $lastCommit.ToString("yyyy-MM-dd")
                DaysAgo    = [math]::Round(((Get-Date) - $lastCommit).TotalDays)
            }
        }
    }

    if ($stale.Count -eq 0) {
        Write-Output "No stale branches found (threshold: $DaysStale days)."
    } else {
        $stale | Sort-Object DaysAgo -Descending | Format-Table -AutoSize
        Write-Output "`n$($stale.Count) stale branch(es) found."

        if ($Delete) {
            foreach ($b in $stale) {
                $confirm = Read-Host "Delete branch '$($b.Branch)'? (y/n)"
                if ($confirm -eq 'y') {
                    git branch -D $b.Branch
                    Write-Output "  Deleted: $($b.Branch)"
                }
            }
        }
    }
} finally {
    Pop-Location
}
