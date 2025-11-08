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
    public CompletionSettings() { }

    public CompletionSettings(CompletionSettings src)
    {
        ArgumentVerify.ThrowIfNull(src, nameof(src));

        Temperature = src.Temperature;
        MaxTokens = src.MaxTokens;
        NumMatches = src.NumMatches;
        Format = src.Format;
        Seed = src.Seed;
        TopP = src.TopP;
    }

    public double Temperature { get; set; } = 0;

    public int? MaxTokens { get; set; }

    public int? NumMatches { get; set; }

    public ResponseFormat? Format { get; set; }

    public int? Seed { get; set; }

    public int? TopP { get; set; }

    public CompletionSettings Clone(ResponseFormat? format = null)
    {
        CompletionSettings copy = new CompletionSettings(this);
        if (format is not null)
        {
            copy.Format = format;
        }
        return copy;
    }

    public static CompletionSettings CreateDefault(ResponseFormat format = ResponseFormat.Json)
    {
        return new CompletionSettings()
        {
            NumMatches = 1,
            Temperature = 0,
            Format = format
        };
    }
}

public enum ResponseFormat
{
    Text,
    Json,
}
