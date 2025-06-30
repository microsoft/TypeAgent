/**
 * Page Type Classification Schema
 * This schema defines the available page types for content classification
 */

/**
 * Available page types for content classification
 * These represent the most common types of web content for organizing and searching
 */
export type PageType =
    /** Step-by-step instructional content with learning objectives */
    | "tutorial"

    /** Official documentation, API docs, technical specifications */
    | "documentation"

    /** Informational or opinion pieces, news articles, blog posts */
    | "article"

    /** Comprehensive how-to content, best practices, methodologies */
    | "guide"

    /** Quick reference materials, cheat sheets, lookup tables */
    | "reference"

    /** Personal or company blog posts, informal articles */
    | "blog_post"

    /** News articles, press releases, current events */
    | "news"

    /** E-commerce pages, product descriptions, sales pages */
    | "product_page"

    /** Marketing pages, company homepages, service descriptions */
    | "landing_page"

    /** Interactive tools, demos, simulators, playgrounds */
    | "interactive_demo"

    /** Code snippets, programming examples, sample implementations */
    | "code_example"

    /** API documentation, technical reference for developers */
    | "api_docs"

    /** Fallback category for content that doesn't fit other types */
    | "other";

/**
 * Page type classification rules and examples
 */
export const PageTypeExamples = {
    tutorial: [
        "Step-by-step React tutorial",
        "How to build a REST API",
        "Learning Python from scratch",
    ],
    documentation: [
        "React official documentation",
        "Node.js API reference",
        "AWS service documentation",
    ],
    article: [
        "Tech industry analysis",
        "Opinion piece on AI ethics",
        "JavaScript best practices",
    ],
    guide: [
        "Complete guide to DevOps",
        "Security best practices",
        "Performance optimization guide",
    ],
    reference: [
        "CSS property reference",
        "HTTP status codes",
        "Git command cheat sheet",
    ],
    blog_post: [
        "Company engineering blog",
        "Personal developer blog",
        "Product announcement",
    ],
    news: [
        "Tech news article",
        "Product launch announcement",
        "Industry updates",
    ],
    product_page: [
        "SaaS product page",
        "E-commerce product listing",
        "Software tool description",
    ],
    landing_page: [
        "Company homepage",
        "Service offering page",
        "Marketing campaign page",
    ],
    interactive_demo: [
        "Code playground",
        "Interactive tutorial",
        "Live demo or simulator",
    ],
    code_example: [
        "GitHub repository",
        "Code snippet sharing",
        "Programming examples",
    ],
    api_docs: ["REST API documentation", "SDK reference", "Integration guides"],
    other: ["About pages", "Contact forms", "General web content"],
} as const;
