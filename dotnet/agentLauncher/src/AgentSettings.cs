// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System.Text.Json.Serialization;

namespace AgentLauncher;

public class AgentSettings
{
    private static AgentSettings? _instance;
    private static readonly object _lock = new();

    [JsonPropertyName("nodePath")]
    public string? NodePath { get; set; }

    [JsonPropertyName("timeoutMs")]
    public int TimeoutMs { get; set; } = 60000;

    [JsonPropertyName("verboseLogging")]
    public bool VerboseLogging { get; set; } = false;

    [JsonPropertyName("environment")]
    public Dictionary<string, string>? Environment { get; set; }

    [JsonPropertyName("workingDirectory")]
    public string? WorkingDirectory { get; set; }

    public static AgentSettings Instance
    {
        get
        {
            lock (_lock)
            {
                if (_instance == null)
                {
                    _instance = new AgentSettings();
                    _instance.LoadFromEnvironment();
                }
                return _instance;
            }
        }
    }

    private void LoadFromEnvironment()
    {
        var nodePathEnv = System.Environment.GetEnvironmentVariable("TYPEAGENT_NODE_PATH");
        if (!string.IsNullOrWhiteSpace(nodePathEnv))
        {
            NodePath = nodePathEnv;
            Program.Log($"Node path from environment: {NodePath}");
        }

        var timeoutEnv = System.Environment.GetEnvironmentVariable("TYPEAGENT_TIMEOUT");
        if (!string.IsNullOrWhiteSpace(timeoutEnv) && int.TryParse(timeoutEnv, out var timeout))
        {
            TimeoutMs = timeout;
            Program.Log($"Timeout from environment: {TimeoutMs}ms");
        }

        var verboseEnv = System.Environment.GetEnvironmentVariable("TYPEAGENT_VERBOSE");
        if (!string.IsNullOrWhiteSpace(verboseEnv) && bool.TryParse(verboseEnv, out var verbose))
        {
            VerboseLogging = verbose;
            Program.Log($"Verbose logging from environment: {VerboseLogging}");
        }

        var workdirEnv = System.Environment.GetEnvironmentVariable("TYPEAGENT_WORKDIR");
        if (!string.IsNullOrWhiteSpace(workdirEnv))
        {
            WorkingDirectory = workdirEnv;
            Program.Log($"Working directory from environment: {WorkingDirectory}");
        }
    }

    public string GetResolvedScriptPath()
    {
        var fallbackPaths = new[]
        {
            Path.Combine(AppContext.BaseDirectory, "Scripts", "agent-uri-handler.bundle.js"),
            Path.Combine(System.Environment.GetFolderPath(System.Environment.SpecialFolder.LocalApplicationData),
                "AgentLauncher", "Scripts", "agent-uri-handler.bundle.js"),
            "D:\\repos\\TypeAgent\\ts\\packages\\uriHandler\\bundle\\agent-uri-handler.bundle.js",
            "D:\\repos\\TypeAgent\\ts\\packages\\uriHandler\\dist\\index.js"
        };

        foreach (var path in fallbackPaths)
        {
            if (File.Exists(path))
            {
                Program.Log($"Using script path: {path}");
                return path;
            }
        }

        Program.Log($"WARN: No script found in any fallback locations");
        return fallbackPaths[0];
    }

    public string GetResolvedNodePath()
    {
        if (!string.IsNullOrWhiteSpace(NodePath))
        {
            var expanded = System.Environment.ExpandEnvironmentVariables(NodePath);
            if (File.Exists(expanded))
            {
                return expanded;
            }
        }

        return "node";
    }

    public string? GetResolvedWorkingDirectory()
    {
        if (string.IsNullOrWhiteSpace(WorkingDirectory))
        {
            return null;
        }

        return System.Environment.ExpandEnvironmentVariables(WorkingDirectory);
    }
}
