// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace autoShell.Services;

/// <summary>
/// Abstracts Windows service control operations (start/stop/restart) for testability.
/// </summary>
internal interface IServiceControlService
{
    /// <summary>
    /// Restarts a Windows service, stopping it (and any running dependents) and starting it again.
    /// </summary>
    /// <param name="identifier">
    /// The service name or display name when <paramref name="matchByDescription"/> is <c>false</c>;
    /// otherwise a phrase to search for within service descriptions.
    /// </param>
    /// <param name="matchByDescription">
    /// When <c>true</c>, locates the service by searching its description text; otherwise matches by
    /// service name or display name.
    /// </param>
    /// <returns>
    /// A <see cref="ServiceControlResult"/> describing the outcome. When the query resolves only to a
    /// fuzzy (approximate) match, the result has <see cref="ServiceControlResult.NeedsConfirmation"/>
    /// set and the service is <em>not</em> restarted; the caller should confirm with the user and retry
    /// using the resolved exact service name.
    /// </returns>
    ServiceControlResult RestartService(string identifier, bool matchByDescription);
}

/// <summary>
/// Result of a service control operation.
/// </summary>
internal sealed record ServiceControlResult
{
    /// <summary>Whether the operation succeeded.</summary>
    public bool Success { get; init; }

    /// <summary>The display name of the affected service, when the operation succeeded.</summary>
    public string ServiceDisplayName { get; init; }

    /// <summary>A human-readable error message, when the operation failed.</summary>
    public string Error { get; init; }

    /// <summary>
    /// When <c>true</c>, the query resolved to a fuzzy (non-exact) match that the caller
    /// should confirm with the user before acting. No change has been made yet.
    /// </summary>
    public bool NeedsConfirmation { get; init; }

    /// <summary>The exact service name of the fuzzy match, for use in a confirmed retry.</summary>
    public string ResolvedServiceName { get; init; }

    /// <summary>The display name of the fuzzy match, for presenting to the user.</summary>
    public string ResolvedDisplayName { get; init; }

    /// <summary>Creates a successful result for the given service display name.</summary>
    public static ServiceControlResult Ok(string serviceDisplayName) =>
        new() { Success = true, ServiceDisplayName = serviceDisplayName };

    /// <summary>Creates a failure result with an error message.</summary>
    public static ServiceControlResult Fail(string error) =>
        new() { Success = false, Error = error };

    /// <summary>
    /// Creates a result indicating a fuzzy match was found and user confirmation is required
    /// before the operation is performed.
    /// </summary>
    public static ServiceControlResult Confirm(string resolvedServiceName, string resolvedDisplayName) =>
        new()
        {
            Success = true,
            NeedsConfirmation = true,
            ResolvedServiceName = resolvedServiceName,
            ResolvedDisplayName = resolvedDisplayName,
        };
}
