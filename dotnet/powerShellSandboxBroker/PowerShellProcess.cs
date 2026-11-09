// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Security.AccessControl;
using System.Security.Principal;
using System.Text;
using Microsoft.Win32.SafeHandles;

namespace TypeAgent.PowerShellSandboxBroker;

internal sealed class PowerShellProcess : IDisposable
{
    private readonly string profileName;
    private readonly IntPtr packageSid;
    private readonly string profilePath;
    private readonly IntPtr job;
    private readonly IntPtr process;
    private readonly SafeFileHandle stdoutRead;
    private readonly SafeFileHandle stderrRead;
    private bool disposed;

    private PowerShellProcess(
        string profileName,
        IntPtr packageSid,
        string profilePath,
        IntPtr job,
        IntPtr process,
        SafeFileHandle stdoutRead,
        SafeFileHandle stderrRead)
    {
        this.profileName = profileName;
        this.packageSid = packageSid;
        this.profilePath = profilePath;
        this.job = job;
        this.process = process;
        this.stdoutRead = stdoutRead;
        this.stderrRead = stderrRead;
    }

    internal static (PowerShellProcess Process, string ProfilePath) Start(
        string scriptHostPath,
        string requestJson,
        bool diagnostics,
        bool approvedLocal = false,
        string? workingDirectory = null)
    {
        if (approvedLocal)
        {
            return StartApprovedLocal(scriptHostPath, requestJson, diagnostics,
                workingDirectory ?? throw new ArgumentException("An approved working directory is required."));
        }
        var profileName = $"TypeAgent.PowerShell.{Guid.NewGuid():N}";
        var hr = NativeMethods.CreateAppContainerProfile(
            profileName,
            "TypeAgent PowerShell",
            "Ephemeral TypeAgent PowerShell execution",
            IntPtr.Zero,
            0,
            out var packageSid);
        if (hr < 0)
        {
            Marshal.ThrowExceptionForHR(hr);
        }

        IntPtr stringSid = IntPtr.Zero;
        IntPtr profilePathPointer = IntPtr.Zero;
        try
        {
            if (!NativeMethods.ConvertSidToStringSidW(packageSid, out stringSid))
            {
                throw NativeMethods.LastError("ConvertSidToStringSidW failed.");
            }
            var sidText = Marshal.PtrToStringUni(stringSid)
                ?? throw new InvalidOperationException("The AppContainer SID is empty.");
            hr = NativeMethods.GetAppContainerFolderPath(sidText, out profilePathPointer);
            if (hr < 0)
            {
                Marshal.ThrowExceptionForHR(hr);
            }
            var profilePath = Marshal.PtrToStringUni(profilePathPointer)
                ?? throw new InvalidOperationException("The AppContainer profile path is empty.");

            Directory.CreateDirectory(profilePath);
            ClearProfile(profilePath);
            var privateHostPath = Path.Combine(profilePath, "scriptHost.ps1");
            var privateRequestPath = Path.Combine(profilePath, "request.json");
            File.Copy(scriptHostPath, privateHostPath, overwrite: true);
            File.WriteAllText(
                privateRequestPath,
                requestJson,
                new UTF8Encoding(encoderShouldEmitUTF8Identifier: false));

            return (
                StartProcess(
                    profileName,
                    packageSid,
                    profilePath,
                    privateHostPath,
                    privateRequestPath,
                    diagnostics,
                    approvedLocal: false,
                    workingDirectory: profilePath),
                profilePath);
        }
        catch
        {
            NativeMethods.FreeSid(packageSid);
            _ = NativeMethods.DeleteAppContainerProfile(profileName);
            throw;
        }
        finally
        {
            if (stringSid != IntPtr.Zero)
            {
                NativeMethods.LocalFree(stringSid);
            }
            if (profilePathPointer != IntPtr.Zero)
            {
                NativeMethods.CoTaskMemFree(profilePathPointer);
            }
        }
    }

