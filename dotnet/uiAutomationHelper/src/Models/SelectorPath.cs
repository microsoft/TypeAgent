// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace UiAutomationHelper.Models;

internal sealed record SelectorPath(IReadOnlyList<SelectorSegment> Segments);

internal sealed record SelectorSegment(
    string ControlType,
    string? Name = null,
    string? AutomationId = null,
    string? ClassName = null,
    int? Index = null);
