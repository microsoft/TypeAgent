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
        catch (System.Exception ex)
        {
            ConsoleEx.WriteLineColor(ConsoleColor.Red, $"SKIPPED {sourcePath}");
            ConsoleEx.LogError(ex);
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

    public void ExportAllMsgBySize(string rootPath)
    {
        int counter = 0;
        foreach (MailItem item in _outlook.MapMailItems<MailItem>((item) => item))
        {
            ++counter;
            bool isForward = item.IsForward();
            if (item.IsForward())
            {
                continue;
            }
            Console.WriteLine($"#{counter}");
            Console.WriteLine(item.Subject);

            int size = item.BodyLatest().Length;
            int bucket = MailStats.GetBucketForSize(size);
            string destDirPath = Path.Join(rootPath, bucket.ToString());
            DirectoryEx.Ensure(destDirPath);

            const int MaxFileNameLength = 64;
            string fileName = FileEx.SanitizeFileName(item.Subject, MaxFileNameLength);
            try
            {
                item.SaveAs(FileEx.MakeUnique(destDirPath, fileName, ".msg"));
            }
            catch(System.Exception ex)
            {
                ConsoleEx.LogError(ex);
            }
        }
    }

    public void ExportAllEmailBySizeJson(string rootPath)
    {
        int counter = 0;
        foreach(MailItem item in _outlook.ForEachMailItem())
        {
            ++counter;
            bool isForward = item.IsForward();
            if (item.IsForward())
            {
                continue;
            }
            Email email = new Email(item);
            Console.WriteLine($"#{counter}, {email.Body.Length} chars");
            Console.WriteLine(email.Subject);

            int size = email.Body.Length;
            int bucket = MailStats.GetBucketForSize(size);
            string destDirPath = Path.Join(rootPath, bucket.ToString());
            DirectoryEx.Ensure(destDirPath);

            const int MaxFileNameLength = 64;
            string fileName = FileEx.SanitizeFileName(email.Subject, MaxFileNameLength);
            email.Save(FileEx.MakeUnique(destDirPath, fileName, ".json"));
        }
    }

    public void ExportFrom(string senderName)
    {
        List<Email> emails = _outlook.LoadFrom(senderName);
        foreach (var email in emails)
        {
            Console.WriteLine(email.ToString());
        }
        COMObject.Release(emails);
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

}
