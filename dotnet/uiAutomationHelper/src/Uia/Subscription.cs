// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using FlaUI.Core.AutomationElements;
using FlaUI.Core.EventHandlers;
using FlaUI.Core.Identifiers;

namespace UiAutomationHelper.Uia;

internal sealed class Subscription : IDisposable
{
    public string Id { get; } = Guid.NewGuid().ToString("N");
    public string RootSelector { get; init; } = "";
    public AutomationElement? Root { get; init; }

    public List<(EventId EventId, AutomationEventHandlerBase Handler)> AutomationHandlers { get; } = new();
    public List<PropertyChangedEventHandlerBase> PropertyChangedHandlers { get; } = new();
    public List<StructureChangedEventHandlerBase> StructureChangedHandlers { get; } = new();

    public void Dispose()
    {
        // FlaUI's EventHandlerBase implements IDisposable; disposing the
        // handler unregisters it.
        foreach (var (_, h) in AutomationHandlers)
        {
            try { h.Dispose(); } catch { }
        }
        AutomationHandlers.Clear();
        foreach (var h in PropertyChangedHandlers)
        {
            try { h.Dispose(); } catch { }
        }
        PropertyChangedHandlers.Clear();
        foreach (var h in StructureChangedHandlers)
        {
            try { h.Dispose(); } catch { }
        }
        StructureChangedHandlers.Clear();
    }
}

internal static class SubscriptionRegistry
{
    private static readonly Dictionary<string, Subscription> _subs = new();
    private static readonly object _lock = new();

    public static void Add(Subscription sub)
    {
        lock (_lock)
        {
            _subs[sub.Id] = sub;
        }
    }

    public static bool Remove(string id)
    {
        lock (_lock)
        {
            if (!_subs.TryGetValue(id, out var sub)) return false;
            sub.Dispose();
            _subs.Remove(id);
            return true;
        }
    }

    public static int Count
    {
        get { lock (_lock) return _subs.Count; }
    }
}
