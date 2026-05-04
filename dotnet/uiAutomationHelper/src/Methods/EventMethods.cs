// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System.Diagnostics;
using System.Text.Json;
using System.Text.Json.Serialization;
using FlaUI.Core.AutomationElements;
using FlaUI.Core.Definitions;
using UiAutomationHelper.Models;
using UiAutomationHelper.Rpc;
using UiAutomationHelper.Uia;

namespace UiAutomationHelper.Methods;

internal static class EventMethods
{
    public static void Register(Dispatch dispatch)
    {
        dispatch.Register("events.idle",        IdleAsync);
        dispatch.Register("events.subscribe",   (p, ct) => Task.FromResult(Subscribe(p)));
        dispatch.Register("events.unsubscribe", (p, ct) => Task.FromResult(Unsubscribe(p)));
    }

    private static object? Subscribe(JsonElement? @params)
    {
        var p = RpcParams.ParseRequired<EventsSubscribeParams>(@params);
        if (string.IsNullOrEmpty(p.Root))
        {
            throw new RpcException(RpcErrorCode.InvalidParams, "'root' is required");
        }
        if (p.EventTypes == null || p.EventTypes.Length == 0)
        {
            throw new RpcException(RpcErrorCode.InvalidParams, "'eventTypes' is required");
        }
        var root = SelectorResolver.ResolveOrThrow(p.Root);
        var sub = new Subscription { RootSelector = p.Root, Root = root };
        var automation = AutomationHost.Automation;
        var subId = sub.Id;

        foreach (var eventType in p.EventTypes)
        {
            switch (eventType)
            {
                case "Invoked":
                {
                    var ev = automation.EventLibrary.Invoke.InvokedEvent;
                    var h = root.RegisterAutomationEvent(
                        ev,
                        TreeScope.Subtree,
                        (el, eid) => OnAutomationEvent(subId, "Invoked", el));
                    sub.AutomationHandlers.Add((ev, h));
                    break;
                }
                case "ValueChanged":
                {
                    var pid = automation.PropertyLibrary.Value.Value;
                    var h = root.RegisterPropertyChangedEvent(
                        TreeScope.Subtree,
                        (el, prop, val) => OnPropertyChangedEvent(subId, "ValueChanged", el, val),
                        pid);
                    sub.PropertyChangedHandlers.Add(h);
                    break;
                }
                case "ToggleStateChanged":
                {
                    var pid = automation.PropertyLibrary.Toggle.ToggleState;
                    var h = root.RegisterPropertyChangedEvent(
                        TreeScope.Subtree,
                        (el, prop, val) => OnPropertyChangedEvent(subId, "ToggleStateChanged", el, val),
                        pid);
                    sub.PropertyChangedHandlers.Add(h);
                    break;
                }
                case "StructureChanged":
                {
                    var h = root.RegisterStructureChangedEvent(
                        TreeScope.Subtree,
                        (el, type, ridArr) => OnStructureChangedEvent(subId, el, type));
                    sub.StructureChangedHandlers.Add(h);
                    break;
                }
                default:
                    sub.Dispose();
                    throw new RpcException(RpcErrorCode.InvalidParams,
                        $"Unknown eventType: {eventType}. Supported: Invoked, ValueChanged, ToggleStateChanged, StructureChanged.");
            }
        }
        SubscriptionRegistry.Add(sub);
        return new { subscriptionId = sub.Id };
    }

    private static object? Unsubscribe(JsonElement? @params)
    {
        var p = RpcParams.ParseRequired<EventsUnsubscribeParams>(@params);
        if (string.IsNullOrEmpty(p.SubscriptionId))
        {
            throw new RpcException(RpcErrorCode.InvalidParams, "'subscriptionId' is required");
        }
        var ok = SubscriptionRegistry.Remove(p.SubscriptionId);
        return new { ok };
    }

    private static void OnAutomationEvent(string subId, string type, AutomationElement el)
    {
        try
        {
            var selector = Selectors.BuildAbsolutePath(el);
            Notifier.Send("event.fired", new
            {
                subscriptionId = subId,
                eventType = type,
                selector,
                controlSnapshot = TakeSnapshot(el),
                timestamp = DateTime.UtcNow.ToString("o"),
            });
        }
        catch
        {
            // Element may have been torn down between event firing and our
            // attempt to read it. Drop silently.
        }
    }

    private static void OnPropertyChangedEvent(string subId, string type, AutomationElement el, object? newValue)
    {
        try
        {
            var selector = Selectors.BuildAbsolutePath(el);
            Notifier.Send("event.fired", new
            {
                subscriptionId = subId,
                eventType = type,
                selector,
                controlSnapshot = TakeSnapshot(el),
                newValue = newValue?.ToString(),
                timestamp = DateTime.UtcNow.ToString("o"),
            });
        }
        catch { }
    }

    private static void OnStructureChangedEvent(string subId, AutomationElement el, StructureChangeType type)
    {
        try
        {
            var selector = Selectors.BuildAbsolutePath(el);
            Notifier.Send("event.fired", new
            {
                subscriptionId = subId,
                eventType = "StructureChanged",
                selector,
                changeType = type.ToString(),
                controlSnapshot = TakeSnapshot(el),
                timestamp = DateTime.UtcNow.ToString("o"),
            });
        }
        catch { }
    }

    private static object TakeSnapshot(AutomationElement el) => new
    {
        controlType = el.ControlType.ToString(),
        name = el.Properties.Name.ValueOrDefault,
        automationId = el.Properties.AutomationId.ValueOrDefault,
        className = el.Properties.ClassName.ValueOrDefault,
        value = TryGetValue(el),
        toggleState = TryGetToggleState(el),
    };

    private static string? TryGetValue(AutomationElement el)
    {
        try
        {
            return el.Patterns.Value.IsSupported
                ? el.Patterns.Value.Pattern.Value.ValueOrDefault
                : null;
        }
        catch { return null; }
    }

    private static string? TryGetToggleState(AutomationElement el)
    {
        try
        {
            return el.Patterns.Toggle.IsSupported
                ? el.Patterns.Toggle.Pattern.ToggleState.ValueOrDefault.ToString()
                : null;
        }
        catch { return null; }
    }

    private static async Task<object?> IdleAsync(System.Text.Json.JsonElement? @params, CancellationToken ct)
    {
        var p = RpcParams.Parse<EventsIdleParams>(@params);
        int debounceMs = p.DebounceMs ?? 500;
        int maxWaitMs = p.MaxWaitMs ?? 10000;

        EventBridge.EnsureSubscribed();
        EventBridge.ResetActivityClock();

        var sw = Stopwatch.StartNew();
        while (sw.ElapsedMilliseconds < maxWaitMs)
        {
            if (EventBridge.QuietMs() >= debounceMs)
            {
                return new { ok = true, idle = true, waitedMs = sw.ElapsedMilliseconds };
            }
            await Task.Delay(50, ct).ConfigureAwait(false);
        }
        return new { ok = true, idle = false, waitedMs = sw.ElapsedMilliseconds };
    }
}

internal sealed class EventsIdleParams
{
    [JsonPropertyName("debounceMs")] public int? DebounceMs { get; set; }
    [JsonPropertyName("maxWaitMs")] public int? MaxWaitMs { get; set; }
}

internal sealed class EventsSubscribeParams
{
    [JsonPropertyName("root")] public string? Root { get; set; }
    [JsonPropertyName("eventTypes")] public string[]? EventTypes { get; set; }
}

internal sealed class EventsUnsubscribeParams
{
    [JsonPropertyName("subscriptionId")] public string? SubscriptionId { get; set; }
}
