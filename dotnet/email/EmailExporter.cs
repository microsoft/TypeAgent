// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using TypeAgent.Core;

namespace TypeAgent;

public class EmailExporter
{
    public enum ExportFormat
    {
        Json,
        Txt
    }

    const int MaxFileNameLength = 64;

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

    public void ExportFile(string sourcePath, string? destPath, ExportFormat format = ExportFormat.Json)
    {
        Verify.FileExists(sourcePath);
        if (string.IsNullOrEmpty(destPath))
        {
            string destFolderPath = EnsureDestJsonFolder(Path.GetDirectoryName(sourcePath));
            destPath = DestFilePath(sourcePath, destFolderPath);
        }

        try
        {
            if (format == ExportFormat.Json)
            {
                Email email = _outlook.LoadEmail(sourcePath);
                email.Save(destPath);
            }
            else
            {
                string txtFilePath = PathEx.ReplaceFileNameExtension(destPath, ".txt");
                _outlook.SaveEmailAsText(sourcePath, txtFilePath);
            }
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
            ExportFile(sourceFilePath, DestFilePath(sourceFilePath, destPath), ExportFormat.Json);
        }
    }

    public void ExportAll(string rootPath, int maxMessages, bool bucketBySize = true, bool convert = false)
    {
        if (maxMessages <= 0)
        {
            maxMessages = int.MaxValue;
        }
        DirectoryEx.Ensure(rootPath);
        int counter = 0;
        foreach (MailItem item in _outlook.MapMailItems<MailItem>((item) => item))
        {
            ++counter;
            try
            {
                bool isForward = item.IsForward();
                if (isForward)
                {
                    // Todo: need to parse Forwards
                    continue;
                }
                Console.WriteLine($"#{counter}");
                Console.WriteLine(item.Subject);

                string destDirPath = bucketBySize ? GetDestDir(rootPath, item.BodyLatest().Length) : rootPath;
                string fileName = FileEx.SanitizeFileName(item.Subject, MaxFileNameLength);
                string msgFilePath = FileEx.MakeUnique(destDirPath, fileName, ".msg");
                item.SaveAs(msgFilePath);
                if (convert)
                {
                    Email email = new Email(item, msgFilePath);
                    string jsonDirPath = Path.Join(destDirPath, "json");
                    DirectoryEx.Ensure(jsonDirPath);
                    string jsonFilePath = FileEx.MakeUnique(jsonDirPath, fileName, ".json");
                    email.Save(jsonFilePath);
                }
            }
            catch (System.Exception ex)
            {
                ConsoleEx.LogError(ex);
            }
            if (counter >= maxMessages)
            {
                break;
            }
        }
    }

    public void ExportAllEmailBySizeJson(string rootPath)
    {
        int counter = 0;
        foreach (MailItem item in _outlook.ForEachMailItem())
        {
            ++counter;
            try
            {
                bool isForward = item.IsForward();
                if (isForward)
                {
                    continue;
                }
                Email email = new Email(item);
                Console.WriteLine($"#{counter}, {email.Body.Length} chars");
                Console.WriteLine(email.Subject);

                int size = email.Body.Length;
                string destDirPath = GetDestDir(rootPath, size);

                string fileName = FileEx.SanitizeFileName(email.Subject, MaxFileNameLength);
                email.Save(FileEx.MakeUnique(destDirPath, fileName, ".json"));

            }
            catch (System.Exception ex)
            {
                ConsoleEx.LogError(ex);
            }
        }
    }

    public void ExportFrom(string senderName)
    {
        List<Email> emails = _outlook.LoadFrom(new EmailSender(senderName));
        foreach (var email in emails)
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

    string GetDestDir(string rootPath, int size)
    {
        int bucket = MailStats.GetBucketForSize(size);
        string destDirPath = Path.Join(rootPath, bucket.ToString());
        DirectoryEx.Ensure(destDirPath);
        return destDirPath;
    }
}
