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
    if (path.startsWith('http')|| /\.(jpeg|jpg|gif|png|svg)$/.test(path)) {
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
    
      console.log(`Replacing link: ${path} with ${githubPath}`)
    // Return the updated link
    return `[${linkText}](${githubPath})`;
  });
}

// If running in Node.js (for local development or CI)
if (isNode) {
  const fs = require('fs');
  const path = require('path');
  
  // Try to get repository URL from environment
  const repoUrl = process.env.GITHUB_REPOSITORY ? 
    `https://github.com/${process.env.GITHUB_REPOSITORY}` : 
    null;
  
  // Try to get default branch from environment
  const defaultBranch = process.env.GITHUB_DEFAULT_BRANCH || 'main';
  
  // Function to recursively process all markdown files in a directory
  function processDirectory(dir, repoUrl, defaultBranch) {
    if (!fs.existsSync(dir)) {
      console.warn(`Directory does not exist: ${dir}`);
      return;
    }
    
    const files = fs.readdirSync(dir);
    
    files.forEach(file => {
      const filePath = path.join(dir, file);
      const stat = fs.statSync(filePath);
      
      if (stat.isDirectory()) {
        // Recursively process subdirectories
        processDirectory(filePath, repoUrl, defaultBranch);
      } else if (file.endsWith('.md')) {
        // Process markdown files
        console.log(`Processing: ${filePath}`);
        const content = fs.readFileSync(filePath, 'utf8');
        const updatedContent = updateLinks(content, filePath, repoUrl, defaultBranch);
        
        // Only write if content changed
        if (content !== updatedContent) {
          fs.writeFileSync(filePath, updatedContent);
          console.log(`Updated links in: ${filePath}`);
        }
      }
    });
  }
  
  // Start processing from the docs content directory
  console.log(`Using repository URL: ${repoUrl || 'Not found - using default'}`);
  console.log(`Using default branch: ${defaultBranch}`);
  processDirectory(path.join(__dirname, '..', 'content'), repoUrl, defaultBranch);
  processDirectory(path.join(__dirname, '..', 'architecture'), repoUrl, defaultBranch);
  processDirectory(path.join(__dirname, '..', 'help'), repoUrl, defaultBranch);
  processDirectory(path.join(__dirname, '..', 'setup'), repoUrl, defaultBranch);
  processDirectory(path.join(__dirname, '..', 'tutorial'), repoUrl, defaultBranch);

  console.log('Link updating complete!');
}

// Export the function for use in Eleventy transforms
module.exports = { updateLinks };