// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using FlaUI.Core.AutomationElements;
using FlaUI.Core.Definitions;
using UiAutomationHelper.Models;

namespace UiAutomationHelper.Uia;

internal static class TreeWalker
{
    /// <summary>
    /// Walk an element subtree and produce a TreeNode hierarchy.
    /// </summary>
    /// <param name="root">The element to start walking from.</param>
    /// <param name="rootSelector">The selector path leading to <paramref name="root"/>.
    /// This becomes the root node's Selector field; children's selectors extend it.</param>
    /// <param name="maxDepth">Walk depth: -1 for unlimited, 0 for just the root, N for N levels of descendants.</param>
    public static TreeNode Walk(AutomationElement root, string rootSelector, int maxDepth)
    {
        return WalkInternal(root, rootSelector, maxDepth);
    }

    private static TreeNode WalkInternal(AutomationElement el, string selector, int remainingDepth)
    {
        var node = BuildNode(el);
        node.Selector = selector;
        if (remainingDepth == 0)
        {
            return node;
        }
        AutomationElement[] children;
        try
        {
            children = el.FindAllChildren();
        }
        catch
        {
            // Some elements throw when enumerating children (e.g., transient/disposed). Skip.
            return node;
        }
        foreach (var c in children)
        {
            var childSelector = selector + Selectors.BuildSegment(c);
            node.Children.Add(WalkInternal(c, childSelector, remainingDepth > 0 ? remainingDepth - 1 : -1));
        }
        return node;
    }

    private static TreeNode BuildNode(AutomationElement el)
    {
        var rect = el.Properties.BoundingRectangle.ValueOrDefault;
        var node = new TreeNode
        {
            ControlType = el.ControlType.ToString(),
            Name = NullIfEmpty(el.Properties.Name.ValueOrDefault),
            AutomationId = NullIfEmpty(el.Properties.AutomationId.ValueOrDefault),
            ClassName = NullIfEmpty(el.Properties.ClassName.ValueOrDefault),
            IsEnabled = el.Properties.IsEnabled.ValueOrDefault,
            IsOffscreen = el.Properties.IsOffscreen.ValueOrDefault,
            HasKeyboardFocus = el.Properties.HasKeyboardFocus.ValueOrDefault,
            BoundingRect = new Rect(rect.X, rect.Y, rect.Width, rect.Height),
            Patterns = GetPatterns(el),
            Value = TryGetValue(el),
            ToggleState = TryGetToggleState(el),
        };
        return node;
    }

    private static List<string> GetPatterns(AutomationElement el)
    {
        var patterns = new List<string>(8);
        try { if (el.Patterns.Invoke.IsSupported) patterns.Add("Invoke"); } catch { }
        try { if (el.Patterns.Toggle.IsSupported) patterns.Add("Toggle"); } catch { }
        try { if (el.Patterns.Value.IsSupported) patterns.Add("Value"); } catch { }
        try { if (el.Patterns.RangeValue.IsSupported) patterns.Add("RangeValue"); } catch { }
        try { if (el.Patterns.Selection.IsSupported) patterns.Add("Selection"); } catch { }
        try { if (el.Patterns.SelectionItem.IsSupported) patterns.Add("SelectionItem"); } catch { }
        try { if (el.Patterns.ExpandCollapse.IsSupported) patterns.Add("ExpandCollapse"); } catch { }
        try { if (el.Patterns.Scroll.IsSupported) patterns.Add("Scroll"); } catch { }
        try { if (el.Patterns.Window.IsSupported) patterns.Add("Window"); } catch { }
        try { if (el.Patterns.Text.IsSupported) patterns.Add("Text"); } catch { }
        return patterns;
    }

    private static string? TryGetValue(AutomationElement el)
    {
        try
        {
            if (el.Patterns.Value.IsSupported)
            {
                return el.Patterns.Value.Pattern.Value.ValueOrDefault;
            }
        }
        catch { }
        return null;
    }

    private static string? TryGetToggleState(AutomationElement el)
    {
        try
        {
            if (el.Patterns.Toggle.IsSupported)
            {
                return el.Patterns.Toggle.Pattern.ToggleState.ValueOrDefault switch
                {
                    ToggleState.On => "on",
                    ToggleState.Off => "off",
                    ToggleState.Indeterminate => "indeterminate",
                    _ => null,
                };
            }
        }
        catch { }
        return null;
    }

    private static string? NullIfEmpty(string? s) => string.IsNullOrEmpty(s) ? null : s;
}
