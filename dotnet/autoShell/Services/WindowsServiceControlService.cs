// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Diagnostics;
using System.Management;
using System.Security.Principal;
using System.ServiceProcess;
using autoShell.Logging;

namespace autoShell.Services;

/// <summary>
/// Concrete implementation of <see cref="IServiceControlService"/>. Services are enumerated and
/// matched (including by description, via WMI <c>Win32_Service</c>) without elevation; the restart
/// itself uses <see cref="ServiceController"/> when the host is already elevated, otherwise an
/// elevated PowerShell helper that prompts the user for consent via UAC.
/// </summary>
internal sealed class WindowsServiceControlService : IServiceControlService
{
    /// <summary>Maximum time to wait for a service to reach a target state.</summary>
    private static readonly TimeSpan StatusTimeout = TimeSpan.FromSeconds(20);

    /// <summary>Maximum time to wait for the elevated restart helper to finish.</summary>
    private const int ElevatedRestartTimeoutMs = 28000;

    private readonly ILogger _logger;

    public WindowsServiceControlService(ILogger logger)
    {
        _logger = logger;
    }

    /// <inheritdoc/>
    public ServiceControlResult RestartService(string identifier, bool matchByDescription, bool elevate)
    {
        if (string.IsNullOrWhiteSpace(identifier))
        {
            return ServiceControlResult.Fail("A service name or description is required.");
        }

        ServiceMatch match;
        try
        {
            IReadOnlyList<ServiceInfo> candidates = matchByDescription
                ? EnumerateServicesWithDescriptions()
                : EnumerateServices();
            match = ServiceMatcher.Match(candidates, identifier, matchByDescription);
        }
        catch (Exception ex)
        {
            _logger.Error(ex);
            return ServiceControlResult.Fail($"Failed to look up service '{identifier}': {ex.Message}");
        }

        if (match.Kind == ServiceMatchKind.None)
        {
            string how = matchByDescription ? "a description matching" : "the name or display name";
            return ServiceControlResult.Fail($"No Windows service found with {how} '{identifier}'.");
        }

        // A fuzzy (non-exact) match is only a best guess. Defer to the caller to confirm
        // the resolved service with the user before actually restarting anything.
        if (match.Kind == ServiceMatchKind.Fuzzy)
        {
            return ServiceControlResult.Confirm(match.ServiceName, match.DisplayName);
        }

        return PerformRestart(match.ServiceName, match.DisplayName, elevate);
    }

    /// <summary>
    /// Restarts the resolved service. Controlling a service requires administrator rights, so when
    /// the host is not elevated the caller must first obtain the user's consent (<paramref name="elevate"/>);
    /// only then is the restart delegated to an elevated PowerShell helper (which prompts via UAC).
    /// </summary>
    private ServiceControlResult PerformRestart(string serviceName, string displayName, bool elevate)
    {
        if (IsElevated())
        {
            return RestartInProcess(serviceName, displayName);
        }

        // Not elevated: only run the elevated helper once the user has agreed to it; otherwise ask
        // the caller to obtain consent first.
        return elevate
            ? RestartElevated(serviceName, displayName)
            : ServiceControlResult.Elevate(serviceName, displayName);
    }

    /// <summary>
    /// Restarts the service in-process via <see cref="ServiceController"/> (requires the host to
    /// already be elevated).
    /// </summary>
    private ServiceControlResult RestartInProcess(string serviceName, string displayName)
    {
        try
        {
            using var controller = new ServiceController(serviceName);
            string resolvedDisplayName = string.IsNullOrWhiteSpace(controller.DisplayName)
                ? displayName
                : controller.DisplayName;
            Restart(controller);
            return ServiceControlResult.Ok(resolvedDisplayName);
        }
        catch (Exception ex) when (IsAccessDenied(ex))
        {
            _logger.Error(ex);
            return ServiceControlResult.Fail(
                $"Access was denied restarting '{displayName}'. The service's security settings prevent it from being controlled.");
        }
        catch (Exception ex)
        {
            _logger.Error(ex);
            return ServiceControlResult.Fail($"Failed to restart service '{serviceName}': {ex.Message}");
        }
    }