    private static (PowerShellProcess Process, string ProfilePath) StartApprovedLocal(
        string scriptHostPath, string requestJson, bool diagnostics, string workingDirectory)
    {
        var directory = Path.Combine(Path.GetTempPath(), $"TypeAgent.PowerShell.{Guid.NewGuid():N}");
        using var identity = WindowsIdentity.GetCurrent();
        var security = new DirectorySecurity();
        security.SetAccessRuleProtection(isProtected: true, preserveInheritance: false);
        security.AddAccessRule(new FileSystemAccessRule(
            identity.User ?? throw new InvalidOperationException("The current Windows user has no SID."),
            FileSystemRights.FullControl,
            InheritanceFlags.ContainerInherit | InheritanceFlags.ObjectInherit,
            PropagationFlags.None,
            AccessControlType.Allow));
        new DirectoryInfo(directory).Create(security);
        try
        {
            var host = Path.Combine(directory, "scriptHost.ps1");
            var request = Path.Combine(directory, "request.json");
            File.Copy(scriptHostPath, host);
            File.WriteAllText(request, requestJson, new UTF8Encoding(false));
            return (StartProcess("", IntPtr.Zero, directory, host, request, diagnostics,
                approvedLocal: true, workingDirectory), directory);
        }
        catch
        {
            ClearProfile(directory);
            if (Directory.Exists(directory)) Directory.Delete(directory);
            throw;
        }
    }

