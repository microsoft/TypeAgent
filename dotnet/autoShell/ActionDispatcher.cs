// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System;
using System.Collections.Generic;
using System.IO;
using System.Text.Json;
using autoShell.Handlers;
using autoShell.Handlers.Settings;
using autoShell.Logging;
using autoShell.Services;

namespace autoShell;

/// <summary>
/// Routes incoming JSON actions to the appropriate handler via a direct dictionary lookup.
/// </summary>
internal class ActionDispatcher
{
    private readonly Dictionary<string, IActionHandler> _handlers = new(StringComparer.OrdinalIgnoreCase);
    private readonly ILogger _logger;

    public ActionDispatcher(ILogger logger)
    {
        _logger = logger;
    }

    /// <summary>
    /// Gets the names of all registered actions.
    /// </summary>
    public IEnumerable<string> RegisteredActions => _handlers.Keys;

    /// <summary>
    /// Creates a <see cref="ActionDispatcher"/> with all production services and handlers registered.
    /// </summary>
    public static ActionDispatcher Create(ILogger logger)
    {
        return Create(
            logger,
            new WindowsRegistryService(),
            new WindowsSystemParametersService(),
            new WindowsProcessService(),
            new WindowsAudioService(logger),
            new WindowsAppRegistry(logger),
            new WindowsDebuggerService(),
            new WindowsBrightnessService(logger),
            new WindowsDisplayService(logger),
            new WindowsWindowService(logger),
            new WindowsNetworkService(logger),
            new WindowsVirtualDesktopService(logger)
        );
    }

    /// <summary>
    /// Creates a <see cref="ActionDispatcher"/> with the specified services, enabling integration testing
    /// with mock services while exercising real handler wiring.
    /// </summary>
    internal static ActionDispatcher Create(
        ILogger logger,
        IRegistryService registry,
        ISystemParametersService systemParams,
        IProcessService process,
        IAudioService audio,
        IAppRegistry appRegistry,
        IDebuggerService debugger,
        IBrightnessService brightness,
        IDisplayService display,
        IWindowService window,
        INetworkService network,
        IVirtualDesktopService virtualDesktop)
    {
        var dispatcher = new ActionDispatcher(logger);

        dispatcher.Register(
            new AudioActionHandler(audio),
            new AppActionHandler(appRegistry, process, window, logger),
            new WindowActionHandler(appRegistry, window),
            new ThemeActionHandler(registry, process, systemParams),
            new VirtualDesktopActionHandler(appRegistry, window, virtualDesktop, logger),
            new NetworkActionHandler(network, process, logger),
            new DisplayActionHandler(display, logger),
            new TaskbarSettingsHandler(registry, process),
            new DisplaySettingsHandler(registry, process, brightness, logger),
            new PersonalizationSettingsHandler(registry, process),
            new MouseSettingsHandler(registry, process, systemParams, logger),
            new AccessibilitySettingsHandler(registry, process, systemParams),
            new PowerSettingsHandler(registry, process),
            new FileExplorerSettingsHandler(registry),
            new PrivacySettingsHandler(registry),
            new SystemSettingsHandler(registry, process),
            new SystemActionHandler(process, debugger)
        );

        var validator = new SchemaValidator(logger);
        var schemaDir = Path.Combine(AppContext.BaseDirectory, SchemaValidator.DefaultSchemaRelativePath);
        var schemaActions = validator.LoadActionNames(schemaDir);
        if (schemaActions.Count > 0)
        {
            validator.ValidateWiring(schemaActions, dispatcher.RegisteredActions);
        }

        return dispatcher;
    }

    /// <summary>
    /// Registers one or more handlers with the dispatcher.
    /// Throws if an action name is already registered.
    /// </summary>
    public void Register(params IActionHandler[] handlers)
    {
        foreach (var handler in handlers)
        {
            foreach (string action in handler.SupportedActions)
            {
                if (!_handlers.TryAdd(action, handler))
                {
                    throw new InvalidOperationException(
                        $"Action '{action}' is already registered by {_handlers[action].GetType().Name}. " +
                        $"Cannot register again from {handler.GetType().Name}.");
                }
            }
        }
    }

    /// <summary>
    /// Dispatches an action in the format <c>{"actionName":"Volume","parameters":{"targetVolume":50}}</c>
    /// to the appropriate handler.
    /// </summary>
    /// <returns>
    /// A <see cref="ActionResult"/> for the executed action. Check <see cref="ActionResult.IsQuit"/>
    /// to determine if the caller should exit the interactive loop.
    /// </returns>
    public ActionResult Dispatch(JsonElement root)
    {
        string actionName = root.TryGetProperty("actionName", out JsonElement actionNameElement)
            ? actionNameElement.GetString()
            : null;
        if (string.IsNullOrEmpty(actionName))
        {
            return ActionResult.Fail("Missing actionName in action JSON");
        }

        if (string.Equals(actionName, "quit", StringComparison.OrdinalIgnoreCase))
        {
            return ActionResult.Quit();
        }

        JsonElement parameters = root.TryGetProperty("parameters", out JsonElement p)
            ? p
            : JsonDocument.Parse("{}").RootElement.Clone();

        try
        {
            return _handlers.TryGetValue(actionName, out IActionHandler handler)
                ? handler.Handle(actionName, parameters)
                : ActionResult.Fail($"Unknown action: {actionName}");
        }
        catch (Exception ex)
        {
            _logger.Error(ex);
            return ActionResult.Fail($"Error executing {actionName}: {ex.Message}");
        }
    }
}
