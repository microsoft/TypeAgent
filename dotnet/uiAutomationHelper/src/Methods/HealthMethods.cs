// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System.Reflection;
using UiAutomationHelper.Rpc;

namespace UiAutomationHelper.Methods;

internal static class HealthMethods
{
    public static void Register(Dispatch dispatch)
    {
        dispatch.Register("health.ping", (_, _) =>
        {
            var version = Assembly.GetExecutingAssembly()
                .GetName().Version?.ToString() ?? "0.0.0.0";
            return Task.FromResult<object?>(new { ok = true, version });
        });
    }
}