    private static PowerShellProcess StartProcess(
        string profileName,
        IntPtr packageSid,
        string profilePath,
        string scriptHostPath,
        string requestPath,
        bool diagnostics,
        bool approvedLocal,
        string workingDirectory)
    {
        var pipeAttributes = new NativeMethods.SecurityAttributes
        {
            Length = Marshal.SizeOf<NativeMethods.SecurityAttributes>(),
            InheritHandle = true,
        };
        if (!NativeMethods.CreatePipe(
                out var stdoutReadRaw,
                out var stdoutWrite,
                ref pipeAttributes,
                0) ||
            !NativeMethods.CreatePipe(
                out var stderrReadRaw,
                out var stderrWrite,
                ref pipeAttributes,
                0))
        {
            throw NativeMethods.LastError("CreatePipe failed.");
        }

        var stdoutRead = new SafeFileHandle(stdoutReadRaw, ownsHandle: true);
        var stderrRead = new SafeFileHandle(stderrReadRaw, ownsHandle: true);
        if (!NativeMethods.SetHandleInformation(stdoutReadRaw, NativeMethods.HandleFlagInherit, 0) ||
            !NativeMethods.SetHandleInformation(stderrReadRaw, NativeMethods.HandleFlagInherit, 0))
        {
            throw NativeMethods.LastError("SetHandleInformation failed.");
        }

        const uint genericRead = 0x80000000;
        const uint shareReadWrite = 0x00000003;
        const uint openExisting = 3;
        var standardInput = NativeMethods.CreateFileW(
            "NUL",
            genericRead,
            shareReadWrite,
            ref pipeAttributes,
            openExisting,
            0,
            IntPtr.Zero);
        if (standardInput.IsInvalid)
        {
            throw NativeMethods.LastError("Opening NUL failed.");
        }

        IntPtr attributeList = IntPtr.Zero;
        IntPtr securityCapabilitiesPointer = IntPtr.Zero;
        IntPtr handleListPointer = IntPtr.Zero;
        IntPtr environmentPointer = IntPtr.Zero;
        IntPtr job = IntPtr.Zero;
        NativeMethods.ProcessInformation processInformation = default;

        try
        {
            nuint attributeListSize = 0;
            NativeMethods.InitializeProcThreadAttributeList(
                IntPtr.Zero,
                approvedLocal ? 1 : 2,
                0,
                ref attributeListSize);
            attributeList = Marshal.AllocHGlobal((nint)attributeListSize);
            if (!NativeMethods.InitializeProcThreadAttributeList(
                    attributeList,
                    approvedLocal ? 1 : 2,
                    0,
                    ref attributeListSize))
            {
                throw NativeMethods.LastError("InitializeProcThreadAttributeList failed.");
            }

            if (!approvedLocal)
            {
                var securityCapabilities = new NativeMethods.SecurityCapabilities
                {
                    AppContainerSid = packageSid,
                };
                securityCapabilitiesPointer = Marshal.AllocHGlobal(
                    Marshal.SizeOf<NativeMethods.SecurityCapabilities>());
                Marshal.StructureToPtr(securityCapabilities, securityCapabilitiesPointer, false);
                if (!NativeMethods.UpdateProcThreadAttribute(
                    attributeList,
                    0,
                    NativeMethods.ProcThreadAttributeSecurityCapabilities,
                    securityCapabilitiesPointer,
                    (nuint)Marshal.SizeOf<NativeMethods.SecurityCapabilities>(),
                    IntPtr.Zero,
                    IntPtr.Zero))
                {
                    throw NativeMethods.LastError("Adding AppContainer attributes failed.");
                }
            }

            var inheritedHandles = new[]
            {
                standardInput.DangerousGetHandle(),
                stdoutWrite,
                stderrWrite,
            };
            handleListPointer = Marshal.AllocHGlobal(IntPtr.Size * inheritedHandles.Length);
            for (var index = 0; index < inheritedHandles.Length; index++)
            {
                Marshal.WriteIntPtr(handleListPointer, index * IntPtr.Size, inheritedHandles[index]);
            }
            if (!NativeMethods.UpdateProcThreadAttribute(
                    attributeList,
                    0,
                    NativeMethods.ProcThreadAttributeHandleList,
                    handleListPointer,
                    (nuint)(IntPtr.Size * inheritedHandles.Length),
                    IntPtr.Zero,
                    IntPtr.Zero))
            {
                throw NativeMethods.LastError("Adding inherited-handle attributes failed.");
            }

            job = CreateJob(approvedLocal);
            environmentPointer = approvedLocal
                ? CreateApprovedEnvironmentBlock()
                : CreateEnvironmentBlock(profilePath);

            var powerShellPath = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.System),
                "WindowsPowerShell",
                "v1.0",
                "powershell.exe");
            var commandLine = new StringBuilder(
                $"\"{powerShellPath}\" -NoLogo -NoProfile -NonInteractive " +
                (approvedLocal ? "" : "-ExecutionPolicy Bypass ") +
                $"-File \"{scriptHostPath}\" " +
                $"-RequestPath \"{requestPath}\"" +
                (diagnostics ? " -Diagnostics" : ""));
            var startupInfo = new NativeMethods.StartupInfoEx
            {
                StartupInfo = new NativeMethods.StartupInfo
                {
                    Cb = Marshal.SizeOf<NativeMethods.StartupInfoEx>(),
                    Flags = NativeMethods.StartfUseStdHandles,
                    StandardInput = standardInput.DangerousGetHandle(),
                    StandardOutput = stdoutWrite,
                    StandardError = stderrWrite,
                },
                AttributeList = attributeList,
            };

            var creationFlags =
                NativeMethods.ExtendedStartupInfoPresent |
                NativeMethods.CreateSuspended |
                NativeMethods.CreateNoWindow |
                NativeMethods.CreateUnicodeEnvironment;
            if (!NativeMethods.CreateProcessW(
                    powerShellPath,
                    commandLine,
                    IntPtr.Zero,
                    IntPtr.Zero,
                    true,
                    creationFlags,
                    environmentPointer,
                    workingDirectory,
                    ref startupInfo,
                    out processInformation))
            {
                throw NativeMethods.LastError("CreateProcessW failed.");
            }
            if (!NativeMethods.AssignProcessToJobObject(job, processInformation.Process))
            {
                throw NativeMethods.LastError("AssignProcessToJobObject failed.");
            }
            if (NativeMethods.ResumeThread(processInformation.Thread) == uint.MaxValue)
            {
                throw NativeMethods.LastError("ResumeThread failed.");
            }

