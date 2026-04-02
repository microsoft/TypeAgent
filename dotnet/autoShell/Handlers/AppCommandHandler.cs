// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System;
using System.Collections.Generic;
using System.Diagnostics;
using autoShell.Services;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

namespace autoShell.Handlers;

/// <summary>
/// Handles application lifecycle commands: launchProgram, closeProgram.
/// </summary>
internal class AppCommandHandler : ICommandHandler
{
    private readonly IAppRegistry _appRegistry;
    private readonly IProcessService _processService;

    public AppCommandHandler(IAppRegistry appRegistry, IProcessService processService)
    {
        _appRegistry = appRegistry;
        _processService = processService;
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
            case "LaunchProgram":
                OpenApplication(value);
                break;

            case "CloseProgram":
                CloseApplication(value);
                break;

            case "ListAppNames":
                Console.WriteLine(JsonConvert.SerializeObject(_appRegistry.GetAllAppNames()));
                break;
        }
    }

    private void OpenApplication(string friendlyName)
    {
        string processName = _appRegistry.ResolveProcessName(friendlyName);
        Process[] processes = _processService.GetProcessesByName(processName);

        if (processes.Length == 0)
        {
            Debug.WriteLine("Starting " + friendlyName);
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
                    psi.WorkingDirectory = Environment.ExpandEnvironmentVariables("%" + workDirEnvVar + "%") ?? string.Empty;
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
                string appModelUserID = _appRegistry.GetAppUserModelId(friendlyName);
                if (appModelUserID != null)
                {
                    try
                    {
                        _processService.Start(new ProcessStartInfo("explorer.exe", @" shell:appsFolder\" + appModelUserID));
                    }
                    catch { }
                }
            }
        }
        else
        {
            Debug.WriteLine("Raising " + friendlyName);
            WindowCommandHandler.RaiseWindow(friendlyName, _appRegistry);
        }
    }

    private void CloseApplication(string friendlyName)
    {
        string processName = _appRegistry.ResolveProcessName(friendlyName);
        Process[] processes = _processService.GetProcessesByName(processName);
        if (processes.Length != 0)
        {
            Debug.WriteLine("Closing " + friendlyName);
            foreach (Process p in processes)
            {
                if (p.MainWindowHandle != IntPtr.Zero)
                {
                    p.CloseMainWindow();
                }
            }
        }
    }
}
