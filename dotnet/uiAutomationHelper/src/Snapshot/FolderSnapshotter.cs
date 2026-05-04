// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace UiAutomationHelper.Snapshot;

internal static class FolderSnapshotter
{
    /// <summary>
    /// Recursively copy <paramref name="sourcePath"/> into <paramref name="destPath"/>.
    /// Returns total bytes copied. <paramref name="exclude"/> matches relative path glob fragments.
    /// </summary>
    public static long Capture(string sourcePath, string destPath, IReadOnlyList<string>? exclude = null)
    {
        if (!Directory.Exists(sourcePath))
        {
            return 0;
        }
        Directory.CreateDirectory(destPath);
        return CopyRecursive(sourcePath, destPath, sourcePath, exclude);
    }

    /// <summary>
    /// Replace <paramref name="targetPath"/>'s contents with what's in
    /// <paramref name="snapshotPath"/>. Removes anything currently at target,
    /// then copies snapshot back. Returns bytes restored.
    /// </summary>
    public static long Restore(string snapshotPath, string targetPath)
    {
        if (!Directory.Exists(snapshotPath))
        {
            // Nothing was captured — make target empty (matches "nothing was there at capture time").
            if (Directory.Exists(targetPath))
            {
                Directory.Delete(targetPath, recursive: true);
            }
            return 0;
        }

        if (Directory.Exists(targetPath))
        {
            Directory.Delete(targetPath, recursive: true);
        }
        Directory.CreateDirectory(targetPath);
        return CopyRecursive(snapshotPath, targetPath, snapshotPath, exclude: null);
    }

    private static long CopyRecursive(
        string srcRoot,
        string dstRoot,
        string currentSrc,
        IReadOnlyList<string>? exclude)
    {
        long bytes = 0;
        foreach (var file in Directory.EnumerateFiles(currentSrc))
        {
            var rel = Path.GetRelativePath(srcRoot, file);
            if (IsExcluded(rel, exclude))
            {
                continue;
            }
            var dst = Path.Combine(dstRoot, rel);
            Directory.CreateDirectory(Path.GetDirectoryName(dst)!);
            try
            {
                File.Copy(file, dst, overwrite: true);
                bytes += new FileInfo(dst).Length;
            }
            catch (IOException)
            {
                // File locked or missing — best-effort.
            }
            catch (UnauthorizedAccessException)
            {
                // Permission issue — skip.
            }
        }
        foreach (var dir in Directory.EnumerateDirectories(currentSrc))
        {
            var rel = Path.GetRelativePath(srcRoot, dir);
            if (IsExcluded(rel, exclude))
            {
                continue;
            }
            bytes += CopyRecursive(srcRoot, dstRoot, dir, exclude);
        }
        return bytes;
    }

    private static bool IsExcluded(string relativePath, IReadOnlyList<string>? exclude)
    {
        if (exclude == null || exclude.Count == 0)
        {
            return false;
        }
        var norm = relativePath.Replace('\\', '/');
        foreach (var pattern in exclude)
        {
            if (norm.Contains(pattern, StringComparison.OrdinalIgnoreCase))
            {
                return true;
            }
        }
        return false;
    }
}
