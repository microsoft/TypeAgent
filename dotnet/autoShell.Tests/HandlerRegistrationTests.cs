// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using autoShell.Handlers;

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

        _handlers =
        [
            new AudioCommandHandler(audioMock.Object),
            new AppCommandHandler(),
            new WindowCommandHandler(),
            new ThemeCommandHandler(registryMock.Object, processMock.Object, systemParamsMock.Object),
            new VirtualDesktopCommandHandler(),
            new NetworkCommandHandler(),
            new DisplayCommandHandler(),
            new TaskbarSettingsHandler(registryMock.Object),
            new DisplaySettingsHandler(registryMock.Object, processMock.Object),
            new PersonalizationSettingsHandler(registryMock.Object, processMock.Object),
            new MouseSettingsHandler(systemParamsMock.Object, processMock.Object),
            new AccessibilitySettingsHandler(registryMock.Object, processMock.Object),
            new PrivacySettingsHandler(registryMock.Object),
            new PowerSettingsHandler(registryMock.Object, processMock.Object),
            new FileExplorerSettingsHandler(registryMock.Object),
            new SystemSettingsHandler(processMock.Object),
            new SystemCommandHandler(processMock.Object),
        ];
    }

    [Fact]
    public void AllHandlers_HaveNonEmptySupportedCommands()
    {
        foreach (var handler in _handlers)
        {
            Assert.True(
                handler.SupportedCommands.Any(),
                $"{handler.GetType().Name} has no supported commands");
        }
    }

    [Fact]
    public void AllHandlers_HaveNoDuplicateCommandsWithinHandler()
    {
        foreach (var handler in _handlers)
        {
            var commands = handler.SupportedCommands.ToList();
            var duplicates = commands.GroupBy(c => c).Where(g => g.Count() > 1).Select(g => g.Key).ToList();

            Assert.True(
                duplicates.Count == 0,
                $"{handler.GetType().Name} has duplicate commands: {string.Join(", ", duplicates)}");
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

        Assert.True(
            duplicates.Count == 0,
            $"Duplicate commands across handlers: {string.Join("; ", duplicates)}");
    }

}
