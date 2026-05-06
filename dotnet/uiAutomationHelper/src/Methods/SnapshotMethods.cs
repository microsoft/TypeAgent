// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System.Text.Json;
using System.Text.Json.Serialization;
using UiAutomationHelper.Models;
using UiAutomationHelper.Rpc;
using UiAutomationHelper.Snapshot;

namespace UiAutomationHelper.Methods;

internal static class SnapshotMethods
{
    private static readonly JsonSerializerOptions ManifestJsonOpts = new()
    {
        WriteIndented = true,
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
    };

    public static void Register(Dispatch dispatch)
    {
        dispatch.Register("snapshot.capture", (p, ct) => Task.FromResult(Capture(p)));
        dispatch.Register("snapshot.restore", (p, ct) => Task.FromResult(Restore(p)));
        dispatch.Register("snapshot.delete",  (p, ct) => Task.FromResult(Delete(p)));
    }

    private static object? Capture(JsonElement? @params)
    {
        var p = RpcParams.ParseRequired<SnapshotCaptureParams>(@params);
        if (string.IsNullOrEmpty(p.SnapshotDir) || p.Policy == null)
        {
            throw new RpcException(RpcErrorCode.InvalidParams, "'snapshotDir' and 'policy' are required");
        }
        var policy = p.Policy;
        var snapshotDir = Path.GetFullPath(p.SnapshotDir);
        Directory.CreateDirectory(snapshotDir);

        if (NeedsKill(policy))
        {
            ProcessKiller.KillByIdentity(
                policy.ProcessIdentity?.Aumid,
                policy.ProcessIdentity?.ProcessName);
        }

        var manifest = new SnapshotManifest
        {
            CapturedAt = DateTime.UtcNow.ToString("o"),
            IntegrationName = policy.IntegrationName,
        };
        long total = 0;
        var sourcesDir = Path.Combine(snapshotDir, "sources");
        Directory.CreateDirectory(sourcesDir);

        for (int i = 0; i < policy.State.Count; i++)
        {
            var src = policy.State[i];
            var record = new SnapshotSourceRecord { Index = i, Kind = src.Kind };
            switch (src.Kind)
            {
                case "folder":
                    var path = ExpandPath(src.Path ?? "");
                    record.Source = path;
                    var slot = Path.Combine(sourcesDir, i.ToString());
                    record.StoredAt = Path.GetRelativePath(snapshotDir, slot).Replace('\\', '/');
                    record.Bytes = FolderSnapshotter.Capture(path, slot, src.Exclude);
                    break;
                case "registry":
                case "appCommand":
                    throw new RpcException(RpcErrorCode.InvalidParams,
                        $"Source kind '{src.Kind}' not yet supported (slice 3a is folder-only)");
                default:
                    throw new RpcException(RpcErrorCode.InvalidParams,
                        $"Unknown source kind: {src.Kind}");
            }
            manifest.Sources.Add(record);
            total += record.Bytes;
        }
        manifest.TotalBytes = total;
        File.WriteAllText(
            Path.Combine(snapshotDir, "manifest.json"),
            JsonSerializer.Serialize(manifest, ManifestJsonOpts));

        return new
        {
            snapshotId = Path.GetFileName(snapshotDir),
            bytes = total,
            sourceCount = manifest.Sources.Count,
        };
    }

    private static object? Restore(JsonElement? @params)
    {
        var p = RpcParams.ParseRequired<SnapshotCaptureParams>(@params);
        if (string.IsNullOrEmpty(p.SnapshotDir) || p.Policy == null)
        {
            throw new RpcException(RpcErrorCode.InvalidParams, "'snapshotDir' and 'policy' are required");
        }
        var snapshotDir = Path.GetFullPath(p.SnapshotDir);
        if (!Directory.Exists(snapshotDir))
        {
            throw new RpcException(RpcErrorCode.SnapshotMissing, $"Snapshot not found: {snapshotDir}");
        }
        var policy = p.Policy;

        if (NeedsKill(policy))
        {
            ProcessKiller.KillByIdentity(
                policy.ProcessIdentity?.Aumid,
                policy.ProcessIdentity?.ProcessName);
        }

        var sourcesDir = Path.Combine(snapshotDir, "sources");
        long total = 0;
        for (int i = 0; i < policy.State.Count; i++)
        {
            var src = policy.State[i];
            switch (src.Kind)
            {
                case "folder":
                    var target = ExpandPath(src.Path ?? "");
                    var slot = Path.Combine(sourcesDir, i.ToString());
                    total += FolderSnapshotter.Restore(slot, target);
                    break;
                case "registry":
                case "appCommand":
                    throw new RpcException(RpcErrorCode.InvalidParams,
                        $"Source kind '{src.Kind}' not yet supported (slice 3a is folder-only)");
            }
        }
        return new { ok = true, bytes = total };
    }

    private static object? Delete(JsonElement? @params)
    {
        var p = RpcParams.ParseRequired<SnapshotDeleteParams>(@params);
        if (string.IsNullOrEmpty(p.SnapshotDir))
        {
            throw new RpcException(RpcErrorCode.InvalidParams, "'snapshotDir' is required");
        }
        var dir = Path.GetFullPath(p.SnapshotDir);
        if (Directory.Exists(dir))
        {
            Directory.Delete(dir, recursive: true);
        }
        return new { ok = true };
    }

    private static bool NeedsKill(SnapshotPolicy policy)
    {
        foreach (var s in policy.State)
        {
            // Default: kill for folder + appCommand, not for registry.
            var defaultKill = s.Kind switch
            {
                "registry" => false,
                _ => true,
            };
            if (s.RequireKill ?? defaultKill)
            {
                return true;
            }
        }
        return false;
    }

    private static string ExpandPath(string p) =>
        Environment.ExpandEnvironmentVariables(p);
}

internal sealed class SnapshotCaptureParams
{
    [JsonPropertyName("snapshotDir")] public string? SnapshotDir { get; set; }
    [JsonPropertyName("policy")] public SnapshotPolicy? Policy { get; set; }
}

internal sealed class SnapshotDeleteParams
{
    [JsonPropertyName("snapshotDir")] public string? SnapshotDir { get; set; }
}
