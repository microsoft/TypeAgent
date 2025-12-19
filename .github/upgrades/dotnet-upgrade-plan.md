# .NET 8.0 Upgrade Plan

## Execution Steps

Execute steps below sequentially one by one in the order they are listed.

1. Validate that a .NET 8.0 SDK required for this upgrade is installed on the machine and if not, help to get it installed.
2. Ensure that the SDK version specified in global.json files is compatible with the .NET 8.0 upgrade.
3. Upgrade autoShell.csproj

## Settings

This section contains settings and data used by execution steps.

### Excluded projects

No projects are excluded from this upgrade.

### Aggregate NuGet packages modifications across all projects

NuGet packages used across all selected projects or their dependencies that need version update in projects that reference them.

| Package Name                        | Current Version | New Version | Description                                              |
|:------------------------------------|:---------------:|:-----------:|:---------------------------------------------------------|
| AudioSwitcher.AudioApi              | 3.0.0           |             | No supported version found for .NET 8.0 - needs removal  |
| AudioSwitcher.AudioApi.CoreAudio    | 3.0.3           |             | No supported version found for .NET 8.0 - needs removal  |
| Newtonsoft.Json                     | 13.0.3          | 13.0.4      | Recommended for .NET 8.0                                 |

### Project upgrade details

This section contains details about each project upgrade and modifications that need to be done in the project.

#### autoShell.csproj modifications

Project properties changes:
- Project file needs to be converted to SDK-style
- Target framework should be changed from `net48` to `net8.0-windows`

NuGet packages changes:
- AudioSwitcher.AudioApi should be removed (*no supported version for .NET 8.0*)
- AudioSwitcher.AudioApi.CoreAudio should be removed (*no supported version for .NET 8.0*)
- Newtonsoft.Json should be updated from `13.0.3` to `13.0.4` (*recommended for .NET 8.0*)

Other changes:
- Code using AudioSwitcher APIs will need to be updated or alternative audio control libraries found
