/**
 * Content Analysis Schema
 * This schema defines the structure for LLM-based content analysis results
 */

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
    | "quick_read"      // < 3 minutes
    | "short"           // 3-7 minutes  
    | "medium"          // 7-15 minutes
    | "long"            // 15-30 minutes
    | "comprehensive";  // 30+ minutes

export type InteractivityLevel =
    | "static"          // No interactive elements
    | "basic"           // Simple forms/buttons
    | "interactive"     // Multiple interactive elements
    | "highly_interactive"; // Rich interactive experience

export interface ContentAnalysis {
    /** Primary classification of the content type */
    contentType: "tutorial" | "documentation" | "article" | "guide" | "reference" | "blog_post" | "news" | "product_page" | "landing_page" | "interactive_demo" | "code_example" | "api_docs" | "other";
    
    /** Technical difficulty level of the content */
    technicalLevel: "beginner" | "intermediate" | "advanced" | "expert" | "mixed";
    
    /** Estimated reading time and content depth */
    contentLength: "quick_read" | "short" | "medium" | "long" | "comprehensive";
    
    /** Level of interactive elements present */
    interactivityLevel: "static" | "basic" | "interactive" | "highly_interactive";
    
    /** Specific technologies mentioned or used (e.g., React, Python, Docker) */
    technologies: string[];
    
    /** Broad domain areas covered (e.g., web development, machine learning) */
    domains: string[];
    
    /** Specific concepts and topics discussed (e.g., authentication, state management) */
    concepts: string[];
    
    /** Whether the content contains actual programming code examples */
    hasProgrammingCode: boolean;
    
    /** Whether the content includes images, diagrams, videos, or visual aids */
    hasVisualContent: boolean;
    
    /** Whether downloadable resources are available (files, tools, etc.) */
    hasDownloadableContent: boolean;
    
    /** Whether the content requires user registration or signup to access */
    requiresSignup: boolean;
    
    /** Whether the content is designed for learning and education */
    isEducational: boolean;
    
    /** Whether the content serves as reference material or documentation */
    isReference: boolean;
    
    /** Whether the content provides practical, hands-on examples */
    isPracticalExample: boolean;
    
    /** Target audience groups (e.g., developers, beginners, data scientists) */
    targetAudience: string[];
    
    /** Single sentence describing the primary purpose of the content */
    primaryPurpose: string;
    
    /** 3-5 primary topics that are central to the content */
    mainTopics: string[];
    
    /** Additional relevant topics covered in the content */
    secondaryTopics: string[];
    
    /** Whether the content provides comprehensive coverage of its topic */
    isComprehensive: boolean;
    
    /** Whether the content appears current and up-to-date */
    isUpToDate: boolean;
    
    /** Whether the content is well-organized with clear structure */
    isWellStructured: boolean;
}