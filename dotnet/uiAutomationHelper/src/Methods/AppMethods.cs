// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System.Diagnostics;
using System.Text.Json.Serialization;
using FlaUI.Core;
using FlaUI.Core.AutomationElements;
using FlaUI.Core.Definitions;
using UiAutomationHelper.Models;
using UiAutomationHelper.Rpc;
using UiAutomationHelper.Uia;

namespace UiAutomationHelper.Methods;

internal static class AppMethods
{
    public static void Register(Dispatch dispatch)
    {
        dispatch.Register("app.launch", (p, ct) => Task.FromResult(Launch(p)));
        dispatch.Register("app.attach", (p, ct) => Task.FromResult(Attach(p)));
        dispatch.Register("app.list",   (p, ct) => Task.FromResult(List()));
        dispatch.Register("app.kill",   (p, ct) => Task.FromResult(Kill(p)));
    }

    private static object? Launch(System.Text.Json.JsonElement? @params)
    {
        var p = RpcParams.Parse<AppLaunchParams>(@params);
        Application app;
        if (!string.IsNullOrEmpty(p.Aumid))
        {
            app = Application.LaunchStoreApp(p.Aumid);
            AppRegistry.Register(app.ProcessId, p.Aumid);
        }
        else if (!string.IsNullOrEmpty(p.ExePath))
        {
            var args = p.Args != null && p.Args.Length > 0 ? string.Join(" ", p.Args) : null;
            app = args != null
                ? Application.Launch(p.ExePath, args)
                : Application.Launch(p.ExePath);
        }
        else
        {
            throw new RpcException(RpcErrorCode.InvalidParams, "Either 'aumid' or 'exePath' is required");
        }

        var window = app.GetMainWindow(AutomationHost.Automation, TimeSpan.FromSeconds(15));
        if (window == null)
        {
            throw new RpcException(RpcErrorCode.Timeout, "Launched app has no main window");
        }
        return new { pid = app.ProcessId, mainWindow = BuildWindowSelector(window) };
    }

    private static object? Attach(System.Text.Json.JsonElement? @params)
    {
        var p = RpcParams.Parse<AppAttachParams>(@params);
        Application app;
        int pid;
        if (p.Pid.HasValue)
        {
            pid = p.Pid.Value;
            app = Application.Attach(pid);
        }
        else if (!string.IsNullOrEmpty(p.WindowTitle))
        {
            var found = FindWindowPidByTitle(p.WindowTitle);
            if (found == null)
            {
                throw new RpcException(RpcErrorCode.ElementNotFound, $"No window matching '{p.WindowTitle}'");
            }
            pid = found.Value;
            app = Application.Attach(pid);
        }
        else
        {
            throw new RpcException(RpcErrorCode.InvalidParams, "Either 'pid' or 'windowTitle' is required");
        }

        var window = app.GetMainWindow(AutomationHost.Automation, TimeSpan.FromSeconds(5));
        if (window == null)
        {
            throw new RpcException(RpcErrorCode.Timeout, "Attached app has no main window");
        }
        return new { pid, mainWindow = BuildWindowSelector(window) };
    }

    private static object? List() => ComRetry.Run(() =>
    {
        var desktop = AutomationHost.Automation.GetDesktop();
        var cf = AutomationHost.Automation.ConditionFactory;
        var windows = desktop.FindAllChildren(cf.ByControlType(ControlType.Window));
        var results = new List<object>();
        foreach (var w in windows)
        {
            var pid = w.Properties.ProcessId.ValueOrDefault;
            var title = w.Properties.Name.ValueOrDefault ?? "";
            if (pid <= 0 || string.IsNullOrWhiteSpace(title))
            {
                continue;
            }
            results.Add(new
            {
                pid,
                title,
                aumid = AppRegistry.GetAumid(pid),
                mainWindow = BuildWindowSelector(w),
            });
        }
        return (object?)results;
    });

    private static object? Kill(System.Text.Json.JsonElement? @params)
    {
        var p = RpcParams.Parse<AppKillParams>(@params);
        if (!p.Pid.HasValue)
        {
            throw new RpcException(RpcErrorCode.InvalidParams, "'pid' is required");
        }
        try
        {
            using var proc = Process.GetProcessById(p.Pid.Value);
            try { proc.CloseMainWindow(); } catch { /* CloseMainWindow can throw on UWP */ }
            if (!proc.WaitForExit(2000))
            {
                proc.Kill(entireProcessTree: true);
                proc.WaitForExit(2000);
            }
        }
        catch (ArgumentException)
        {
            // Process not running — treat as already-killed
        }
        AppRegistry.Forget(p.Pid.Value);
        return new { ok = true };
    }

    private static int? FindWindowPidByTitle(string substringMatch)
    {
        var desktop = AutomationHost.Automation.GetDesktop();
        var cf = AutomationHost.Automation.ConditionFactory;
        var windows = desktop.FindAllChildren(cf.ByControlType(ControlType.Window));
        foreach (var w in windows)
        {
            var name = w.Properties.Name.ValueOrDefault ?? "";
            if (name.Contains(substringMatch, StringComparison.OrdinalIgnoreCase))
            {
                var pid = w.Properties.ProcessId.ValueOrDefault;
                if (pid > 0) return pid;
            }
        }
        return null;
    }

    internal static string BuildWindowSelector(AutomationElement window) =>
        Selectors.BuildAbsolutePath(window);
}

internal sealed class AppLaunchParams
{
    [JsonPropertyName("aumid")] public string? Aumid { get; set; }
    [JsonPropertyName("exePath")] public string? ExePath { get; set; }
    [JsonPropertyName("args")] public string[]? Args { get; set; }
}

internal sealed class AppAttachParams
{
    [JsonPropertyName("pid")] public int? Pid { get; set; }
    [JsonPropertyName("windowTitle")] public string? WindowTitle { get; set; }
}

internal sealed class AppKillParams
{
    [JsonPropertyName("pid")] public int? Pid { get; set; }
}
