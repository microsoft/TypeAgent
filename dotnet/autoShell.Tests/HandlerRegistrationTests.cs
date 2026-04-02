// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using autoShell.Handlers;
using autoShell.Handlers.Settings;

namespace autoShell.Tests;

/// <summary>
/// Verifies that each handler declares the expected supported commands.
/// Catches accidental renames or deletions.
/// </summary>
public class HandlerRegistrationTests
{
    private readonly List<ICommandHandler> _handlers;

    public HandlerRegistrationTests()
    {
        var audioMock = new Moq.Mock<Services.IAudioService>();
        var registryMock = new Moq.Mock<Services.IRegistryService>();
        var systemParamsMock = new Moq.Mock<Services.ISystemParametersService>();
        var processMock = new Moq.Mock<Services.IProcessService>();
        var appRegistryMock = new Moq.Mock<Services.IAppRegistry>();
        var debuggerMock = new Moq.Mock<Services.IDebuggerService>();
        var brightnessMock = new Moq.Mock<Services.IBrightnessService>();
        var displayMock = new Moq.Mock<Services.IDisplayService>();
        var windowMock = new Moq.Mock<Services.IWindowService>();
        var networkMock = new Moq.Mock<Services.INetworkService>();
        var virtualDesktopMock = new Moq.Mock<Services.IVirtualDesktopService>();
        var loggerMock = new Moq.Mock<Logging.ILogger>();

        _handlers =
        [
            new AudioCommandHandler(audioMock.Object),
            new AppCommandHandler(appRegistryMock.Object, processMock.Object, windowMock.Object, loggerMock.Object),
            new WindowCommandHandler(appRegistryMock.Object, windowMock.Object),
            new ThemeCommandHandler(registryMock.Object, processMock.Object, systemParamsMock.Object),
            new VirtualDesktopCommandHandler(appRegistryMock.Object, processMock.Object, virtualDesktopMock.Object, loggerMock.Object),
            new NetworkCommandHandler(networkMock.Object, loggerMock.Object),
            new DisplayCommandHandler(displayMock.Object, loggerMock.Object),
            new TaskbarSettingsHandler(registryMock.Object),
            new DisplaySettingsHandler(registryMock.Object, processMock.Object, brightnessMock.Object, loggerMock.Object),
            new PersonalizationSettingsHandler(registryMock.Object, processMock.Object),
            new MouseSettingsHandler(systemParamsMock.Object, processMock.Object, loggerMock.Object),
            new AccessibilitySettingsHandler(registryMock.Object, processMock.Object),
            new PrivacySettingsHandler(registryMock.Object),
            new PowerSettingsHandler(registryMock.Object, processMock.Object),
            new FileExplorerSettingsHandler(registryMock.Object),
            new SystemSettingsHandler(registryMock.Object, processMock.Object, loggerMock.Object),
            new SystemCommandHandler(processMock.Object, debuggerMock.Object),
        ];
    }

    [Fact]
    public void AllHandlers_HaveNonEmptySupportedCommands()
    {
        foreach (var handler in _handlers)
        {
            Assert.NotEmpty(handler.SupportedCommands);
        }
    }

    [Fact]
    public void AllHandlers_HaveNoDuplicateCommandsWithinHandler()
    {
        foreach (var handler in _handlers)
        {
            var commands = handler.SupportedCommands.ToList();
            var duplicates = commands.GroupBy(c => c).Where(g => g.Count() > 1).Select(g => g.Key).ToList();

            Assert.Empty(duplicates);
        }
    }

    [Fact]
    public void AllHandlers_HaveNoDuplicateCommandsAcrossHandlers()
    {
        var seen = new Dictionary<string, string>();
        var duplicates = new List<string>();

        foreach (var handler in _handlers)
        {
            string handlerName = handler.GetType().Name;
            foreach (string cmd in handler.SupportedCommands)
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

    [Fact]
    public void AllCommands_HaveAtLeastOneUnitTest()
    {
        // Discover all test classes in this assembly
        var testAssembly = typeof(HandlerRegistrationTests).Assembly;
        var testMethods = testAssembly.GetTypes()
            .Where(t => t.IsClass && t.IsPublic)
            .SelectMany(t => t.GetMethods()
                .Where(m => m.GetCustomAttributes(typeof(Xunit.FactAttribute), false).Length > 0
                         || m.GetCustomAttributes(typeof(Xunit.TheoryAttribute), false).Length > 0)
                .Select(m => new { ClassName = t.Name, MethodName = m.Name }))
            .ToList();

        var untested = new List<string>();

        foreach (var handler in _handlers)
        {
            string handlerTypeName = handler.GetType().Name;
            // Expected test class: "{HandlerTypeName}Tests"
            string expectedTestClass = handlerTypeName + "Tests";

            var classTests = testMethods
                .Where(t => t.ClassName == expectedTestClass)
                .ToList();

            foreach (string command in handler.SupportedCommands)
            {
                bool hasCoverage = classTests.Any(t =>
                    t.MethodName.StartsWith(command + "_", StringComparison.Ordinal) ||
                    t.MethodName.Contains("_" + command + "_", StringComparison.Ordinal));

                if (!hasCoverage)
                {
                    untested.Add($"{handlerTypeName}.{command}");
                }
            }
        }

        Assert.Empty(untested);
    }

}
