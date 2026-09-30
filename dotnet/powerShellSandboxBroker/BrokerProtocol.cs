// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System.Text.Json;
using System.Text.Json.Serialization;

namespace TypeAgent.PowerShellSandboxBroker;

internal sealed record BrokerRequest(
    int ProtocolVersion,
    string Script,
    JsonElement Parameters,
    string[] AllowedCommands,
    int TimeoutSeconds,
    int MaxOutputBytes,
    string Provenance);

internal sealed record BrokerResponse(
    bool Success,
    string Stdout,
    string Stderr,
    int ExitCode,
    long Duration,
    bool Truncated,
    bool Cancelled,
    string? ErrorCode = null);

internal sealed record HostRequest(
    int ProtocolVersion,
    string Script,
    string ParametersJson,
    string[] AllowedCommands,
    int TimeoutSeconds,
    bool Diagnostics);

[JsonSourceGenerationOptions(
    PropertyNamingPolicy = JsonKnownNamingPolicy.CamelCase,
    PropertyNameCaseInsensitive = true,
    DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull)]
[JsonSerializable(typeof(BrokerRequest))]
[JsonSerializable(typeof(BrokerResponse))]
[JsonSerializable(typeof(HostRequest))]
internal sealed partial class BrokerJsonContext : JsonSerializerContext;

internal static class BrokerProtocol
{
    internal const int CurrentVersion = 1;
    internal const int MaximumRequestBytes = 1024 * 1024;
    internal const int MaximumScriptCharacters = 512 * 1024;
    internal const int MaximumTimeoutSeconds = 120;
    internal const int DefaultMaximumOutputBytes = 1024 * 1024;

    internal static readonly HashSet<string> SafeCommands = new(
        [
            "ConvertFrom-Csv",
            "ConvertFrom-Json",
            "ConvertTo-Csv",
            "ConvertTo-Json",
            "ForEach-Object",
            "Format-List",
            "Format-Table",
            "Get-Date",
            "Group-Object",
            "Measure-Object",
            "Out-String",
            "Select-Object",
            "Sort-Object",
            "Start-Sleep",
            "Where-Object",
            "Write-Output",
        ],
        StringComparer.OrdinalIgnoreCase);

    internal static BrokerRequest ParseAndValidate(string json)
    {
        var request =
            JsonSerializer.Deserialize(
                json,
                BrokerJsonContext.Default.BrokerRequest)
            ?? throw new BrokerPolicyException("broker.invalidRequest", "The broker request is empty.");

        if (request.ProtocolVersion != CurrentVersion)
        {
            throw new BrokerPolicyException(
                "broker.unsupportedProtocol",
                $"Unsupported broker protocol version {request.ProtocolVersion}.");
        }
        if (string.IsNullOrWhiteSpace(request.Script))
        {
            throw new BrokerPolicyException("broker.invalidRequest", "The script is empty.");
        }
        if (request.Script.Length > MaximumScriptCharacters)
        {
            throw new BrokerPolicyException("broker.requestTooLarge", "The script exceeds the broker limit.");
        }
        if (request.TimeoutSeconds is < 1 or > MaximumTimeoutSeconds)
        {
            throw new BrokerPolicyException("broker.invalidRequest", "The timeout is outside the broker limit.");
        }
        if (request.MaxOutputBytes is < 1 or > DefaultMaximumOutputBytes)
        {
            throw new BrokerPolicyException("broker.invalidRequest", "The output limit is outside the broker limit.");
        }
        var unsupported = request.AllowedCommands
            .Where(command => !SafeCommands.Contains(command))
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .Order(StringComparer.OrdinalIgnoreCase)
            .ToArray();
        if (unsupported.Length > 0)
        {
            throw new BrokerPolicyException(
                "broker.policyDenied",
                "The broker policy denied an unsupported command.");
        }
        return request with
        {
            AllowedCommands = request.AllowedCommands
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .Order(StringComparer.OrdinalIgnoreCase)
                .ToArray(),
        };
    }
}

internal sealed class BrokerPolicyException(string errorCode, string message) : Exception(message)
{
    internal string ErrorCode { get; } = errorCode;
}
