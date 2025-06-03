// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

const markdownItReplaceLink = require("markdown-it-replace-link");

module.exports = function (eleventyConfig) {
  const pathPrefix = process.env.GITHUB_REPOSITORY
    ? process.env.GITHUB_REPOSITORY.split("/")[1]
    : "TypeAgent";

  // Copy static assets
  eleventyConfig.addPassthroughCopy("_includes");
  eleventyConfig.addPassthroughCopy("assets");
  eleventyConfig.addPassthroughCopy("content/imgs");
  eleventyConfig.addPassthroughCopy("content/tutorial/imgs");

  eleventyConfig.addShortcode("version", function () {
    return String(Date.now());
  });

  // Add a shortcode for the current year
  eleventyConfig.addShortcode("year", function () {
    return new Date().getFullYear();
  });

  let markdownIt = require("markdown-it");
  let markdownItAnchor = require("markdown-it-anchor");
  let options = {
    html: true,
    breaks: true,
    linkify: true,
  };

  // Add a shortcode for repository links
  eleventyConfig.addShortcode("repo", function (path, text) {
    const repoUrl = process.env.GITHUB_REPOSITORY
      ? `https://github.com/${process.env.GITHUB_REPOSITORY}`
      : this.ctx?.site?.github || "https://github.com/microsoft/TypeAgent";

    const defaultBranch = process.env.GITHUB_DEFAULT_BRANCH || "main";

    const normalizedPath = path.replace(/^\.\.\/|^\//g, "");

    // Determine the correct GitHub URL based on whether it's a file or directory
    const isDirectory = !normalizedPath.includes(".");
    const githubUrl = isDirectory
      ? `${repoUrl}/tree/${defaultBranch}/${normalizedPath}`
      : `${repoUrl}/blob/${defaultBranch}/${normalizedPath}`;

    // Return markdown link
    return `[${text || normalizedPath}](${githubUrl})`;
  });

  // Add debugging shortcode to show the current URL
  eleventyConfig.addShortcode("debugUrl", function () {
    return `
      <div style="background: #f8d7da; padding: 10px; margin: 10px 0; border: 1px solid #f5c6cb;">
        <p><strong>Debug Path Information:</strong></p>
        <p>Path Prefix: ${pathPrefix}</p>
        <p>Full Base URL: ${this.page ? this.page.url : "No page context"}</p>
      </div>
    `;
  });

  // Set up markdown-it with the plugins
  eleventyConfig.setLibrary(
    "md",
    markdownIt(options)
      .use(markdownItAnchor, {
        permalink: true,
        permalinkClass: "direct-link",
        permalinkSymbol: "#",
      })
      .use(markdownItReplaceLink, {
        replaceLink: function (link, env) {
          // Only process relative image links that don't start with "/"
          if (
            link &&
            !link.startsWith("/") &&
            !link.startsWith("http") &&
            !link.startsWith("#") &&
            /\.(jpeg|jpg|gif|png|svg)$/.test(link)
          ) {
            // Get the file path from the environment
            const inputPath = env.page.inputPath;

            // Extract directory from the input path
            const dir = inputPath.substring(0, inputPath.lastIndexOf("/"));

            // For images in the same directory as the markdown file,
            // construct a path relative to the site root

            if (dir.includes("/tutorial") && link.startsWith("imgs/")) {
              return `/TypeAgent/content/tutorial/imgs/${link.substring(5)}`;
            }

            if (dir.includes("/content")) {
              const index = link.indexOf("imgs/");
              return `/TypeAgent/content/imgs/${link.substring(index + 5)}`;
            }

            return link;
          }
          return link;
        },
      })
  );

  // Create a collection for documentation pages
  eleventyConfig.addCollection("docs", function (collection) {
    return collection
      .getFilteredByGlob("content/**/*.md")
      .filter((item) => !item.filePathStem.includes("index"));
  });

  // Store a map of input paths to output paths
  const pageMap = new Map();
  eleventyConfig.addTransform("recordPaths", function (content, outputPath) {
    const inputPath = this.inputPath;

    if (inputPath && outputPath) {
      pageMap.set(outputPath, inputPath);
    }

    return content;
  });

  const { updateLinks } = require("./scripts/update-links");

  eleventyConfig.addTransform("updateLinks", function (content, outputPath) {
    if (!outputPath || !outputPath.endsWith(".html")) {
      return content; // Only process HTML files
    }

    // Get the original input path for this file
    const inputPath = pageMap.get(outputPath) || this.inputPath;

    if (!inputPath) {
      console.warn(
        `No input path found for ${outputPath}, skipping link transformation`
      );
      return content;
    }

    const repoUrl = process.env.GITHUB_REPOSITORY
      ? `https://github.com/${process.env.GITHUB_REPOSITORY}`
      : this.ctx?.site?.github || "https://github.com/microsoft/TypeAgent";

    const defaultBranch = process.env.GITHUB_DEFAULT_BRANCH || "main";

    console.log(`Transforming links in: ${outputPath} (from ${inputPath})`);
    return updateLinks(content, outputPath, inputPath, repoUrl, defaultBranch);
  });

  // Add a filter for GitHub repository URLs
  eleventyConfig.addFilter("githubUrl", function (path, isDirectory = false) {
    const repoUrl = process.env.GITHUB_REPOSITORY
      ? `https://github.com/${process.env.GITHUB_REPOSITORY}`
      : this.ctx?.site?.github || "https://github.com/microsoft/TypeAgent";

    const defaultBranch = process.env.GITHUB_DEFAULT_BRANCH || "main";

    const normalizedPath = path.replace(/^\.\.\/|^\//g, "");

    return isDirectory
      ? `${repoUrl}/tree/${defaultBranch}/${normalizedPath}`
      : `${repoUrl}/blob/${defaultBranch}/${normalizedPath}`;
  });

  return {
    dir: {
      // Input directory is the current directory (docs folder)
      input: ".",
      // Output to a _site subdirectory within docs
      output: "_site",
      // Layouts are in _includes
      includes: "_includes",
      // Data files are in _data
      data: "_data",
      // Content files are in the content directory
      layouts: "_includes",
    },
    templateFormats: ["md", "njk", "html"],
    markdownTemplateEngine: "njk",
    htmlTemplateEngine: "njk",
    dataTemplateEngine: "njk",
    passthroughFileCopy: true,
    pathPrefix: `/${pathPrefix}/`,
  };
};
