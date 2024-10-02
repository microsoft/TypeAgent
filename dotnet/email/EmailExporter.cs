// Copyright (c) Microsoft. All rights reserved.

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

        Email email = _outlook.LoadEmail(sourcePath);
        email.Save(destPath);
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

    string DestFilePath(string sourceFilePath, string destFolderPath)
    {
        return Path.Join(destFolderPath, Path.GetFileNameWithoutExtension(sourceFilePath) + ".json");
    }

    public void PrintEmail(string sourcePath)
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
        string path = @"C:\data\testEmail\msg\Weekly T&R Security Compliance Status Report (September 30) .msg";
        try
        {
            using Outlook outlook = new Outlook();
            var exporter = new EmailExporter(outlook);
            switch (args.Length)
            {
                default:
                    exporter.Export(args.ElementAtOrDefault(0), args.ElementAtOrDefault(1));
                    break;
                case 0:
                    exporter.PrintEmail(path);
                    break;
            }
        }
        finally
        {
            COMObject.ReleaseAll();
        }
    }
}
