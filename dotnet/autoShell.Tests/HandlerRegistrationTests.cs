// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using autoShell.Handlers;
using autoShell.Handlers.Settings;
using autoShell.Logging;
using autoShell.Services;
using Moq;

namespace autoShell.Tests;

/// <summary>
/// Verifies structural invariants across all registered handlers (e.g., no duplicate commands).
/// </summary>
public class HandlerRegistrationTests
{
    private readonly List<IActionHandler> _handlers;

    public HandlerRegistrationTests()
    {
        var audioMock = new Mock<IAudioService>();
        var registryMock = new Mock<IRegistryService>();
        var systemParamsMock = new Mock<ISystemParametersService>();
        var processMock = new Mock<IProcessService>();
        var appRegistryMock = new Mock<IAppRegistry>();
        var debuggerMock = new Mock<IDebuggerService>();
        var brightnessMock = new Mock<IBrightnessService>();
        var displayMock = new Mock<IDisplayService>();
        var windowMock = new Mock<IWindowService>();
        var networkMock = new Mock<INetworkService>();
        var virtualDesktopMock = new Mock<IVirtualDesktopService>();
        var loggerMock = new Mock<ILogger>();

        _handlers =
        [
            new AudioActionHandler(audioMock.Object),
            new AppActionHandler(appRegistryMock.Object, processMock.Object, windowMock.Object, loggerMock.Object),
            new WindowActionHandler(appRegistryMock.Object, windowMock.Object),
            new ThemeActionHandler(registryMock.Object, processMock.Object, systemParamsMock.Object),
            new VirtualDesktopActionHandler(appRegistryMock.Object, windowMock.Object, virtualDesktopMock.Object, loggerMock.Object),
            new NetworkActionHandler(networkMock.Object, processMock.Object, loggerMock.Object),
            new DisplayActionHandler(displayMock.Object, loggerMock.Object),
            new TaskbarSettingsHandler(registryMock.Object, processMock.Object),
            new DisplaySettingsHandler(registryMock.Object, processMock.Object, brightnessMock.Object, loggerMock.Object),
            new PersonalizationSettingsHandler(registryMock.Object, processMock.Object),
            new MouseSettingsHandler(registryMock.Object, processMock.Object, systemParamsMock.Object, loggerMock.Object),
            new AccessibilitySettingsHandler(registryMock.Object, processMock.Object),
            new PowerSettingsHandler(registryMock.Object, processMock.Object),
            new FileExplorerSettingsHandler(registryMock.Object),
            new PrivacySettingsHandler(registryMock.Object),
            new SystemSettingsHandler(registryMock.Object, processMock.Object),
            new SystemActionHandler(processMock.Object, debuggerMock.Object),
        ];
    }

    /// <summary>
    /// Verifies that no handler declares the same command key more than once.
    /// </summary>
    [Fact]
    public void AllHandlers_HaveNoDuplicateCommandsWithinHandler()
    {
        foreach (var handler in _handlers)
        {
            var commands = handler.SupportedActions.ToList();
            var duplicates = commands.GroupBy(c => c).Where(g => g.Count() > 1).Select(g => g.Key).ToList();

            Assert.Empty(duplicates);
        }
    }

    /// <summary>
    /// Verifies that no command key is claimed by more than one handler.
    /// </summary>
    [Fact]
    public void AllHandlers_HaveNoDuplicateCommandsAcrossHandlers()
    {
        var seen = new Dictionary<string, string>();
        var duplicates = new List<string>();

        foreach (var handler in _handlers)
        {
            string handlerName = handler.GetType().Name;
            foreach (string cmd in handler.SupportedActions)
            {
                if (seen.TryGetValue(cmd, out string? existingHandler))
                {
                    duplicates.Add($"'{cmd}' in both {existingHandler} and {handlerName}");
                }
                else
                {
                    seen[cmd] = handlerName;
                }
            }
        }

        Assert.Empty(duplicates);
    }

}
