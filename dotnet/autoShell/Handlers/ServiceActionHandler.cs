// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System;
using System.Text.Json;
using autoShell.Handlers.Generated;
using autoShell.Logging;
using autoShell.Services;

namespace autoShell.Handlers;

/// <summary>
/// Handles Windows service control commands: RestartService.
/// </summary>
internal class ServiceActionHandler : ActionHandlerBase
{
    private readonly IServiceControlService _services;
    private readonly ILogger _logger;

    public ServiceActionHandler(IServiceControlService services, ILogger logger)
    {
        _services = services;
        _logger = logger;
        AddAction<RestartServiceParams>("RestartService", HandleRestartService);
    }

    private ActionResult HandleRestartService(RestartServiceParams p)
    {
        if (string.IsNullOrWhiteSpace(p.Service))
        {
            return ActionResult.Fail("A service name or description is required.");
        }

        bool matchByDescription = string.Equals(p.MatchBy, "description", StringComparison.OrdinalIgnoreCase);
        ServiceControlResult result = _services.RestartService(p.Service, matchByDescription);

        // A fuzzy match asks the caller (the TS agent) to confirm the resolved service with
        // the user before acting. Report success with a confirmation payload rather than
        // restarting anything yet.
        if (result.NeedsConfirmation)
        {
            return ActionResult.Ok(
                $"Found a close match: '{result.ResolvedDisplayName}'. Awaiting confirmation before restarting.",
                BuildConfirmationData(result.ResolvedServiceName, result.ResolvedDisplayName));
        }

        return result.Success
            ? ActionResult.Ok($"Restarted service '{result.ServiceDisplayName}'")
            : ActionResult.Fail(result.Error);
    }

    private static JsonElement BuildConfirmationData(string resolvedServiceName, string resolvedDisplayName)
    {
        using var doc = JsonSerializer.SerializeToDocument(new
        {
            needsConfirmation = true,
            resolvedServiceName,
            resolvedDisplayName,
            operation = "restart",
        });
        return doc.RootElement.Clone();
    }
}
