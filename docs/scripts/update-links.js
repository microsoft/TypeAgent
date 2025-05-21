// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Normalizes file paths to use forward slashes consistently
function normalizePath(filePath) {
  return filePath ? filePath.replace(/\\/g, "/") : "";
}

/**
 * Updates links in content to point to GitHub repository
 * This relies on Eleventy's inputPath property to get the original Markdown path
 *
 * @param {string} content - The HTML content
 * @param {string} outputPath - The output HTML file path
 * @param {string} inputPath - The original Markdown file path
 * @param {string} repoUrl - The GitHub repository URL
 * @param {string} defaultBranch - The default branch name
 * @return {string} Updated content
 */
function updateLinks(
  content,
  outputPath,
  inputPath,
  repoUrl,
  defaultBranch = "main"
) {
  if (!repoUrl) {
    repoUrl = "https://github.com/microsoft/TypeAgent";
  }

  // Normalize paths
  const normalizedInputPath = normalizePath(inputPath);
  const normalizedOutputPath = normalizePath(outputPath);

  console.log(`Processing file: ${normalizedOutputPath}`);
  console.log(`Original source: ${normalizedInputPath}`);

  // Process HTML links
  const externalLinkPattern =
    /<a\s+(?:[^>]*?\s+)?href=["']([^"']+)["']([^>]*)>([^<]*)<\/a>/g;

  return content.replace(
    externalLinkPattern,
    (match, linkPath, attributes, linkText) => {
      // Normalize link path
      const normalizedLinkPath = normalizePath(linkPath);

      // Skip if the link is internal (starts with #), a web URL, or a site-relative path
      if (
        normalizedLinkPath.startsWith("#") ||
        normalizedLinkPath.startsWith("http") ||
        normalizedLinkPath.startsWith("/docs/") ||
        normalizedLinkPath.startsWith("/content/")
      ) {
        return match;
      }

      // Skip image files
      if (/\.(jpeg|jpg|gif|png|svg)$/.test(normalizedLinkPath)) {
        return match;
      }

      // Only process links that likely point outside the docs directory
      // This typically means they start with ../ or are a path without a leading /
      if (
        normalizedLinkPath.startsWith("../") ||
        (!normalizedLinkPath.startsWith("/") &&
          !normalizedLinkPath.startsWith("."))
      ) {
        try {
          // Use the original Markdown file path for resolution
          const repoPath = resolvePathFromMarkdown(
            normalizedLinkPath,
            normalizedInputPath
          );

          // Determine if this is a file or directory (assume directory if no extension)
          const isDirectory = !repoPath.includes(".");

          // Create the appropriate GitHub URL
          const githubPath = isDirectory
            ? `${repoUrl}/tree/${defaultBranch}/${repoPath}`
            : `${repoUrl}/blob/${defaultBranch}/${repoPath}`;

          console.log(
            `Replacing link: ${normalizedLinkPath} with ${githubPath}`
          );

          // Return the updated link
          return `<a href="${githubPath}"${attributes}>${linkText}</a>`;
        } catch (err) {
          console.error(
            `Error processing link ${normalizedLinkPath}: ${err.message}`
          );
          return match;
        }
      }

      return match;
    }
  );
}

/**
 * Resolves a relative path from a Markdown file to its repository path
 *
 * @param {string} relativePath - The relative path in the link
 * @param {string} markdownFilePath - The original Markdown file path
 * @returns {string} The resolved path relative to the repository root
 */
function resolvePathFromMarkdown(relativePath, markdownFilePath) {
  try {
    const lastSlashIndex = markdownFilePath.lastIndexOf("/");
    const markdownDir =
      lastSlashIndex !== -1
        ? markdownFilePath.substring(0, lastSlashIndex)
        : "";

    const markdownDirParts = markdownDir ? markdownDir.split("/") : [];
    const relativePathParts = relativePath.split("/");

    const resultParts = [...markdownDirParts];

    // Process each part of the relative path
    for (const part of relativePathParts) {
      if (part === "..") {
        // Go up one directory
        if (resultParts.length > 0) {
          resultParts.pop();
        }
      } else if (part !== ".") {
        resultParts.push(part);
      }
    }

    // Join the path
    const resolvedPath = resultParts.join("/");

    const docsIndex = resolvedPath.indexOf("/docs/");
    if (docsIndex !== -1) {
      // If the path contains /docs/, everything before that is the repo root
      const repoRoot = resolvedPath.substring(0, docsIndex);
      return resolvedPath.substring(repoRoot.length + 1); // +1 for the leading slash
    }

    return resolvedPath;
  } catch (err) {
    console.error(`Error resolving path: ${err.message}`);
    return relativePath;
  }
}

module.exports = { updateLinks, normalizePath, resolvePathFromMarkdown };
