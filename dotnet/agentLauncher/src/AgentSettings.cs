using System.Text.Json;
using System.Text.Json.Serialization;

namespace WindowlessAgentLauncher;

public class AgentSettings
{
    private static AgentSettings? _instance;
    private static readonly object _lock = new();

    [JsonPropertyName("scriptPath")]
    public string? ScriptPath { get; set; }

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
                return _instance ??= Load();
            }
        }
    }

    public static AgentSettings Load()
    {
        var settingsPath = GetSettingsFilePath();

        try
        {
            if (File.Exists(settingsPath))
            {
                var json = File.ReadAllText(settingsPath);
                var settings = JsonSerializer.Deserialize<AgentSettings>(json);
                if (settings != null)
                {
                    Program.Log($"Settings loaded from: {settingsPath}");
                    return settings;
                }
            }
        }
        catch (Exception ex)
        {
            Program.Log($"WARN: Failed to load settings: {ex.Message}");
        }

        var defaultSettings = new AgentSettings();
        defaultSettings.Save();
        return defaultSettings;
    }

    public void Save()
    {
        var settingsPath = GetSettingsFilePath();
        var directory = Path.GetDirectoryName(settingsPath);

        if (directory != null && !Directory.Exists(directory))
        {
            Directory.CreateDirectory(directory);
        }

        var options = new JsonSerializerOptions
        {
            WriteIndented = true
        };

        var json = JsonSerializer.Serialize(this, options);
        File.WriteAllText(settingsPath, json);
        Program.Log($"Settings saved to: {settingsPath}");
    }

    public static void Reload()
    {
        lock (_lock)
        {
            _instance = Load();
        }
    }

    public string GetResolvedScriptPath()
    {
        if (!string.IsNullOrWhiteSpace(ScriptPath))
        {
            var expanded = System.Environment.ExpandEnvironmentVariables(ScriptPath);
            if (File.Exists(expanded))
            {
                return expanded;
            }
            Program.Log($"WARN: Configured script path not found: {expanded}");
        }

        var fallbackPaths = new[]
        {
            Path.Combine(AppContext.BaseDirectory, "Scripts", "agent-handler.js"),
            Path.Combine(System.Environment.GetFolderPath(System.Environment.SpecialFolder.LocalApplicationData),
                "WindowlessAgentLauncher", "Scripts", "agent-handler.js"),
            "D:\\repos\\TypeAgent\\ts\\packages\\uriHandler\\dist\\index.js"
        };

        foreach (var path in fallbackPaths)
        {
            if (File.Exists(path))
            {
                Program.Log($"Using fallback script path: {path}");
                return path;
            }
        }

        Program.Log($"WARN: No script found in fallback locations");
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

    public static string GetSettingsFilePath()
    {
        var localAppData = System.Environment.GetFolderPath(System.Environment.SpecialFolder.LocalApplicationData);
        return Path.Combine(localAppData, "WindowlessAgentLauncher", "settings.json");
    }
}
