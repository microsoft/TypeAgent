// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using FlaUI.Core.AutomationElements;
using UiAutomationHelper.Models;

namespace UiAutomationHelper.Uia;

internal static class Selectors
{
    /// <summary>
    /// Builds a "/ControlType[predicate]" segment for an element.
    /// Priority: AutomationId → Name → ClassName → bare ControlType.
    /// </summary>
    public static string BuildSegment(AutomationElement el)
    {
        var ct = el.ControlType.ToString();
        var aid = NullIfEmpty(el.Properties.AutomationId.ValueOrDefault);
        var name = NullIfEmpty(el.Properties.Name.ValueOrDefault);
        var cls = NullIfEmpty(el.Properties.ClassName.ValueOrDefault);

        SelectorSegment seg;
        if (aid != null)
        {
            seg = new SelectorSegment(ct, AutomationId: aid);
        }
        else if (name != null)
        {
            seg = new SelectorSegment(ct, Name: name);
        }
        else if (cls != null)
        {
            seg = new SelectorSegment(ct, ClassName: cls);
        }
        else
        {
            seg = new SelectorSegment(ct);
        }
        return SelectorParser.FormatSegment(seg);
    }

    private static string? NullIfEmpty(string? s) => string.IsNullOrEmpty(s) ? null : s;
}
