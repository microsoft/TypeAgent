// Import the plugin at the top of the file
const markdownItReplaceLink = require('markdown-it-replace-link');

module.exports = function(eleventyConfig) {
  const pathPrefix = process.env.GITHUB_REPOSITORY ? 
    process.env.GITHUB_REPOSITORY.split('/')[1] : 
    'TypeAgent';

  // Copy static assets
  eleventyConfig.addPassthroughCopy("_includes");
  eleventyConfig.addPassthroughCopy("assets");
  eleventyConfig.addPassthroughCopy("tutorial/imgs");
  
    eleventyConfig.addShortcode("version", function() {
    return String(Date.now());
  });
  
  // Add a shortcode for the current year
  eleventyConfig.addShortcode("year", function() {
    return new Date().getFullYear();
  });
  
  let markdownIt = require("markdown-it");
  let markdownItAnchor = require("markdown-it-anchor");
  let options = {
    html: true,
    breaks: true,
    linkify: true
  };
  
  // Set up markdown-it with the plugins
  eleventyConfig.setLibrary("md", markdownIt(options)
    .use(markdownItAnchor, {
      permalink: true,
      permalinkClass: "direct-link",
      permalinkSymbol: "#"
    })
    .use(markdownItReplaceLink, {
      replaceLink: function(link, env) {
        // Only process relative image links that don't start with "/"
        if (
          link && 
          !link.startsWith('/') && 
          !link.startsWith('http') && 
          !link.startsWith('#') &&
          /\.(jpeg|jpg|gif|png|svg)$/.test(link)
        ) {
          // Get the file path from the environment
          const inputPath = env.page.inputPath;
          
          // Extract directory from the input path
          const dir = inputPath.substring(0, inputPath.lastIndexOf('/'));
          
          // For images in the same directory as the markdown file,
          // construct a path relative to the site root

          if (dir.includes('/tutorial') && link.startsWith('imgs/')) {
            return `/TypeAgent/tutorial/imgs/${link.substring(5)}`;
          }
          
          return link;
        }
        return link;
      }
    })
  );
  
  // Create a collection for documentation pages
  eleventyConfig.addCollection("docs", function(collection) {
    return collection.getFilteredByGlob("content/**/*.md").filter(item => !item.filePathStem.includes('index'));
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
      layouts: "_includes"
    },
    templateFormats: ["md", "njk", "html"],
    markdownTemplateEngine: "njk",
    htmlTemplateEngine: "njk",
    dataTemplateEngine: "njk",
    passthroughFileCopy: true,
    pathPrefix: `/${pathPrefix}/`
  };
};