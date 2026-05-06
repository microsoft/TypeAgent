// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System.Text.Json;
using System.Text.Json.Serialization;
using FlaUI.Core.AutomationElements;
using FlaUI.Core.Definitions;
using FlaUI.Core.Input;
using UiAutomationHelper.Models;
using UiAutomationHelper.Rpc;
using UiAutomationHelper.Uia;

namespace UiAutomationHelper.Methods;

internal static class ActionMethods
{
    public static void Register(Dispatch dispatch)
    {
        dispatch.Register("do.invoke",   (p, ct) => Task.FromResult(Invoke(p)));
        dispatch.Register("do.toggle",   (p, ct) => Task.FromResult(Toggle(p)));
        dispatch.Register("do.setValue", (p, ct) => Task.FromResult(SetValue(p)));
        dispatch.Register("do.select",   (p, ct) => Task.FromResult(Select(p)));
        dispatch.Register("do.expand",   (p, ct) => Task.FromResult(Expand(p)));
        dispatch.Register("do.scroll",   (p, ct) => Task.FromResult(Scroll(p)));
        dispatch.Register("do.focus",    (p, ct) => Task.FromResult(Focus(p)));
        dispatch.Register("do.click",    (p, ct) => Task.FromResult(Click(p)));
        dispatch.Register("do.sendKeys", (p, ct) => Task.FromResult(SendKeys(p)));
    }

    private static object? Invoke(JsonElement? @params)
    {
        var p = RpcParams.ParseRequired<DoInvokeParams>(@params);
        var el = ResolveAndCheckEnabled(p.Selector);
        if (!el.Patterns.Invoke.IsSupported)
        {
            throw new RpcException(RpcErrorCode.PatternNotSupported,
                $"Element does not support Invoke: {p.Selector}");
        }
        el.Patterns.Invoke.Pattern.Invoke();
        return new { ok = true };
    }

    private static object? Toggle(JsonElement? @params)
    {
        var p = RpcParams.ParseRequired<DoToggleParams>(@params);
        var el = ResolveAndCheckEnabled(p.Selector);
        if (!el.Patterns.Toggle.IsSupported)
        {
            throw new RpcException(RpcErrorCode.PatternNotSupported,
                $"Element does not support Toggle: {p.Selector}");
        }
        var pattern = el.Patterns.Toggle.Pattern;
        if (p.Value.HasValue)
        {
            var desired = p.Value.Value ? ToggleState.On : ToggleState.Off;
            // Tri-state controls take up to 3 toggles to reach a chosen On/Off state.
            for (int i = 0; i < 3; i++)
            {
                if (pattern.ToggleState.Value == desired)
                {
                    break;
                }
                pattern.Toggle();
            }
        }
        else
        {
            pattern.Toggle();
        }
        return new { ok = true, toggleState = ToggleStateString(pattern.ToggleState.Value) };
    }

    private static object? SetValue(JsonElement? @params)
    {
        var p = RpcParams.ParseRequired<DoSetValueParams>(@params);
        var el = ResolveAndCheckEnabled(p.Selector);
        var raw = p.Value?.ToString() ?? "";

        if (el.Patterns.Value.IsSupported &&
            el.Patterns.Value.Pattern.IsReadOnly.ValueOrDefault == false)
        {
            el.Patterns.Value.Pattern.SetValue(raw);
            return new { ok = true };
        }
        if (el.Patterns.RangeValue.IsSupported)
        {
            if (!double.TryParse(raw, System.Globalization.NumberStyles.Any,
                System.Globalization.CultureInfo.InvariantCulture, out var num))
            {
                throw new RpcException(RpcErrorCode.InvalidParams,
                    $"Value '{raw}' is not numeric for RangeValue control");
            }
            el.Patterns.RangeValue.Pattern.SetValue(num);
            return new { ok = true };
        }
        throw new RpcException(RpcErrorCode.PatternNotSupported,
            $"Element supports neither writable Value nor RangeValue: {p.Selector}");
    }

    private static object? Select(JsonElement? @params)
    {
        var p = RpcParams.ParseRequired<DoSelectParams>(@params);
        var el = ResolveAndCheckEnabled(p.Selector);

