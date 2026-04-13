// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System;
using System.Collections.Generic;
using System.Diagnostics;
using autoShell.Logging;
using autoShell.Services;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

namespace autoShell.Handlers;

/// <summary>
/// Handles application lifecycle commands: CloseProgram, LaunchProgram, and ListAppNames.
/// </summary>
internal class AppCommandHandler : ICommandHandler
{
    private readonly IAppRegistry _appRegistry;
    private readonly IProcessService _processService;
    private readonly IWindowService _window;
    private readonly ILogger _logger;

    public AppCommandHandler(IAppRegistry appRegistry, IProcessService processService, IWindowService window, ILogger logger)
    {
        _appRegistry = appRegistry;
        _processService = processService;
        _window = window;
        _logger = logger;
    }

    /// <inheritdoc/>
    public IEnumerable<string> SupportedCommands { get; } =
    [
        "CloseProgram",
        "LaunchProgram",
        "ListAppNames",
    ];

    /// <inheritdoc/>
    public void Handle(string key, string value, JToken rawValue)
    {
        switch (key)
        {
            case "CloseProgram":
                CloseApplication(value);
                break;

            case "LaunchProgram":
                OpenApplication(value);
                break;

            case "ListAppNames":
                Console.WriteLine(JsonConvert.SerializeObject(_appRegistry.GetAllAppNames()));
                break;
        }
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
