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
        this._appRegistry = appRegistry;
        this._processService = processService;
        this._window = window;
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
                this.CloseApplication(value);
                break;

            case "LaunchProgram":
                this.OpenApplication(value);
                break;

            case "ListAppNames":
                Console.WriteLine(JsonConvert.SerializeObject(this._appRegistry.GetAllAppNames()));
                break;
        }
    }

    private void CloseApplication(string friendlyName)
    {
        string processName = this._appRegistry.ResolveProcessName(friendlyName);
        Process[] processes = this._processService.GetProcessesByName(processName);
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
        string processName = this._appRegistry.ResolveProcessName(friendlyName);
        Process[] processes = this._processService.GetProcessesByName(processName);

        if (processes.Length == 0)
        {
            _logger.Debug("Starting " + friendlyName);
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
            _logger.Debug("Raising " + friendlyName);
            string processName2 = this._appRegistry.ResolveProcessName(friendlyName);
            string path2 = this._appRegistry.GetExecutablePath(friendlyName);
            this._window.RaiseWindow(processName2, path2);
        }
    }
}