        if (el.Patterns.SelectionItem.IsSupported)
        {
            el.Patterns.SelectionItem.Pattern.Select();
            return new { ok = true };
        }
        if (el.Patterns.Selection.IsSupported)
        {
            if (p.Item == null || !p.Item.HasValue)
            {
                throw new RpcException(RpcErrorCode.InvalidParams,
                    "'item' is required when selecting from a Selection container");
            }
            var item = p.Item.Value;
            AutomationElement? target = null;
            var children = el.FindAllChildren();
            if (item.ValueKind == JsonValueKind.Number)
            {
                int idx = item.GetInt32();
                if (idx >= 0 && idx < children.Length)
                {
                    target = children[idx];
                }
            }
            else if (item.ValueKind == JsonValueKind.String)
            {
                string? name = item.GetString();
                target = Array.Find(children,
                    c => string.Equals(c.Properties.Name.ValueOrDefault, name, StringComparison.Ordinal));
            }
            if (target == null)
            {
                throw new RpcException(RpcErrorCode.ElementNotFound,
                    "Selection container has no matching item");
            }
            if (!target.Patterns.SelectionItem.IsSupported)
            {
                throw new RpcException(RpcErrorCode.PatternNotSupported,
                    "Matched child does not support SelectionItem");
            }
            target.Patterns.SelectionItem.Pattern.Select();
            return new { ok = true };
        }
        throw new RpcException(RpcErrorCode.PatternNotSupported,
            $"Element supports neither SelectionItem nor Selection: {p.Selector}");
    }

    private static object? Expand(JsonElement? @params)
    {
        var p = RpcParams.ParseRequired<DoExpandParams>(@params);
        var el = ResolveAndCheckEnabled(p.Selector);
        if (!el.Patterns.ExpandCollapse.IsSupported)
        {
            throw new RpcException(RpcErrorCode.PatternNotSupported,
                $"Element does not support ExpandCollapse: {p.Selector}");
        }
        var pattern = el.Patterns.ExpandCollapse.Pattern;
        if (p.ExpandValue)
        {
            pattern.Expand();
        }
        else
        {
            pattern.Collapse();
        }
        return new { ok = true };
    }

    private static object? Scroll(JsonElement? @params)
    {
        var p = RpcParams.ParseRequired<DoScrollParams>(@params);
        var el = ResolveAndCheckEnabled(p.Selector);
        if (!el.Patterns.Scroll.IsSupported)
        {
            throw new RpcException(RpcErrorCode.PatternNotSupported,
                $"Element does not support Scroll: {p.Selector}");
        }
        bool large = string.Equals(p.Amount, "large", StringComparison.OrdinalIgnoreCase);
        var (h, v) = (p.Direction ?? "down").ToLowerInvariant() switch
        {
            "up" => (ScrollAmount.NoAmount, large ? ScrollAmount.LargeDecrement : ScrollAmount.SmallDecrement),
            "down" => (ScrollAmount.NoAmount, large ? ScrollAmount.LargeIncrement : ScrollAmount.SmallIncrement),
            "left" => (large ? ScrollAmount.LargeDecrement : ScrollAmount.SmallDecrement, ScrollAmount.NoAmount),
            "right" => (large ? ScrollAmount.LargeIncrement : ScrollAmount.SmallIncrement, ScrollAmount.NoAmount),
            _ => throw new RpcException(RpcErrorCode.InvalidParams,
                $"Unknown direction: {p.Direction}"),
        };
        el.Patterns.Scroll.Pattern.Scroll(h, v);
        return new { ok = true };
    }

    private static object? Focus(JsonElement? @params)
    {
        var p = RpcParams.ParseRequired<DoFocusParams>(@params);
        if (string.IsNullOrEmpty(p.Selector))
        {
            throw new RpcException(RpcErrorCode.InvalidParams, "'selector' is required");
        }
        var el = SelectorResolver.ResolveOrThrow(p.Selector);
        el.Focus();
        return new { ok = true };
    }

