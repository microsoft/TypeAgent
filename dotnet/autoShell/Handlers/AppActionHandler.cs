// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System;
using System.Diagnostics;
using System.Text.Json;
using autoShell.Handlers.Generated;
using autoShell.Logging;
using autoShell.Services;

namespace autoShell.Handlers;

/// <summary>
/// Handles application lifecycle commands: CloseProgram, LaunchProgram, and ListAppNames.
/// </summary>
internal class AppActionHandler : ActionHandlerBase
{
    private readonly IAppRegistry _appRegistry;
    private readonly IProcessService _processService;
    private readonly IWindowService _window;
    private readonly ILogger _logger;

    public AppActionHandler(IAppRegistry appRegistry, IProcessService processService, IWindowService window, ILogger logger)
    {
        _appRegistry = appRegistry;
        _processService = processService;
        _window = window;
        _logger = logger;
        AddAction<CloseProgramParams>("CloseProgram", HandleCloseProgram);
        AddAction<LaunchProgramParams>("LaunchProgram", HandleLaunchProgram);
        AddAction("ListAppNames", HandleListAppNames);
    }

    private ActionResult HandleCloseProgram(CloseProgramParams p)
    {
        string name = p.Name;
        CloseApplication(name);
        return ActionResult.Ok($"Closed {name}");
    }

    private ActionResult HandleLaunchProgram(LaunchProgramParams p)
    {
        string name = p.Name;
        OpenApplication(name);
        return ActionResult.Ok($"Launched {name}");
    }

    private ActionResult HandleListAppNames(JsonElement parameters)
    {
        var appNames = _appRegistry.GetAllAppNames();
        return ActionResult.Ok("Listed app names", JsonSerializer.SerializeToElement(appNames));
    }

    private void CloseApplication(string friendlyName)
    {
        string processName = _appRegistry.ResolveProcessName(friendlyName);
        Process[] processes = _processService.GetProcessesByName(processName);
        if (processes.Length != 0)
        {
            _logger.Debug("Closing " + friendlyName);
            foreach (Process p in processes)
            {
                if (p.MainWindowHandle != IntPtr.Zero)
                {
                    p.CloseMainWindow();
                }
            }
        }
    }

    private void OpenApplication(string friendlyName)
    {
        string processName = _appRegistry.ResolveProcessName(friendlyName);
        Process[] processes = _processService.GetProcessesByName(processName);

        if (processes.Length == 0)
        {
            _logger.Debug("Starting " + friendlyName);
            string path = _appRegistry.GetExecutablePath(friendlyName);
            if (path != null)
            {
                var psi = new ProcessStartInfo
                {
                    FileName = path,
                    UseShellExecute = true
                };

                string workDirEnvVar = _appRegistry.GetWorkingDirectoryEnvVar(friendlyName);
                if (workDirEnvVar != null)
                {
                    psi.WorkingDirectory = Environment.ExpandEnvironmentVariables("%" + workDirEnvVar + "%");
                }

                string arguments = _appRegistry.GetArguments(friendlyName);
                if (arguments != null)
                {
                    psi.Arguments = arguments;
                }

                try
                {
                    _processService.Start(psi);
                }
                catch (System.ComponentModel.Win32Exception)
                {
                    psi.FileName = friendlyName;
                    _processService.Start(psi);
                }
            }
            else
            {
                string appModelUserId = _appRegistry.GetAppUserModelId(friendlyName);
                if (appModelUserId != null)
                {
                    try
                    {
                        _processService.Start(new ProcessStartInfo("explorer.exe", @" shell:appsFolder\" + appModelUserId));
                    }
                    catch (Exception ex) { _logger.Debug($"Failed to launch UWP app: {ex.Message}"); }
                }
            }
        }
        else
        {
            _logger.Debug("Raising " + friendlyName);
            string processName2 = _appRegistry.ResolveProcessName(friendlyName);
            string path2 = _appRegistry.GetExecutablePath(friendlyName);
            _window.RaiseWindow(processName2, path2);
        }
    }
}
