// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System.Text.Json.Serialization;

namespace UiAutomationHelper.Models;

internal sealed class TreeNode
{
    [JsonPropertyName("selector")] public string Selector { get; set; } = "";
    [JsonPropertyName("automationId")] public string? AutomationId { get; set; }
    [JsonPropertyName("name")] public string? Name { get; set; }
    [JsonPropertyName("controlType")] public string ControlType { get; set; } = "";
    [JsonPropertyName("className")] public string? ClassName { get; set; }
    [JsonPropertyName("isEnabled")] public bool IsEnabled { get; set; }
    [JsonPropertyName("isOffscreen")] public bool IsOffscreen { get; set; }
    [JsonPropertyName("hasKeyboardFocus")] public bool HasKeyboardFocus { get; set; }
    [JsonPropertyName("patterns")] public List<string> Patterns { get; set; } = new();
    [JsonPropertyName("boundingRect")] public Rect BoundingRect { get; set; } = new(0, 0, 0, 0);
    [JsonPropertyName("value")] public string? Value { get; set; }
    [JsonPropertyName("toggleState")] public string? ToggleState { get; set; }
    [JsonPropertyName("children")] public List<TreeNode> Children { get; set; } = new();
}

internal sealed record Rect(
    [property: JsonPropertyName("x")] double X,
    [property: JsonPropertyName("y")] double Y,
    [property: JsonPropertyName("width")] double Width,
    [property: JsonPropertyName("height")] double Height);
