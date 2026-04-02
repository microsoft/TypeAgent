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
        this._appRegistry = appRegistry;
        this._processService = processService;
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
                this.OpenApplication(value);
                break;

            case "CloseProgram":
                this.CloseApplication(value);
                break;

            case "ListAppNames":
                Console.WriteLine(JsonConvert.SerializeObject(this._appRegistry.GetAllAppNames()));
                break;
        }
    }

    private void OpenApplication(string friendlyName)
    {
        string processName = this._appRegistry.ResolveProcessName(friendlyName);
        Process[] processes = this._processService.GetProcessesByName(processName);

        if (processes.Length == 0)
        {
            Debug.WriteLine("Starting " + friendlyName);
            string path = this._appRegistry.GetExecutablePath(friendlyName);
            if (path != null)
            {
                var psi = new ProcessStartInfo
                {
                    FileName = path,
                    UseShellExecute = true
                };

                string workDirEnvVar = this._appRegistry.GetWorkingDirectoryEnvVar(friendlyName);
                if (workDirEnvVar != null)
                {
                    psi.WorkingDirectory = Environment.ExpandEnvironmentVariables("%" + workDirEnvVar + "%") ?? string.Empty;
                }

                string arguments = this._appRegistry.GetArguments(friendlyName);
                if (arguments != null)
                {
                    psi.Arguments = arguments;
                }

                try
                {
                    this._processService.Start(psi);
                }
                catch (System.ComponentModel.Win32Exception)
                {
                    psi.FileName = friendlyName;
                    this._processService.Start(psi);
                }
            }
            else
            {
                string appModelUserId = this._appRegistry.GetAppUserModelId(friendlyName);
                if (appModelUserId != null)
                {
                    try
                    {
                        this._processService.Start(new ProcessStartInfo("explorer.exe", @" shell:appsFolder\" + appModelUserId));
                    }
                    catch { }
                }
            }
        }
        else
        {
            Debug.WriteLine("Raising " + friendlyName);
            WindowCommandHandler.RaiseWindow(friendlyName, this._appRegistry);
        }
    }

    private void CloseApplication(string friendlyName)
    {
        string processName = this._appRegistry.ResolveProcessName(friendlyName);
        Process[] processes = this._processService.GetProcessesByName(processName);
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
