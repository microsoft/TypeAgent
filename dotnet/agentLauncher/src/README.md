# Windowless Agent Launcher

A Windows 11 Agent Launcher that runs headlessly and delegates to the TypeAgent URI handler.

## Phase 1: Basic Node.js Invocation (Current)

This phase implements basic functionality to invoke the Node.js URI handler script.

### Building

```powershell
cd D:\repos\TypeAgent\dotnet\agentLauncher\src\WindowlessAgentLauncher
dotnet build
```

### Testing

1. **View current settings:**
```powershell
dotnet run -- --settings
```

2. **Configure script path (if needed):**
```powershell
dotnet run -- --settings set scriptpath "D:\repos\TypeAgent\ts\packages\uriHandler\dist\index.js"
```

3. **Test with a sample prompt:**
```powershell
dotnet run -- --test "Hello, TypeAgent!"
```

The test will create a type-agent:// URI and invoke the Node.js script.

### Configuration

Settings are stored in: `%LOCALAPPDATA%\WindowlessAgentLauncher\settings.json`

Available settings:
- `scriptPath`: Path to the Node.js handler script
- `nodePath`: Path to Node.js executable (default: from PATH)
- `timeoutMs`: Execution timeout in milliseconds (default: 60000)
- `verboseLogging`: Enable detailed logging (default: false)
- `environment`: Environment variables to pass to the script
- `workingDirectory`: Working directory for the Node.js process

### Logs

Log file location: `%LOCALAPPDATA%\WindowlessAgentLauncher\agent.log`

## Next Phases

- **Phase 2**: Agent Launcher registration with Windows ODR
- **Phase 3**: End-to-end integration with Ask Copilot and Start Menu
