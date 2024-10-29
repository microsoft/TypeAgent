// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using TypeAgent.Core;

namespace TypeAgent;

public class EmailExporter
{
    Outlook _outlook;
    public EmailExporter(Outlook outlook)
    {
        ArgumentNullException.ThrowIfNull(outlook);
        _outlook = outlook;
    }

    public void Export(string sourcePath, string destPath)
    {
        ArgumentException.ThrowIfNullOrEmpty(sourcePath, nameof(sourcePath));

        if (PathEx.IsDirectory(sourcePath))
        {
            ExportDirectory(sourcePath, destPath);
        }
        else
        {
            ExportFile(sourcePath, destPath);
        }
    }

    public void ExportFile(string sourcePath, string? destPath)
    {
        Verify.FileExists(sourcePath);
        if (string.IsNullOrEmpty(destPath))
        {
            string destFolderPath = EnsureDestJsonFolder(Path.GetDirectoryName(sourcePath));
            destPath = DestFilePath(sourcePath, destFolderPath);
        }

        try
        {
            Email email = _outlook.LoadEmail(sourcePath);
            email.Save(destPath);
        }
        catch(System.Exception ex)
        {
            WriteLineColor(ConsoleColor.Red, $"SKIPPED {sourcePath}");
            LogError(ex);
        }
    }

    public void ExportDirectory(string sourcePath, string destPath)
    {
        Verify.DirectoryExists(sourcePath);
        if (string.IsNullOrEmpty(destPath))
        {
            destPath = EnsureDestJsonFolder(sourcePath);
        }
        int count = 0;
        foreach (string sourceFilePath in Directory.EnumerateFiles(sourcePath))
        {
            ++count;
            Console.WriteLine($"{count}: {Path.GetFileName(sourceFilePath)}");
            ExportFile(sourceFilePath, DestFilePath(sourceFilePath, destPath));
        }
    }

    public void ExportFrom(string senderName)
    {
        List<Email> emails = _outlook.LoadFrom(senderName);
        foreach(var email in emails)
        {
            Console.WriteLine(email.ToString());
        }
    }

    string DestFilePath(string sourceFilePath, string destFolderPath)
    {
        return Path.Join(destFolderPath, Path.GetFileNameWithoutExtension(sourceFilePath) + ".json");
    }

    public void PrintEmail(string sourcePath)
    {
        if (PathEx.IsDirectory(sourcePath))
        {
            int count = 0;
            foreach (string sourceFilePath in Directory.EnumerateFiles(sourcePath))
            {
                ++count;
                Console.WriteLine($"{count}: {Path.GetFileName(sourceFilePath)}");
                PrintFile(sourceFilePath);
            }
        }
        else
        {
            PrintFile(sourcePath);
        }
    }

    void PrintFile(string sourcePath)
    {
        Email email = _outlook.LoadEmail(sourcePath);
        Console.WriteLine(email.ToString());
    }

    string EnsureDestJsonFolder(string dirPath)
    {
        string destFolderPath = Path.Join(dirPath, "json");
        DirectoryEx.Ensure(destFolderPath);
        return destFolderPath;
    }

    static void Main(string[] args)
    {
        args = EnsureArgs(args);
        if (args == null || args.Length == 0)
        {
            return;
        }
        try
        {
            using Outlook outlook = new Outlook();
            var exporter = new EmailExporter(outlook);
            switch(args[0])
            {
                default:
                    exporter.Export(args.ElementAtOrDefault(0), args.ElementAtOrDefault(1));
                    break;

                case "--sender":
                    exporter.ExportFrom(args.GetArg(1));
                    break;

                case "--print":
                    exporter.PrintEmail(args.GetArg(1));
                    Console.ReadLine();
                    return;
            }
        }
        catch(System.Exception ex)
        {
            LogError(ex);
        }
        finally
        {
            COMObject.ReleaseAll();
        }
    }

    static string[]? EnsureArgs(string[] args)
    {
        if (args != null && args.Length > 0)
        {
            return args;
        }
        return GetInput();
    }

    static string[] GetInput()
    {
        Console.Write(">");
        string line = Console.ReadLine();
        if (line != null)
        {
            line = line.Trim();
        }
        if (string.IsNullOrEmpty(line))
        {
            return null;
        }
        return line.ParseCommandLine();
    }

    static void LogError(System.Exception ex)
    {
        WriteLineColor(ConsoleColor.DarkYellow, $"##Error##\n{ex.Message}\n####");
        Console.WriteLine();
    }

    static void WriteLineColor(ConsoleColor color, string message)
    {
        var prevColor = Console.ForegroundColor;
        Console.ForegroundColor = color;
        Console.WriteLine(message);
        Console.ForegroundColor = prevColor;
    }
}