    private static object? Click(JsonElement? @params)
    {
        var p = RpcParams.ParseRequired<DoClickParams>(@params);
        if (string.IsNullOrEmpty(p.Selector))
        {
            throw new RpcException(RpcErrorCode.InvalidParams, "'selector' is required");
        }
        var el = SelectorResolver.ResolveOrThrow(p.Selector);
        var rect = el.Properties.BoundingRectangle.ValueOrDefault;
        int x = rect.X + rect.Width / 2;
        int y = rect.Y + rect.Height / 2;
        if (p.Position != null)
        {
            if (p.Position.X.HasValue) x = (int)p.Position.X.Value;
            if (p.Position.Y.HasValue) y = (int)p.Position.Y.Value;
        }
        var pt = new System.Drawing.Point(x, y);
        if (string.Equals(p.Button, "right", StringComparison.OrdinalIgnoreCase))
        {
            Mouse.RightClick(pt);
        }
        else
        {
            Mouse.LeftClick(pt);
        }
        return new { ok = true };
    }

    private static object? SendKeys(JsonElement? @params)
    {
        var p = RpcParams.ParseRequired<DoSendKeysParams>(@params);
        if (string.IsNullOrEmpty(p.Keys))
        {
            throw new RpcException(RpcErrorCode.InvalidParams, "'keys' is required");
        }
        if (!string.IsNullOrEmpty(p.Selector))
        {
            var el = SelectorResolver.ResolveOrThrow(p.Selector);
            el.Focus();
        }
        Keyboard.Type(p.Keys);
        return new { ok = true };
    }

    private static AutomationElement ResolveAndCheckEnabled(string? selector)
    {
        if (string.IsNullOrEmpty(selector))
        {
            throw new RpcException(RpcErrorCode.InvalidParams, "'selector' is required");
        }
        var el = SelectorResolver.ResolveOrThrow(selector);
        if (!el.Properties.IsEnabled.ValueOrDefault)
        {
            throw new RpcException(RpcErrorCode.ElementNotEnabled, $"Element is not enabled: {selector}");
        }
        return el;
    }

    private static string ToggleStateString(ToggleState s) => s switch
    {
        ToggleState.On => "on",
        ToggleState.Off => "off",
        ToggleState.Indeterminate => "indeterminate",
        _ => "unknown",
    };
}

internal sealed class DoInvokeParams
{
    [JsonPropertyName("selector")] public string? Selector { get; set; }
}

internal sealed class DoToggleParams
{
    [JsonPropertyName("selector")] public string? Selector { get; set; }
    [JsonPropertyName("value")] public bool? Value { get; set; }
}

internal sealed class DoSetValueParams
{
    [JsonPropertyName("selector")] public string? Selector { get; set; }
    [JsonPropertyName("value")] public JsonElement? Value { get; set; }
}

internal sealed class DoSelectParams
{
    [JsonPropertyName("selector")] public string? Selector { get; set; }
    [JsonPropertyName("item")] public JsonElement? Item { get; set; }
}

internal sealed class DoExpandParams
{
    [JsonPropertyName("selector")] public string? Selector { get; set; }
    [JsonPropertyName("expand")] public bool ExpandValue { get; set; } = true;
}

internal sealed class DoScrollParams
{
    [JsonPropertyName("selector")] public string? Selector { get; set; }
    [JsonPropertyName("direction")] public string? Direction { get; set; }
    [JsonPropertyName("amount")] public string? Amount { get; set; }
}

internal sealed class DoFocusParams
{
    [JsonPropertyName("selector")] public string? Selector { get; set; }
}

internal sealed class DoClickParams
{
    [JsonPropertyName("selector")] public string? Selector { get; set; }
    [JsonPropertyName("button")] public string? Button { get; set; }
    [JsonPropertyName("position")] public ClickPosition? Position { get; set; }
}

internal sealed class ClickPosition
{
    [JsonPropertyName("x")] public double? X { get; set; }
    [JsonPropertyName("y")] public double? Y { get; set; }
}

internal sealed class DoSendKeysParams
{
    [JsonPropertyName("selector")] public string? Selector { get; set; }
    [JsonPropertyName("keys")] public string? Keys { get; set; }
}
