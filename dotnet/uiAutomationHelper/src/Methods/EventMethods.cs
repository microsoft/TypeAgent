// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System.Diagnostics;
using System.Text.Json.Serialization;
using UiAutomationHelper.Rpc;
using UiAutomationHelper.Uia;

namespace UiAutomationHelper.Methods;

internal static class EventMethods
{
    public static void Register(Dispatch dispatch)
    {
        dispatch.Register("events.idle", IdleAsync);
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
