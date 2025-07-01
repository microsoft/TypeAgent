// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type ContentType =
    | "tutorial"
    | "documentation"
    | "article"
    | "guide"
    | "reference"
    | "blog_post"
    | "news"
    | "product_page"
    | "landing_page"
    | "interactive_demo"
    | "code_example"
    | "api_docs"
    | "other";

export type TechnicalLevel =
    | "beginner"
    | "intermediate"
    | "advanced"
    | "expert"
    | "mixed";

export type ContentLength =
    | "quick_read" // < 3 minutes
    | "short" // 3-7 minutes
    | "medium" // 7-15 minutes
    | "long" // 15-30 minutes
    | "comprehensive"; // 30+ minutes

export type InteractivityLevel =
    | "static" // No interactive elements
    | "basic" // Simple forms/buttons
    | "interactive" // Multiple interactive elements
    | "highly_interactive"; // Rich interactive experience

export interface ContentAnalysis {
    // Primary content classification
    contentType: ContentType;
    technicalLevel: TechnicalLevel;
    contentLength: ContentLength;
    interactivityLevel: InteractivityLevel;

    // Technology and domain topics
    technologies: string[]; // e.g., ["React", "TypeScript", "Node.js"]
    domains: string[]; // e.g., ["web development", "machine learning", "DevOps"]
    concepts: string[]; // e.g., ["authentication", "state management", "API design"]

    // Content characteristics
    hasProgrammingCode: boolean;
    hasVisualContent: boolean; // images, diagrams, videos
    hasDownloadableContent: boolean;
    requiresSignup: boolean;

    // Learning and reference value
    isEducational: boolean;
    isReference: boolean;
    isPracticalExample: boolean;

    // Audience and purpose
    targetAudience: string[]; // e.g., ["developers", "beginners", "React developers"]
    primaryPurpose: string; // e.g., "teach React hooks", "document API endpoints"

    // Key topics and themes (for enhanced search)
    mainTopics: string[]; // 3-5 primary topics
    secondaryTopics: string[]; // Additional relevant topics

    // Content quality indicators
    isComprehensive: boolean; // Covers topic thoroughly
    isUpToDate: boolean; // Based on mentions of recent versions/dates
    isWellStructured: boolean; // Clear headings, good organization
}
