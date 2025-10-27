// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System.Text.Json.Serialization;

namespace TypeAgent.AIClient;

/// <summary>
/// Settings for an AI text completion request.
/// Mirrors the original TypeScript shape and JSON field naming.
/// </summary>
public class CompletionSettings
{
    public double Temperature { get; set; } = 0;

    public int? MaxTokens { get; set; }

    public int? NumMatches { get; set; }

    public ResponseFormat? Format { get; set; }

    public int? Seed { get; set; }

    public int? TopP { get; set; }

    public static CompletionSettings CreateDefault()
    {
        return new CompletionSettings()
        {
            NumMatches = 1,
            Temperature = 0,
            Format = ResponseFormat.Json
        };
    }
}

public enum ResponseFormat
{
    Text,
    Json,
}
