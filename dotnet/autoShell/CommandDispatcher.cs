// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System;
using System.Collections.Generic;
using System.Diagnostics;
using autoShell.Handlers;
using autoShell.Handlers.Settings;
using autoShell.Services;
using Newtonsoft.Json.Linq;

namespace autoShell;

/// <summary>
/// Routes incoming JSON commands to the appropriate handler via a direct dictionary lookup.
/// </summary>
internal class CommandDispatcher
{
    private readonly Dictionary<string, ICommandHandler> _handlers = [];

    /// <summary>
    /// Creates a CommandDispatcher with all production services and handlers registered.
    /// </summary>
    public static CommandDispatcher Create()
    {
        var registry = new WindowsRegistryService();
        var systemParams = new WindowsSystemParametersService();
        var process = new WindowsProcessService();
        var audio = new WindowsAudioService();
        var appRegistry = new WindowsAppRegistry();
        var debugger = new WindowsDebuggerService();
        var brightness = new WindowsBrightnessService();
        var display = new WindowsDisplayService();
        var window = new WindowsWindowService();
        var network = new WindowsNetworkService();
        var virtualDesktop = new WindowsVirtualDesktopService();

        var dispatcher = new CommandDispatcher();
        dispatcher.Register(
            new AudioCommandHandler(audio),
            new AppCommandHandler(appRegistry, process, window),
            new WindowCommandHandler(appRegistry, window),
            new ThemeCommandHandler(registry, process, systemParams),
            new VirtualDesktopCommandHandler(appRegistry, process, virtualDesktop),
            new NetworkCommandHandler(network),
            new DisplayCommandHandler(display),
            new TaskbarSettingsHandler(registry),
            new DisplaySettingsHandler(registry, process, brightness),
            new PersonalizationSettingsHandler(registry, process),
            new MouseSettingsHandler(systemParams, process),
            new AccessibilitySettingsHandler(registry, process),
            new PrivacySettingsHandler(registry),
            new PowerSettingsHandler(registry, process),
            new FileExplorerSettingsHandler(registry),
            new SystemSettingsHandler(registry, process),
            new SystemCommandHandler(process, debugger)
        );

        return dispatcher;
    }

    /// <summary>
    /// Registers one or more command handlers with the dispatcher.
    /// </summary>
    public void Register(params ICommandHandler[] handlers)
    {
        foreach (var handler in handlers)
        {
            foreach (string command in handler.SupportedCommands)
            {
                _handlers[command] = handler;
            }
        }
    }

    /// <summary>
    /// Dispatches all commands in a JSON object to their handlers.
    /// </summary>
    /// <returns>True if a "quit" command was encountered; otherwise false.</returns>
    public bool Dispatch(JObject root)
    {
        foreach (var kvp in root)
        {
            string key = kvp.Key;

            if (key == "quit")
            {
                return true;
            }

            string value = kvp.Value.ToString();

            try
            {
                if (_handlers.TryGetValue(key, out ICommandHandler handler))
                {
                    handler.Handle(key, value, kvp.Value);
                }
                else
                {
                    Debug.WriteLine("Unknown command: " + key);
                }
            }
            catch (Exception ex)
            {
                AutoShell.LogError(ex);
            }
        }
        return false;
    }
}
