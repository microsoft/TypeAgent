// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using FlaUI.Core.AutomationElements;
using FlaUI.Core.Conditions;
using FlaUI.Core.Definitions;
using UiAutomationHelper.Models;

namespace UiAutomationHelper.Uia;

internal static class SelectorResolver
{
    /// <summary>
    /// Resolve a selector path starting from the desktop. Returns null if any segment fails.
    /// </summary>
    public static AutomationElement? Resolve(SelectorPath path)
    {
        var current = AutomationHost.Automation.GetDesktop();
        var cf = AutomationHost.Automation.ConditionFactory;

        foreach (var seg in path.Segments)
        {
            var condition = BuildCondition(seg, cf);
            var children = current.FindAllChildren(condition);
            if (children.Length == 0)
            {
                return null;
            }
            if (seg.Index.HasValue)
            {
                int idx = seg.Index.Value - 1; // 1-based
                if (idx < 0 || idx >= children.Length)
                {
                    return null;
                }
                current = children[idx];
            }
            else
            {
                current = children[0];
            }
        }
        return current;
    }

    public static AutomationElement ResolveOrThrow(string selector)
    {
        var path = SelectorParser.Parse(selector);
        var el = Resolve(path);
        if (el == null)
        {
            throw new RpcException(RpcErrorCode.ElementNotFound, $"Element not found: {selector}");
        }
        return el;
    }

    private static ConditionBase BuildCondition(SelectorSegment seg, ConditionFactory cf)
    {
        var conditions = new List<ConditionBase>();
        if (TryParseControlType(seg.ControlType, out var ct))
        {
            conditions.Add(cf.ByControlType(ct));
        }
        else
        {
            throw new RpcException(RpcErrorCode.InvalidParams, $"Unknown control type: {seg.ControlType}");
        }
        if (seg.Name != null)
        {
            conditions.Add(cf.ByName(seg.Name));
        }
        if (seg.AutomationId != null)
        {
            conditions.Add(cf.ByAutomationId(seg.AutomationId));
        }
        if (seg.ClassName != null)
        {
            conditions.Add(cf.ByClassName(seg.ClassName));
        }
        return conditions.Count == 1 ? conditions[0] : new AndCondition(conditions.ToArray());
    }

    private static bool TryParseControlType(string name, out ControlType ct) =>
        Enum.TryParse(name, ignoreCase: false, out ct);
}
