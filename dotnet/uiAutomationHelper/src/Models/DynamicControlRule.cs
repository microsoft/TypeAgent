// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System.Text.Json.Serialization;

namespace UiAutomationHelper.Models;

internal sealed class DynamicControlRule
{
    [JsonPropertyName("id")] public string Id { get; set; } = "";
    [JsonPropertyName("match")] public ControlMatcher Match { get; set; } = new();
    [JsonPropertyName("dynamicProperties")] public string[] DynamicProperties { get; set; } = Array.Empty<string>();
    [JsonPropertyName("semantic")] public string? Semantic { get; set; }
    [JsonPropertyName("reason")] public string? Reason { get; set; }
    [JsonPropertyName("confidence")] public double Confidence { get; set; }
    [JsonPropertyName("observations")] public int Observations { get; set; }
    [JsonPropertyName("firstSeen")] public string? FirstSeen { get; set; }
    [JsonPropertyName("lastConfirmed")] public string? LastConfirmed { get; set; }
    [JsonPropertyName("notes")] public string? Notes { get; set; }
}

internal sealed class ControlMatcher
{
    /// <summary>
    /// One of: "automationId", "selector", "selectorPattern", "container".
    /// </summary>
    [JsonPropertyName("kind")] public string Kind { get; set; } = "";

    // automationId / selector / selectorPattern
    [JsonPropertyName("value")] public string? Value { get; set; }
    [JsonPropertyName("pattern")] public string? Pattern { get; set; }

    // container
    [JsonPropertyName("container")] public string? Container { get; set; }
    [JsonPropertyName("controlType")] public string? ControlType { get; set; }
    [JsonPropertyName("nameRegex")] public string? NameRegex { get; set; }
    [JsonPropertyName("classNameRegex")] public string? ClassNameRegex { get; set; }
}
