// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using Microsoft.Win32.SafeHandles;

namespace TypeAgent.PowerShellSandboxBroker;

internal sealed class AppContainerProcess : IDisposable
{
    private readonly IntPtr packageSid;
    private readonly string profilePath;
    private readonly IntPtr job;
    private readonly IntPtr process;
    private readonly SafeFileHandle stdoutRead;
    private readonly SafeFileHandle stderrRead;
    private bool disposed;

    private AppContainerProcess(
        IntPtr packageSid,
        string profilePath,
        IntPtr job,
        IntPtr process,
        SafeFileHandle stdoutRead,
        SafeFileHandle stderrRead)
    {
        this.packageSid = packageSid;
        this.profilePath = profilePath;
        this.job = job;
        this.process = process;
        this.stdoutRead = stdoutRead;
        this.stderrRead = stderrRead;
    }

    internal static (AppContainerProcess Process, string ProfilePath) Start(
        string scriptHostPath,
        string requestJson)
    {
        const string profileName = "TypeAgent.PowerShell.Dynamic";
        var hr = NativeMethods.CreateAppContainerProfile(
            profileName,
            "TypeAgent PowerShell",
            "Ephemeral TypeAgent PowerShell execution",
            IntPtr.Zero,
            0,
            out var packageSid);
        if (hr == unchecked((int)0x800700B7))
        {
            hr = NativeMethods.DeriveAppContainerSidFromAppContainerName(
                profileName,
                out packageSid);
        }
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
                    packageSid,
                    profilePath,
                    privateHostPath,
                    privateRequestPath),
                profilePath);
        }
        catch
        {
            NativeMethods.FreeSid(packageSid);
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

    private static AppContainerProcess StartProcess(
        IntPtr packageSid,
        string profilePath,
        string scriptHostPath,
        string requestPath)
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
                2,
                0,
                ref attributeListSize);
            attributeList = Marshal.AllocHGlobal((nint)attributeListSize);
            if (!NativeMethods.InitializeProcThreadAttributeList(
                    attributeList,
                    2,
                    0,
                    ref attributeListSize))
            {
                throw NativeMethods.LastError("InitializeProcThreadAttributeList failed.");
            }

            var securityCapabilities = new NativeMethods.SecurityCapabilities
            {
                AppContainerSid = packageSid,
            };
            securityCapabilitiesPointer = Marshal.AllocHGlobal(
                Marshal.SizeOf<NativeMethods.SecurityCapabilities>());
            Marshal.StructureToPtr(
                securityCapabilities,
                securityCapabilitiesPointer,
                false);
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

            job = CreateJob();
            environmentPointer = CreateEnvironmentBlock(profilePath);

            var powerShellPath = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.System),
                "WindowsPowerShell",
                "v1.0",
                "powershell.exe");
            var commandLine = new StringBuilder(
                $"\"{powerShellPath}\" -NoLogo -NoProfile -NonInteractive " +
                $"-ExecutionPolicy Bypass -File \"{scriptHostPath}\" " +
                $"-RequestPath \"{requestPath}\"");
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
                    profilePath,
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

            return new AppContainerProcess(
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
        int maxOutputBytes)
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

        var waitResult = await Task.Run(
            () => NativeMethods.WaitForSingleObject(
                process,
                checked((uint)TimeSpan.FromSeconds(timeoutSeconds + 2).TotalMilliseconds)));
        var timedOut = waitResult == NativeMethods.WaitTimeout;
        if (timedOut)
        {
            NativeMethods.TerminateJobObject(job, 1);
            _ = NativeMethods.WaitForSingleObject(process, 5000);
        }
        else if (waitResult != NativeMethods.WaitObject0)
        {
            throw NativeMethods.LastError("WaitForSingleObject failed.");
        }

        var (Text, Truncated) = await stdoutTask;
        var stderr = await stderrTask;
        NativeMethods.GetExitCodeProcess(process, out var exitCode);
        stopwatch.Stop();
        var errorCode = timedOut
            ? "broker.timeout"
            : stderr.Text.Contains(
                "policy denied",
                StringComparison.OrdinalIgnoreCase)
                ? "broker.policyDenied"
                : null;

        return new BrokerResponse(
            Success: !timedOut && exitCode == 0,
            Stdout: Text,
            Stderr: timedOut
                ? $"Script execution timed out after {timeoutSeconds} seconds."
                : stderr.Text,
            ExitCode: timedOut ? -1 : unchecked((int)exitCode),
            Duration: stopwatch.ElapsedMilliseconds,
            Truncated: Truncated || stderr.Truncated,
            Cancelled: false,
            ErrorCode: errorCode);
    }

    private static IntPtr CreateJob()
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
                    NativeMethods.JobObjectLimitActiveProcess |
                    NativeMethods.JobObjectLimitDieOnUnhandledException |
                    NativeMethods.JobObjectLimitKillOnJobClose,
                ActiveProcessLimit = 1,
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
        NativeMethods.FreeSid(packageSid);
        ClearProfile(profilePath);
    }

    private static void ClearProfile(string path)
    {
        if (!Directory.Exists(path))
        {
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