    /// <summary>
    /// Restarts the service by launching an elevated PowerShell process. The OS shows a UAC consent
    /// prompt; declining it (or a failure inside the helper) yields a failure result.
    /// </summary>
    private ServiceControlResult RestartElevated(string serviceName, string displayName)
    {
        // Single-quote-escape the service name for safe embedding in the PowerShell command.
        string psName = serviceName.Replace("'", "''");
        var startInfo = new ProcessStartInfo
        {
            FileName = "powershell.exe",
            Arguments =
                "-NoProfile -ExecutionPolicy Bypass -Command " +
                $"\"try {{ Restart-Service -Name '{psName}' -Force -ErrorAction Stop }} catch {{ exit 1 }}\"",
            UseShellExecute = true,
            Verb = "runas",
            WindowStyle = ProcessWindowStyle.Hidden,
        };

        try
        {
            using Process proc = Process.Start(startInfo);
            if (proc == null)
            {
                return ServiceControlResult.Fail($"Failed to launch an elevated restart for '{displayName}'.");
            }

            if (!proc.WaitForExit(ElevatedRestartTimeoutMs))
            {
                return ServiceControlResult.Fail(
                    $"Timed out waiting for '{displayName}' to restart with elevation.");
            }

            return proc.ExitCode == 0
                ? ServiceControlResult.Ok(displayName)
                : ServiceControlResult.Fail(
                    $"The elevated restart of '{displayName}' did not complete successfully.");
        }
        catch (Win32Exception ex) when (ex.NativeErrorCode == 1223) // ERROR_CANCELLED
        {
            return ServiceControlResult.Fail(
                $"Restarting '{displayName}' needs administrator approval, which was declined.");
        }
        catch (Exception ex)
        {
            _logger.Error(ex);
            return ServiceControlResult.Fail($"Failed to restart '{displayName}' with elevation: {ex.Message}");
        }
    }

    /// <summary>Returns whether the current process is running with administrator rights.</summary>
    private static bool IsElevated()
    {
        try
        {
            using var identity = WindowsIdentity.GetCurrent();
            return new WindowsPrincipal(identity).IsInRole(WindowsBuiltInRole.Administrator);
        }
        catch
        {
            return false;
        }
    }

    /// <summary>Returns whether an exception (or any inner exception) is a Win32 access-denied error.</summary>
    private static bool IsAccessDenied(Exception ex)
    {
        for (Exception current = ex; current != null; current = current.InnerException)
        {
            if (current is Win32Exception win32 && win32.NativeErrorCode == 5) // ERROR_ACCESS_DENIED
            {
                return true;
            }
        }

        return false;
    }

    /// <summary>
    /// Stops the service (and any running dependents) and starts it again, waiting for each
    /// state transition to complete.
    /// </summary>
    private static void Restart(ServiceController controller)
    {
        // Dependent services must be stopped before the target service can stop.
        // Remember which ones we stopped so we can restore them after restarting.
        var dependentNamesToRestart = new List<string>();
        foreach (var dependent in controller.DependentServices)
        {
            if (dependent.Status != ServiceControllerStatus.Stopped)
            {
                dependentNamesToRestart.Add(dependent.ServiceName);
                dependent.Stop();
                dependent.WaitForStatus(ServiceControllerStatus.Stopped, StatusTimeout);
            }
        }

        controller.Refresh();
        if (controller.Status != ServiceControllerStatus.Stopped)
        {
            if (!controller.CanStop)
            {
                throw new InvalidOperationException(
                    $"Service '{controller.ServiceName}' cannot be stopped in its current state ({controller.Status}).");
            }

            controller.Stop();
            controller.WaitForStatus(ServiceControllerStatus.Stopped, StatusTimeout);
        }

        controller.Start();
        controller.WaitForStatus(ServiceControllerStatus.Running, StatusTimeout);

        foreach (var name in dependentNamesToRestart)
        {
            using var dependent = new ServiceController(name);
            dependent.Refresh();
            if (dependent.Status != ServiceControllerStatus.Running)
            {
                dependent.Start();
                dependent.WaitForStatus(ServiceControllerStatus.Running, StatusTimeout);
            }
        }
    }

    /// <summary>
    /// Enumerates all installed services (name and display name only) for matching.
    /// </summary>
    private static List<ServiceInfo> EnumerateServices()
    {
        var services = ServiceController.GetServices();
        try
        {
            var list = new List<ServiceInfo>(services.Length);
            foreach (var sc in services)
            {
                list.Add(new ServiceInfo(sc.ServiceName, sc.DisplayName, null));
            }

            return list;
        }
        finally
        {
            foreach (var sc in services)
            {
                sc.Dispose();
            }
        }
    }

    /// <summary>
    /// Enumerates all installed services including their descriptions (via WMI) for matching.
    /// </summary>
    private static List<ServiceInfo> EnumerateServicesWithDescriptions()
    {
        var list = new List<ServiceInfo>();
        using var searcher = new ManagementObjectSearcher(
            "SELECT Name, DisplayName, Description FROM Win32_Service");
        using var results = searcher.Get();
        foreach (ManagementBaseObject service in results)
        {
            using (service)
            {
                list.Add(new ServiceInfo(
                    service["Name"] as string,
                    service["DisplayName"] as string,
                    service["Description"] as string));
            }
        }

        return list;
    }
}