            NativeMethods.CloseHandle(processInformation.Thread);
            processInformation.Thread = IntPtr.Zero;
            NativeMethods.CloseHandle(stdoutWrite);
            stdoutWrite = IntPtr.Zero;
            NativeMethods.CloseHandle(stderrWrite);
            stderrWrite = IntPtr.Zero;
            standardInput.Dispose();

            return new PowerShellProcess(
                profileName,
                packageSid,
                profilePath,
                job,
                processInformation.Process,
                stdoutRead,
                stderrRead);
        }
        catch
        {
            if (processInformation.Process != IntPtr.Zero)
            {
                _ = NativeMethods.TerminateProcess(
                    processInformation.Process,
                    1);
                NativeMethods.CloseHandle(processInformation.Process);
            }
            if (processInformation.Thread != IntPtr.Zero)
            {
                NativeMethods.CloseHandle(processInformation.Thread);
            }
            if (job != IntPtr.Zero)
            {
                NativeMethods.CloseHandle(job);
            }
            stdoutRead.Dispose();
            stderrRead.Dispose();
            throw;
        }
        finally
        {
            if (stdoutWrite != IntPtr.Zero)
            {
                NativeMethods.CloseHandle(stdoutWrite);
            }
            if (stderrWrite != IntPtr.Zero)
            {
                NativeMethods.CloseHandle(stderrWrite);
            }
            standardInput.Dispose();
            if (attributeList != IntPtr.Zero)
            {
                NativeMethods.DeleteProcThreadAttributeList(attributeList);
                Marshal.FreeHGlobal(attributeList);
            }
            if (securityCapabilitiesPointer != IntPtr.Zero)
            {
                Marshal.FreeHGlobal(securityCapabilitiesPointer);
            }
            if (handleListPointer != IntPtr.Zero)
            {
                Marshal.FreeHGlobal(handleListPointer);
            }
            if (environmentPointer != IntPtr.Zero)
            {
                Marshal.FreeHGlobal(environmentPointer);
            }
        }
    }

    internal async Task<BrokerResponse> WaitAsync(
        int timeoutSeconds,
        int maxOutputBytes,
        Task cancellation)
    {
        var stopwatch = Stopwatch.StartNew();
        using var stdoutStream = new FileStream(
            stdoutRead,
            FileAccess.Read,
            4096,
            isAsync: false);
        using var stderrStream = new FileStream(
            stderrRead,
            FileAccess.Read,
            4096,
            isAsync: false);
        var stdoutTask = ReadLimitedAsync(stdoutStream, maxOutputBytes);
        var stderrTask = ReadLimitedAsync(stderrStream, maxOutputBytes);

        var processWait = Task.Run(
            () => NativeMethods.WaitForSingleObject(
                process,
                NativeMethods.Infinite));
        var timeout = Task.Delay(TimeSpan.FromSeconds(timeoutSeconds + 2));
        var completed = await Task.WhenAny(processWait, timeout, cancellation);
        var cancelled = completed == cancellation;
        var timedOut = completed == timeout;
        if (cancelled || timedOut)
        {
            NativeMethods.TerminateJobObject(job, 1);
            _ = NativeMethods.WaitForSingleObject(process, 5000);
        }
        var waitResult = await processWait;
        if (waitResult != NativeMethods.WaitObject0)
        {
            throw NativeMethods.LastError("WaitForSingleObject failed.");
        }
        // Descendants can keep the pipes open after the root exits.
        if (!NativeMethods.TerminateJobObject(job, 1))
        {
            throw NativeMethods.LastError("Terminating the PowerShell job failed.");
        }

        var (Text, Truncated) = await stdoutTask;
        var stderr = await stderrTask;
        NativeMethods.GetExitCodeProcess(process, out var exitCode);
        stopwatch.Stop();
        var errorCode = timedOut
            ? "broker.timeout"
            : exitCode != 0 && stderr.Text.Contains(
                "policy denied",
                StringComparison.OrdinalIgnoreCase)
                ? "broker.policyDenied"
                : null;

        return new BrokerResponse(
            Success: !cancelled && !timedOut && exitCode == 0,
            Stdout: Text,
            Stderr: cancelled
                ? "PowerShell execution was cancelled."
                : timedOut
                    ? $"Script execution timed out after {timeoutSeconds} seconds."
                    : stderr.Text,
            ExitCode: cancelled || timedOut ? -1 : unchecked((int)exitCode),
            Duration: stopwatch.ElapsedMilliseconds,
            Truncated: Truncated || stderr.Truncated,
            Cancelled: cancelled,
            ErrorCode: cancelled ? "broker.cancelled" : errorCode);
    }

    private static IntPtr CreateJob(bool approvedLocal)
    {
        var job = NativeMethods.CreateJobObjectW(IntPtr.Zero, null);
        if (job == IntPtr.Zero)
        {
            throw NativeMethods.LastError("CreateJobObjectW failed.");
        }
        var limits = new NativeMethods.JobObjectExtendedLimitInformation
        {
            BasicLimitInformation = new NativeMethods.JobObjectBasicLimitInformation
            {
                LimitFlags =
                    (approvedLocal ? 0 : NativeMethods.JobObjectLimitActiveProcess) |
                    NativeMethods.JobObjectLimitDieOnUnhandledException |
                    NativeMethods.JobObjectLimitKillOnJobClose,
                ActiveProcessLimit = approvedLocal ? 0u : 1u,
            },
        };
        var pointer = Marshal.AllocHGlobal(
            Marshal.SizeOf<NativeMethods.JobObjectExtendedLimitInformation>());
        try
        {
            Marshal.StructureToPtr(limits, pointer, false);
            return !NativeMethods.SetInformationJobObject(
                    job,
                    NativeMethods.JobObjectExtendedLimitInformationClass,
                    pointer,
                    (uint)Marshal.SizeOf<NativeMethods.JobObjectExtendedLimitInformation>())
                ? throw NativeMethods.LastError("SetInformationJobObject failed.")
                : job;
        }
        catch
        {
            NativeMethods.CloseHandle(job);
            throw;
        }
        finally
        {
            Marshal.FreeHGlobal(pointer);
        }
    }

    private static IntPtr CreateApprovedEnvironmentBlock()
    {
        var variables = new SortedDictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        foreach (var name in ApprovedEnvironmentVariables)
        {
            var value = Environment.GetEnvironmentVariable(name);
            if (value is not null) variables[name] = value;
        }
        variables["POWERSHELL_TELEMETRY_OPTOUT"] = "1";
        variables.TryAdd("PATHEXT", ".COM;.EXE;.BAT;.CMD");
        variables["PSModulePath"] = WindowsPowerShellModulePath();
        var block = string.Join('\0', variables.Select(pair => $"{pair.Key}={pair.Value}")) + "\0\0";
        return Marshal.StringToHGlobalUni(block);
    }

    private static string WindowsPowerShellModulePath()
    {
        var defaults = new[]
        {
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments), "WindowsPowerShell", "Modules"),
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "WindowsPowerShell", "Modules"),
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System), "WindowsPowerShell", "v1.0", "Modules"),
        };
        var inherited = (Environment.GetEnvironmentVariable("PSModulePath") ?? "")
            .Split(';', StringSplitOptions.RemoveEmptyEntries);
        // A Node host launched from pwsh inherits PowerShell 7's runtime modules.
        // They can shadow incompatible Windows PowerShell modules such as Utility.
        var compatible = inherited.Where(path =>
            !Path.GetFileName(Path.TrimEndingDirectorySeparator(path)).Equals("Modules", StringComparison.OrdinalIgnoreCase) ||
            !File.Exists(Path.Combine(Path.GetDirectoryName(Path.TrimEndingDirectorySeparator(path)) ?? "", "pwsh.exe")));
        return string.Join(';', defaults.Concat(compatible).Distinct(StringComparer.OrdinalIgnoreCase));
    }

    private static readonly string[] ApprovedEnvironmentVariables =
    [
        "APPDATA", "COMSPEC", "HOME", "HOMEDRIVE", "HOMEPATH", "LOCALAPPDATA",
        "NUMBER_OF_PROCESSORS", "OS", "PATH", "PATHEXT", "PROCESSOR_ARCHITECTURE",
        "ProgramFiles", "ProgramFiles(x86)", "ProgramW6432", "PSModulePath",
        "SYSTEMROOT", "TEMP", "TMP", "USERDOMAIN", "USERNAME", "USERPROFILE", "WINDIR",
        "LANG", "LC_ALL", "SSH_AUTH_SOCK",
    ];

    private static IntPtr CreateEnvironmentBlock(string profilePath)
    {
        var variables = new SortedDictionary<string, string>(
            StringComparer.OrdinalIgnoreCase)
        {
            ["COMSPEC"] = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.System),
                "cmd.exe"),
            ["LOCALAPPDATA"] = profilePath,
            ["POWERSHELL_TELEMETRY_OPTOUT"] = "1",
            ["SYSTEMROOT"] = Environment.GetFolderPath(Environment.SpecialFolder.Windows),
            ["TEMP"] = Path.Combine(profilePath, "Temp"),
            ["TMP"] = Path.Combine(profilePath, "Temp"),
            ["USERPROFILE"] = profilePath,
            ["WINDIR"] = Environment.GetFolderPath(Environment.SpecialFolder.Windows),
        };
        Directory.CreateDirectory(variables["TEMP"]);
        var block = string.Join('\0', variables.Select(pair => $"{pair.Key}={pair.Value}")) + "\0\0";
        return Marshal.StringToHGlobalUni(block);
    }

    private static async Task<(string Text, bool Truncated)> ReadLimitedAsync(
        Stream stream,
        int maximumBytes)
    {
        var buffer = new byte[8192];
        using var output = new MemoryStream();
        var truncated = false;
        while (true)
        {
            var count = await stream.ReadAsync(buffer);
            if (count == 0)
            {
                break;
            }
            var remaining = maximumBytes - checked((int)output.Length);
            if (remaining > 0)
            {
                await output.WriteAsync(buffer.AsMemory(0, Math.Min(count, remaining)));
            }
            if (count > remaining)
            {
                truncated = true;
            }
        }
        return (Encoding.UTF8.GetString(output.ToArray()), truncated);
    }

    public void Dispose()
    {
        if (disposed)
        {
            return;
        }
        disposed = true;
        stdoutRead.Dispose();
        stderrRead.Dispose();
        NativeMethods.CloseHandle(process);
        NativeMethods.CloseHandle(job);
        if (packageSid != IntPtr.Zero) NativeMethods.FreeSid(packageSid);
        ClearProfile(profilePath);
        if (profileName.Length > 0)
        {
            _ = NativeMethods.DeleteAppContainerProfile(profileName);
        }
        else if (Directory.Exists(profilePath))
        {
            Directory.Delete(profilePath);
        }
    }

    private static void ClearProfile(string path)
    {
        if (!Directory.Exists(path))
        {
            return;
        }
        if ((File.GetAttributes(path) & FileAttributes.ReparsePoint) != 0)
        {
            Directory.Delete(path, recursive: false);
            return;
        }
        foreach (var entry in Directory.EnumerateFileSystemEntries(path))
        {
            if (Directory.Exists(entry))
            {
                var attributes = File.GetAttributes(entry);
                Directory.Delete(
                    entry,
                    recursive:
                        (attributes & FileAttributes.ReparsePoint) == 0);
            }
            else
            {
                File.Delete(entry);
            }
        }
    }
}
