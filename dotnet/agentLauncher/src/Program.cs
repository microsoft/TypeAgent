using System.Diagnostics;
using System.Text;

namespace AgentLauncher;

class Program
{
    private static readonly string LogFilePath = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        "AgentLauncher",
        "agent.log");

    private static readonly Stopwatch _processStopwatch = Stopwatch.StartNew();

    [STAThread]
    static int Main(string[] args)
    {
        try
        {
            LogTiming("PROCESS_START", "Process started");
            Log("TypeAgent Launcher starting...");
            Log($"Arguments: {string.Join(" ", args)}");

            LogTiming("ARGS_PARSED", "Arguments parsed");

            if (args.Length > 0)
            {
                var firstArg = args[0];

                // COM server registration removed - using URI protocol activation instead
                if (firstArg.StartsWith("typeagent-launcher:", StringComparison.OrdinalIgnoreCase))
                {
                    LogTiming("PROTOCOL_DETECTED", "Protocol activation detected");
                    Log($"Protocol activation received: {firstArg}");
                    var result = HandleProtocolActivation(firstArg).GetAwaiter().GetResult();
                    LogTiming("PROCESS_COMPLETE", "Process complete");
                    return result;
                }
                else if (firstArg == "--settings" || firstArg == "-s")
                {
                    return HandleSettingsCommand(args.Skip(1).ToArray());
                }
                else if (firstArg == "--test" || firstArg == "-t")
                {
                    var prompt = args.Length > 1 ? args[1] : "Hello, agent!";
                    return TestAgent(prompt).GetAwaiter().GetResult();
                }
                else if (firstArg == "--register" || firstArg == "-r")
                {
                    return RegisterWithODR();
                }
                else if (firstArg == "--help" || firstArg == "-h")
                {
                    PrintHelp();
                    return 0;
                }
            }

            Log("No recognized arguments, exiting silently");
            return 0;
        }
        catch (Exception ex)
        {
            Log($"ERROR: {ex}");
            Console.Error.WriteLine($"Error: {ex.Message}");
            return 1;
        }
    }

    private static async Task<int> HandleProtocolActivation(string uriString)
    {
        try
        {
            LogTiming("URI_PARSE_START", "Starting URI parse");
            var uri = new Uri(uriString);
            Log($"Parsing URI: {uri}");

            var queryParams = ParseQueryString(uri.Query);
            LogTiming("URI_PARSE_COMPLETE", "URI parsed");

            var agentName = queryParams.GetValueOrDefault("agentName");
            var prompt = queryParams.GetValueOrDefault("prompt");

            if (string.IsNullOrWhiteSpace(agentName) || string.IsNullOrWhiteSpace(prompt))
            {
                var error = $"Missing required parameters. agentName: {agentName ?? "(null)"}, prompt: {prompt ?? "(null)"}";
                Log($"ERROR: {error}");
                Console.Error.WriteLine(error);
                return 1;
            }

            Log($"Processing protocol activation - Agent: {agentName}, Prompt: {prompt}");
            LogTiming("NODE_CALL_START", "Starting Node.js execution");

            var result = await ProcessWithNodeAsync(agentName, prompt, null);

            LogTiming("NODE_CALL_COMPLETE", "Node.js execution complete");
            Log($"Protocol activation completed successfully");
            Log($"Result: {result?.Substring(0, Math.Min(100, result?.Length ?? 0))}...");

            return 0;
        }
        catch (Exception ex)
        {
            Log($"ERROR: Protocol activation failed: {ex}");
            Console.Error.WriteLine($"Protocol activation error: {ex.Message}");
            return 1;
        }
    }

    private static Dictionary<string, string> ParseQueryString(string query)
    {
        var result = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);

        if (string.IsNullOrWhiteSpace(query))
            return result;

        query = query.TrimStart('?');

        var pairs = query.Split('&');
        foreach (var pair in pairs)
        {
            var parts = pair.Split('=', 2);
            if (parts.Length == 2)
            {
                var key = Uri.UnescapeDataString(parts[0]);
                var value = Uri.UnescapeDataString(parts[1]);
                result[key] = value;
            }
        }

        return result;
    }

    private static int HandleSettingsCommand(string[] args)
    {
        var settings = AgentSettings.Instance;

        if (args.Length == 0)
        {
            Console.WriteLine("Current Settings:");
            Console.WriteLine($"  Script Path: {settings.ScriptPath ?? "(default)"}");
            Console.WriteLine($"  Resolved Script: {settings.GetResolvedScriptPath()}");
            Console.WriteLine($"  Node Path: {settings.NodePath ?? "(from PATH)"}");
            Console.WriteLine($"  Timeout: {settings.TimeoutMs} ms");
            Console.WriteLine($"  Verbose Logging: {settings.VerboseLogging}");
            Console.WriteLine($"  Working Directory: {settings.WorkingDirectory ?? "(default)"}");
            Console.WriteLine($"  Settings File: {AgentSettings.GetSettingsFilePath()}");

            if (settings.Environment != null && settings.Environment.Count > 0)
            {
                Console.WriteLine("  Environment Variables:");
                foreach (var (key, value) in settings.Environment)
                {
                    Console.WriteLine($"    {key}={value}");
                }
            }

            return 0;
        }

        var subcommand = args[0].ToLowerInvariant();

        if (subcommand == "open")
        {
            var settingsPath = AgentSettings.GetSettingsFilePath();
            var directory = Path.GetDirectoryName(settingsPath);
            if (directory != null && !Directory.Exists(directory))
            {
                Directory.CreateDirectory(directory);
            }
            if (!File.Exists(settingsPath))
            {
                settings.Save();
            }
            Process.Start(new ProcessStartInfo
            {
                FileName = settingsPath,
                UseShellExecute = true
            });
            Console.WriteLine($"Opened: {settingsPath}");
            return 0;
        }

        if (subcommand == "set" && args.Length >= 3)
        {
            var key = args[1].ToLowerInvariant();
            var value = args[2];

            switch (key)
            {
                case "scriptpath":
                case "script":
                    settings.ScriptPath = value;
                    break;
                case "nodepath":
                case "node":
                    settings.NodePath = value;
                    break;
                case "timeout":
                    if (int.TryParse(value, out var timeout))
                    {
                        settings.TimeoutMs = timeout;
                    }
                    else
                    {
                        Console.Error.WriteLine("Invalid timeout value");
                        return 1;
                    }
                    break;
                case "verbose":
                    if (bool.TryParse(value, out var verbose))
                    {
                        settings.VerboseLogging = verbose;
                    }
                    else
                    {
                        Console.Error.WriteLine("Invalid boolean value");
                        return 1;
                    }
                    break;
                case "workingdir":
                case "workdir":
                    settings.WorkingDirectory = value;
                    break;
                default:
                    Console.Error.WriteLine($"Unknown setting: {key}");
                    return 1;
            }

            settings.Save();
            Console.WriteLine($"Setting updated: {key} = {value}");
            return 0;
        }

        Console.Error.WriteLine("Invalid settings command");
        Console.Error.WriteLine("Usage: --settings [open | set <key> <value>]");
        return 1;
    }

    private static async Task<int> TestAgent(string prompt)
    {
        Console.WriteLine($"Testing agent with prompt: {prompt}");
        var settings = AgentSettings.Instance;
        Console.WriteLine($"Script path: {settings.GetResolvedScriptPath()}");
        Console.WriteLine();

        try
        {
            var result = await ProcessWithNodeAsync("TestAgent", prompt, null);
            Console.WriteLine("Result:");
            Console.WriteLine(result);
            return 0;
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"Test failed: {ex.Message}");
            Log($"Test failed: {ex}");
            return 1;
        }
    }

    private static int RegisterWithODR()
    {
        try
        {
            var manifestPath = Path.Combine(AppContext.BaseDirectory, "Assets", "agent-definition.json");

            if (!File.Exists(manifestPath))
            {
                Console.Error.WriteLine($"ERROR: agent-definition.json not found at: {manifestPath}");
                Log($"ERROR: agent-definition.json not found at: {manifestPath}");
                return 1;
            }

            Console.WriteLine($"Registering agent with ODR...");
            Console.WriteLine($"Manifest path: {manifestPath}");
            Log($"Registering agent with ODR using manifest: {manifestPath}");

            var processInfo = new ProcessStartInfo
            {
                FileName = "odr",
                Arguments = $"app-agents add \"{manifestPath}\"",
                CreateNoWindow = false,
                UseShellExecute = false,
                RedirectStandardOutput = true,
                RedirectStandardError = true
            };

            using var process = Process.Start(processInfo);
            if (process == null)
            {
                Console.Error.WriteLine("ERROR: Failed to start ODR process");
                Log("ERROR: Failed to start ODR process");
                return 1;
            }

            var output = process.StandardOutput.ReadToEnd();
            var error = process.StandardError.ReadToEnd();
            process.WaitForExit();

            if (!string.IsNullOrWhiteSpace(output))
            {
                Console.WriteLine(output);
                Log($"ODR output: {output}");
            }

            if (!string.IsNullOrWhiteSpace(error))
            {
                Console.Error.WriteLine(error);
                Log($"ODR error: {error}");
            }

            if (process.ExitCode == 0)
            {
                Console.WriteLine("Agent registered successfully!");
                Log("Agent registered successfully with ODR");
                return 0;
            }
            else
            {
                Console.Error.WriteLine($"ODR registration failed with exit code: {process.ExitCode}");
                Log($"ODR registration failed with exit code: {process.ExitCode}");
                return process.ExitCode;
            }
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"ERROR: {ex.Message}");
            Log($"ERROR during ODR registration: {ex}");
            return 1;
        }
    }

    private static void PrintHelp()
    {
        Console.WriteLine("TypeAgent Launcher");
        Console.WriteLine();
        Console.WriteLine("Usage:");
        Console.WriteLine("  WindowlessAgentLauncher.exe [options]");
        Console.WriteLine();
        Console.WriteLine("Options:");
        Console.WriteLine("  --settings, -s              Display current settings");
        Console.WriteLine("  --settings open             Open settings file in default editor");
        Console.WriteLine("  --settings set <key> <val>  Set a configuration value");
        Console.WriteLine("  --test, -t [prompt]         Test agent with a prompt");
        Console.WriteLine("  --register, -r              Register agent with On-Device Registry");
        Console.WriteLine("  --help, -h                  Show this help");
        Console.WriteLine();
        Console.WriteLine("Settings Keys:");
        Console.WriteLine("  scriptpath, script          Path to Node.js handler script");
        Console.WriteLine("  nodepath, node              Path to Node.js executable");
        Console.WriteLine("  timeout                     Timeout in milliseconds");
        Console.WriteLine("  verbose                     Enable verbose logging (true/false)");
        Console.WriteLine("  workingdir, workdir         Working directory for Node.js");
        Console.WriteLine();
        Console.WriteLine("Examples:");
        Console.WriteLine("  WindowlessAgentLauncher.exe --test \"Hello, world!\"");
        Console.WriteLine("  WindowlessAgentLauncher.exe --settings set scriptpath \"C:\\path\\to\\script.js\"");
    }

    public static async Task<string> ProcessWithNodeAsync(
        string agentName,
        string prompt,
        string? filePath)
    {
        LogTiming("SETTINGS_LOAD_START", "Loading settings");
        var settings = AgentSettings.Instance;
        var scriptPath = settings.GetResolvedScriptPath();
        var nodePath = settings.GetResolvedNodePath();
        LogTiming("SETTINGS_LOAD_COMPLETE", "Settings loaded");

        Log($"Processing request - Agent: {agentName}, Prompt: {prompt?.Substring(0, Math.Min(50, prompt?.Length ?? 0))}...");
        Log($"Script: {scriptPath}");
        Log($"Node: {nodePath}");

        if (!File.Exists(scriptPath))
        {
            throw new FileNotFoundException(
                $"Script not found: {scriptPath}. " +
                $"Configure the path with: --settings set scriptpath \"<path>\"");
        }

        var uri = BuildUriString(agentName, prompt, filePath);
        Log($"URI: {uri}");

        LogTiming("PROCESS_SETUP_START", "Setting up Node.js process");
        var processInfo = new ProcessStartInfo
        {
            FileName = nodePath,
            Arguments = $"\"{scriptPath}\" \"{uri}\"",
            CreateNoWindow = true,
            UseShellExecute = false,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            RedirectStandardInput = false,
            StandardOutputEncoding = Encoding.UTF8,
            StandardErrorEncoding = Encoding.UTF8
        };

        if (settings.Environment != null)
        {
            foreach (var (key, value) in settings.Environment)
            {
                processInfo.Environment[key] = value;
            }
        }

        var workingDir = settings.GetResolvedWorkingDirectory();
        if (!string.IsNullOrWhiteSpace(workingDir))
        {
            processInfo.WorkingDirectory = workingDir;
        }

        var process = new Process { StartInfo = processInfo };
        var outputBuilder = new StringBuilder();
        var errorBuilder = new StringBuilder();

        process.OutputDataReceived += (sender, e) =>
        {
            if (e.Data != null)
            {
                outputBuilder.AppendLine(e.Data);
            }
        };

        process.ErrorDataReceived += (sender, e) =>
        {
            if (e.Data != null)
            {
                errorBuilder.AppendLine(e.Data);
            }
        };

        try
        {
            LogTiming("PROCESS_START", "Starting Node.js process");
            process.Start();
            process.BeginOutputReadLine();
            process.BeginErrorReadLine();
            LogTiming("PROCESS_STARTED", "Process started, waiting for completion");

            var completed = await Task.Run(() => process.WaitForExit(settings.TimeoutMs));
            LogTiming("PROCESS_WAIT_COMPLETE", "Process wait completed");

            if (!completed)
            {
                process.Kill();
                throw new TimeoutException(
                    $"Script execution timed out after {settings.TimeoutMs}ms. " +
                    $"Increase timeout with: --settings set timeout <milliseconds>");
            }

            var exitCode = process.ExitCode;
            var output = outputBuilder.ToString().Trim();
            var error = errorBuilder.ToString().Trim();

            Log($"Exit code: {exitCode}");
            LogTiming("OUTPUT_COLLECTED", "Output and error streams collected");

            if (settings.VerboseLogging)
            {
                Log($"Output: {output}");
                Log($"Error: {error}");
            }

            if (exitCode != 0)
            {
                throw new Exception($"Script failed with exit code {exitCode}. Error: {error}");
            }

            if (string.IsNullOrWhiteSpace(output))
            {
                throw new Exception("Script produced no output");
            }

            return output;
        }
        catch (Exception ex) when (ex is not TimeoutException)
        {
            Log($"ERROR: Failed to execute Node.js script: {ex.Message}");
            throw new Exception($"Failed to execute script: {ex.Message}", ex);
        }
    }

    private static string BuildUriString(string agentName, string prompt, string? filePath)
    {
        var uri = $"type-agent://?request={Uri.EscapeDataString(prompt)}";

        if (!string.IsNullOrWhiteSpace(filePath))
        {
            uri += $"&file={Uri.EscapeDataString(filePath)}";
        }

        return uri;
    }

    public static void Log(string message)
    {
        try
        {
            var directory = Path.GetDirectoryName(LogFilePath);
            if (directory != null && !Directory.Exists(directory))
            {
                Directory.CreateDirectory(directory);
            }

            var timestamp = DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss.fff");
            var logMessage = $"[{timestamp}] {message}";

            File.AppendAllText(LogFilePath, logMessage + Environment.NewLine);
        }
        catch
        {
        }
    }

    private static void LogTiming(string marker, string description)
    {
        var elapsed = _processStopwatch.ElapsedMilliseconds;
        Log($"⏱️  TIMING [{marker}] +{elapsed}ms - {description}");
    }
}
