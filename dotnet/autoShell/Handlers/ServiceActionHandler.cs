// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System;
using System.Collections.Generic;
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

    public ServiceActionHandler(IServiceControlService services, ILogger _)
    {
        _services = services;
        AddAction<RestartServiceParams>("RestartService", HandleRestartService);
    }

    private ActionResult HandleRestartService(RestartServiceParams p)
    {
        if (string.IsNullOrWhiteSpace(p.Service))
        {
            return ActionResult.Fail("A service name or description is required.");
        }

        bool matchByDescription = string.Equals(p.MatchBy, "description", StringComparison.OrdinalIgnoreCase);
        bool elevate = p.Elevate ?? false;
        ServiceControlResult result = _services.RestartService(p.Service, matchByDescription, elevate);

        // A fuzzy match asks the caller (the TS agent) to confirm the resolved service with
        // the user before acting. Report success with a confirmation payload rather than
        // restarting anything yet.
        if (result.NeedsConfirmation)
        {
            return ActionResult.Ok(
                $"Found a close match: '{result.ResolvedDisplayName}'. Awaiting confirmation before restarting.",
                BuildConfirmationData("needsConfirmation", result.ResolvedServiceName, result.ResolvedDisplayName));
        }

        // The restart needs administrator rights the host lacks. Ask the TS agent to confirm the
        // user is willing to run it elevated before doing anything.
        if (result.NeedsElevation)
        {
            return ActionResult.Ok(
                $"Restarting '{result.ResolvedDisplayName}' requires administrator privileges. Awaiting confirmation.",
                BuildConfirmationData("needsElevation", result.ResolvedServiceName, result.ResolvedDisplayName));
        }

        return result.Success
            ? ActionResult.Ok($"Restarted service '{result.ServiceDisplayName}'")
            : ActionResult.Fail(result.Error);
    }

    private static JsonElement BuildConfirmationData(string flag, string resolvedServiceName, string resolvedDisplayName)
    {
        var payload = new Dictionary<string, object>
        {
            [flag] = true,
            ["resolvedServiceName"] = resolvedServiceName,
            ["resolvedDisplayName"] = resolvedDisplayName,
            ["operation"] = "restart",
        };
        using var doc = JsonSerializer.SerializeToDocument(payload);
        return doc.RootElement.Clone();
    }
}
