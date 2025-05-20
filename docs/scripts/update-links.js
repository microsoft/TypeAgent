// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * This script updates links in markdown files that point outside the docs folder
 * to link directly to the GitHub repository
 */

// Check if this is running in a browser or Node.js environment
const isNode = typeof window === 'undefined';

/**
 * Updates links in content to point to GitHub repository
 * @param {string} content - The markdown content
 * @param {string} inputPath - The path of the input file
 * @param {string} repoUrl - The GitHub repository URL
 * @param {string} defaultBranch - The default branch name
 * @return {string} Updated content
 */
function updateLinks(content, inputPath, repoUrl, defaultBranch = 'main') {
  if (!repoUrl) {
    repoUrl = 'https://github.com/microsoft/TypeAgent';
  }
  
  // Determine if we're processing an HTML file or a Markdown file
  const isHtml = inputPath.endsWith(".html");
  
  if (isHtml) {
    // For HTML files, we need to find <a href> links that point outside
    // Process links in HTML - look for href attributes that contain ../ or don't start with http/https/#/etc.
    return processHtmlLinks(content, repoUrl, defaultBranch);
  } else {
    // Process links in Markdown
    return processMarkdownLinks(content, repoUrl, defaultBranch);
  }
}

// Function to process Markdown links
function processMarkdownLinks(content, repoUrl, defaultBranch) {
  // Pattern to match markdown links to files outside the docs directory
  // This looks for links that start with ../ or similar patterns
  const externalLinkPattern = /\[([^\]]+)\]\((?:\.\.\/|(?!https?:\/\/|\/docs\/|\/content\/|#)([^)]+))\)/g;
  
  return content.replace(externalLinkPattern, (match, linkText, linkPath) => {
    // Extract the path part of the link
    let path;
    if (linkPath) {
      // If linkPath is captured (for links that don't start with ../)
      path = linkPath;
    } else {
      // For links that start with ../
      const pathMatch = match.match(/\(([^)]+)\)/);
      if (pathMatch) {
        path = pathMatch[1];
      } else {
        // If we can't parse the path, return the original link
        return match;
      }
    }
    
    // Skip if the link is already an absolute URL or is an image
    if (path.startsWith('http') || /\.(jpeg|jpg|gif|png|svg)$/.test(path)) {
      return match;
    }
    
    // Normalize path by removing ../ prefix
    let normalizedPath = path.replace(/^\.\.\//, '');
    if(normalizedPath.startsWith("../")){
        normalizedPath = normalizedPath.replace(/^\.\.\//, '');
    }
    
    // Determine if this is a file or directory (assume directory if no extension)
    const isDirectory = !normalizedPath.includes('.');
    
    // Create the appropriate GitHub URL
    const githubPath = isDirectory ? 
      `${repoUrl}/tree/${defaultBranch}/${normalizedPath}` : 
      `${repoUrl}/blob/${defaultBranch}/${normalizedPath}`;
    
    console.log(`Replacing markdown link: ${path} with ${githubPath}`);
    // Return the updated link
    return `[${linkText}](${githubPath})`;
  });
}

// Function to process HTML links
function processHtmlLinks(content, repoUrl, defaultBranch) {
  // Pattern to match <a href> links that point outside the docs directory
  const externalLinkPattern = /<a\s+(?:[^>]*?\s+)?href=["'](?:\.\.\/|(?!https?:\/\/|\/docs\/|\/content\/|#)([^"']+))["']([^>]*)>([^<]*)<\/a>/g;
  
  return content.replace(externalLinkPattern, (match, linkPath, attributes, linkText) => {
    // If we couldn't extract the link path, try to get it from the match
    if (!linkPath) {
      const hrefMatch = match.match(/href=["']([^"']+)["']/);
      if (hrefMatch) {
        linkPath = hrefMatch[1];
      } else {
        // If we can't parse the path, return the original link
        return match;
      }
    }
    
    // Skip if the link is already an absolute URL or is an image
    if (linkPath.startsWith('http') || linkPath.startsWith('/TypeAgent/') || /\.(jpeg|jpg|gif|png|svg)$/.test(linkPath)) {
      return match;
    }
    
    // Normalize path by removing ../ prefix
    let normalizedPath = linkPath.replace(/^\.\.\//, '');
    if(normalizedPath.startsWith("../")){
        normalizedPath = normalizedPath.replace(/^\.\.\//, '');
    }
    
    // Determine if this is a file or directory (assume directory if no extension)
    const isDirectory = !normalizedPath.includes('.');
    
    // Create the appropriate GitHub URL
    const githubPath = isDirectory ? 
      `${repoUrl}/tree/${defaultBranch}/${normalizedPath}` : 
      `${repoUrl}/blob/${defaultBranch}/${normalizedPath}`;
    
    console.log(`Replacing HTML link: ${linkPath} with ${githubPath}`);
    // Return the updated link
    return `<a href="${githubPath}"${attributes}>${linkText}</a>`;
  });
}

// ONLY export the functions for use in Eleventy transforms
module.exports = { 
  updateLinks,
  processMarkdownLinks,
  processHtmlLinks
};