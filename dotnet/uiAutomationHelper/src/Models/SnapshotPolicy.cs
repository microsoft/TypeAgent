// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System.Text.Json.Serialization;

namespace UiAutomationHelper.Models;

internal sealed class SnapshotPolicy
{
    [JsonPropertyName("version")] public int Version { get; set; } = 1;
    [JsonPropertyName("integrationName")] public string IntegrationName { get; set; } = "";
    [JsonPropertyName("detectionStatus")] public string? DetectionStatus { get; set; }
    [JsonPropertyName("processIdentity")] public ProcessIdentity? ProcessIdentity { get; set; }
    [JsonPropertyName("state")] public List<SnapshotSource> State { get; set; } = new();
    [JsonPropertyName("hooks")] public PolicyHooks? Hooks { get; set; }
}

internal sealed class ProcessIdentity
{
    [JsonPropertyName("aumid")] public string? Aumid { get; set; }
    [JsonPropertyName("processName")] public string? ProcessName { get; set; }
    [JsonPropertyName("exePath")] public string? ExePath { get; set; }
}

internal sealed class SnapshotSource
{
    [JsonPropertyName("kind")] public string Kind { get; set; } = "";
    // folder
    [JsonPropertyName("path")] public string? Path { get; set; }
    [JsonPropertyName("recursive")] public bool? Recursive { get; set; }
    [JsonPropertyName("exclude")] public string[]? Exclude { get; set; }
    // registry
    [JsonPropertyName("key")] public string? Key { get; set; }
    // appCommand
    [JsonPropertyName("capture")] public ScriptHook? Capture { get; set; }
    [JsonPropertyName("restore")] public ScriptHook? Restore { get; set; }
    // shared
    [JsonPropertyName("requireKill")] public bool? RequireKill { get; set; }
}

internal sealed class ScriptHook
{
    [JsonPropertyName("command")] public string Command { get; set; } = "";
    [JsonPropertyName("args")] public string[]? Args { get; set; }
    [JsonPropertyName("cwd")] public string? Cwd { get; set; }
}

internal sealed class PolicyHooks
{
    [JsonPropertyName("beforeCapture")] public ScriptHook[]? BeforeCapture { get; set; }
    [JsonPropertyName("afterRestore")] public ScriptHook[]? AfterRestore { get; set; }
}

internal sealed class SnapshotManifest
{
    [JsonPropertyName("version")] public int Version { get; set; } = 1;
    [JsonPropertyName("capturedAt")] public string CapturedAt { get; set; } = "";
    [JsonPropertyName("integrationName")] public string IntegrationName { get; set; } = "";
    [JsonPropertyName("sources")] public List<SnapshotSourceRecord> Sources { get; set; } = new();
    [JsonPropertyName("totalBytes")] public long TotalBytes { get; set; }
}

internal sealed class SnapshotSourceRecord
{
    [JsonPropertyName("index")] public int Index { get; set; }
    [JsonPropertyName("kind")] public string Kind { get; set; } = "";
    [JsonPropertyName("source")] public string Source { get; set; } = "";   // resolved path/key
    [JsonPropertyName("storedAt")] public string StoredAt { get; set; } = "";  // relative to snapshot dir
    [JsonPropertyName("bytes")] public long Bytes { get; set; }
}
