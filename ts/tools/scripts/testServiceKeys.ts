#!/usr/bin/env npx ts-node

// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Service Keys Verification Tool for TypeAgent
 *
 * This script tests the service keys configured in the .env file.
 * It validates each service separately and provides helpful error messages
 * with expected formats for missing or invalid keys.
 *
 * Usage:
 *   npx ts-node tools/scripts/testServiceKeys.ts
 *   OR
 *   npm run test:keys
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import { DefaultAzureCredential } from "@azure/identity";

// Load .env file from the ts directory
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const envPath = path.resolve(__dirname, "../../.env");

if (fs.existsSync(envPath)) {
    dotenv.config({ path: envPath });
    console.log(`✓ Loaded .env file from: ${envPath}\n`);
} else {
    console.log(`⚠ No .env file found at: ${envPath}`);
    console.log("  Create a .env file with your service keys.\n");
}

// ============================================================================
// Service Key Definitions
// ============================================================================

interface ServiceKeyConfig {
    name: string;
    description: string;
    requiredKeys: string[];
    optionalKeys?: string[];
    expectedFormats: Record<string, string>;
    testFunction?: () => Promise<TestResult>;
}

interface TestResult {
    success: boolean;
    message: string;
    details?: string;
}

// Color helpers for console output
const colors = {
    reset: "\x1b[0m",
    bright: "\x1b[1m",
    red: "\x1b[31m",
    green: "\x1b[32m",
    yellow: "\x1b[33m",
    blue: "\x1b[34m",
    cyan: "\x1b[36m",
    gray: "\x1b[90m",
};

function printSuccess(msg: string) {
    console.log(`${colors.green}✓${colors.reset} ${msg}`);
}

function printWarning(msg: string) {
    console.log(`${colors.yellow}⚠${colors.reset} ${msg}`);
}

function printError(msg: string) {
    console.log(`${colors.red}✗${colors.reset} ${msg}`);
}

function printInfo(msg: string) {
    console.log(`${colors.blue}ℹ${colors.reset} ${msg}`);
}

function printHeader(msg: string) {
    console.log(`\n${colors.bright}${colors.cyan}━━━ ${msg} ━━━${colors.reset}`);
}

// ============================================================================
// Service Configurations
// ============================================================================

const serviceConfigs: ServiceKeyConfig[] = [
    // Azure OpenAI - Chat Model
    {
        name: "Azure OpenAI (Chat)",
        description: "LLM for request translation (GPT-4 or equivalent)",
        requiredKeys: ["AZURE_OPENAI_API_KEY", "AZURE_OPENAI_ENDPOINT"],
        optionalKeys: ["AZURE_OPENAI_RESPONSE_FORMAT"],
        expectedFormats: {
            AZURE_OPENAI_API_KEY:
                "<32-character hex string> or 'identity' for keyless access",
            AZURE_OPENAI_ENDPOINT:
                "https://<resource-name>.openai.azure.com/openai/deployments/<deployment-name>/chat/completions?api-version=2024-02-01",
            AZURE_OPENAI_RESPONSE_FORMAT: "1 (to enable JSON response format)",
        },
        testFunction: testAzureOpenAIChat,
    },

    // Azure OpenAI - Embeddings
    {
        name: "Azure OpenAI (Embeddings)",
        description: "Text embeddings for conversation memory and fuzzy matching",
        requiredKeys: [
            "AZURE_OPENAI_API_KEY_EMBEDDING",
            "AZURE_OPENAI_ENDPOINT_EMBEDDING",
        ],
        expectedFormats: {
            AZURE_OPENAI_API_KEY_EMBEDDING:
                "<32-character hex string> or 'identity' for keyless access",
            AZURE_OPENAI_ENDPOINT_EMBEDDING:
                "https://<resource-name>.openai.azure.com/openai/deployments/<embedding-deployment>/embeddings?api-version=2024-02-01",
        },
        testFunction: testAzureOpenAIEmbeddings,
    },

    // OpenAI - Chat Model
    {
        name: "OpenAI (Chat)",
        description: "Alternative to Azure OpenAI for request translation",
        requiredKeys: ["OPENAI_API_KEY", "OPENAI_ENDPOINT"],
        optionalKeys: [
            "OPENAI_ORGANIZATION",
            "OPENAI_MODEL",
            "OPENAI_RESPONSE_FORMAT",
        ],
        expectedFormats: {
            OPENAI_API_KEY: "sk-<alphanumeric string>",
            OPENAI_ENDPOINT: "https://api.openai.com/v1/chat/completions",
            OPENAI_ORGANIZATION: "org-<alphanumeric string>",
            OPENAI_MODEL: "gpt-4o, gpt-4-turbo, gpt-3.5-turbo, etc.",
            OPENAI_RESPONSE_FORMAT: "1 (to enable JSON response format)",
        },
        testFunction: testOpenAIChat,
    },

    // OpenAI - Embeddings
    {
        name: "OpenAI (Embeddings)",
        description: "Alternative to Azure OpenAI for text embeddings",
        requiredKeys: ["OPENAI_ENDPOINT_EMBEDDING", "OPENAI_MODEL_EMBEDDING"],
        optionalKeys: ["OPENAI_API_KEY_EMBEDDING"],
        expectedFormats: {
            OPENAI_ENDPOINT_EMBEDDING: "https://api.openai.com/v1/embeddings",
            OPENAI_MODEL_EMBEDDING: "text-embedding-ada-002, text-embedding-3-small, etc.",
            OPENAI_API_KEY_EMBEDDING:
                "sk-<alphanumeric string> (optional if OPENAI_API_KEY is set)",
        },
        testFunction: testOpenAIEmbeddings,
    },

    // Azure OpenAI - GPT-3.5 Turbo
    {
        name: "Azure OpenAI (GPT-3.5 Turbo)",
        description: "Fast chat response and email content generation",
        requiredKeys: [
            "AZURE_OPENAI_API_KEY_GPT_35_TURBO",
            "AZURE_OPENAI_ENDPOINT_GPT_35_TURBO",
        ],
        expectedFormats: {
            AZURE_OPENAI_API_KEY_GPT_35_TURBO:
                "<32-character hex string> or 'identity' for keyless access",
            AZURE_OPENAI_ENDPOINT_GPT_35_TURBO:
                "https://<resource-name>.openai.azure.com/openai/deployments/<gpt-35-turbo-deployment>/chat/completions?api-version=2024-02-01",
        },
        testFunction: () => testAzureOpenAIEndpoint("GPT_35_TURBO"),
    },

    // Azure OpenAI - GPT-4o
    {
        name: "Azure OpenAI (GPT-4o)",
        description: "Browser - Crossword Page functionality",
        requiredKeys: [
            "AZURE_OPENAI_API_KEY_GPT_4_O",
            "AZURE_OPENAI_ENDPOINT_GPT_4_O",
        ],
        expectedFormats: {
            AZURE_OPENAI_API_KEY_GPT_4_O:
                "<32-character hex string> or 'identity' for keyless access",
            AZURE_OPENAI_ENDPOINT_GPT_4_O:
                "https://<resource-name>.openai.azure.com/openai/deployments/<gpt-4o-deployment>/chat/completions?api-version=2024-02-01",
        },
        testFunction: () => testAzureOpenAIEndpoint("GPT_4_O"),
    },

    // Speech SDK
    {
        name: "Azure Speech SDK",
        description: "Voice input for TypeAgent Shell",
        requiredKeys: ["SPEECH_SDK_KEY", "SPEECH_SDK_ENDPOINT", "SPEECH_SDK_REGION"],
        expectedFormats: {
            SPEECH_SDK_KEY: "<32-character hex string>",
            SPEECH_SDK_ENDPOINT:
                "https://<region>.api.cognitive.microsoft.com/sts/v1.0/issuetoken",
            SPEECH_SDK_REGION: "eastus, westus2, westeurope, etc.",
        },
        testFunction: testSpeechSDK,
    },

    // Bing with Grounding
    {
        name: "Grounding with Bing",
        description: "Internet lookups for chat",
        requiredKeys: [
            "BING_WITH_GROUNDING_ENDPOINT",
            "BING_WITH_GROUNDING_AGENT_ID",
        ],
        expectedFormats: {
            BING_WITH_GROUNDING_ENDPOINT:
                "https://<resource-name>.services.ai.azure.com/agents",
            BING_WITH_GROUNDING_AGENT_ID: "<GUID format: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx>",
        },
        testFunction: testBingGrounding,
    },

    // Microsoft Graph
    {
        name: "Microsoft Graph",
        description: "Calendar and Email integration",
        requiredKeys: [
            "MSGRAPH_APP_CLIENTID",
            "MSGRAPH_APP_CLIENTSECRET",
            "MSGRAPH_APP_TENANTID",
        ],
        expectedFormats: {
            MSGRAPH_APP_CLIENTID: "<GUID format: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx>",
            MSGRAPH_APP_CLIENTSECRET: "<client secret string from Azure AD>",
            MSGRAPH_APP_TENANTID: "<GUID format: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx>",
        },
        testFunction: testMicrosoftGraph,
    },

    // Spotify
    {
        name: "Spotify Web API",
        description: "Music player integration",
        requiredKeys: ["SPOTIFY_APP_CLI", "SPOTIFY_APP_CLISEC"],
        optionalKeys: ["SPOTIFY_APP_PORT"],
        expectedFormats: {
            SPOTIFY_APP_CLI: "<Spotify Client ID: 32-character alphanumeric string>",
            SPOTIFY_APP_CLISEC: "<Spotify Client Secret: 32-character alphanumeric string>",
            SPOTIFY_APP_PORT: "8888 (default redirect port)",
        },
        testFunction: testSpotify,
    },

    // Azure Maps
    {
        name: "Azure Maps",
        description: "Geolocation services",
        requiredKeys: ["AZURE_MAPS_ENDPOINT", "AZURE_MAPS_CLIENTID"],
        expectedFormats: {
            AZURE_MAPS_ENDPOINT: "https://atlas.microsoft.com",
            AZURE_MAPS_CLIENTID: "<GUID format: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx>",
        },
    },

    // Azure Storage
    {
        name: "Azure Storage",
        description: "Blob storage for caching",
        requiredKeys: ["AZURE_STORAGE_ACCOUNT", "AZURE_STORAGE_CONTAINER"],
        expectedFormats: {
            AZURE_STORAGE_ACCOUNT: "<storage account name>",
            AZURE_STORAGE_CONTAINER: "<container name>",
        },
    },

    // MongoDB
    {
        name: "MongoDB",
        description: "Logging and telemetry storage",
        requiredKeys: ["MONGODB_CONNECTION_STRING"],
        expectedFormats: {
            MONGODB_CONNECTION_STRING:
                "mongodb+srv://<username>:<password>@<cluster>.mongodb.net/<database>",
        },
    },

    // Ollama (Local LLM)
    {
        name: "Ollama",
        description: "Local LLM via Ollama",
        requiredKeys: [],
        optionalKeys: ["OLLAMA_ENDPOINT"],
        expectedFormats: {
            OLLAMA_ENDPOINT: "http://localhost:11434 (default)",
        },
        testFunction: testOllama,
    },
];

// ============================================================================
// Test Functions
// ============================================================================

// Helper function to get Azure access token for keyless access
async function getAzureAccessToken(): Promise<string | null> {
    try {
        const credential = new DefaultAzureCredential();
        const tokenResponse = await credential.getToken(
            "https://cognitiveservices.azure.com/.default",
        );
        return tokenResponse?.token || null;
    } catch (error: any) {
        return null;
    }
}

async function testAzureOpenAIChat(): Promise<TestResult> {
    const apiKey = process.env.AZURE_OPENAI_API_KEY;
    const endpoint = process.env.AZURE_OPENAI_ENDPOINT;

    if (!apiKey || !endpoint) {
        return { success: false, message: "Missing required keys" };
    }

    // Validate endpoint format
    if (!endpoint.includes("openai.azure.com") && apiKey.toLowerCase() !== "identity") {
        return {
            success: false,
            message: "Invalid endpoint format",
            details:
                "Endpoint should contain 'openai.azure.com' for Azure OpenAI service",
        };
    }

    try {
        let headers: Record<string, string>;
        
        if (apiKey.toLowerCase() === "identity") {
            const token = await getAzureAccessToken();
            if (!token) {
                return {
                    success: false,
                    message: "Failed to get Azure access token for keyless access",
                    details: "Make sure you are logged in with 'az login' and have access to the resource",
                };
            }
            headers = { Authorization: `Bearer ${token}` };
        } else {
            headers = { "api-key": apiKey };
        }

        const response = await fetch(endpoint, {
            method: "POST",
            headers: {
                ...headers,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                messages: [{ role: "user", content: "Say 'test'" }],
                max_tokens: 5,
            }),
        });

        if (response.ok) {
            const data = await response.json();
            return {
                success: true,
                message: "Successfully connected to Azure OpenAI Chat" + (apiKey.toLowerCase() === "identity" ? " (keyless)" : ""),
                details: `Response received with ${data.usage?.total_tokens || "unknown"} tokens`,
            };
        } else {
            const errorText = await response.text();
            return {
                success: false,
                message: `API returned status ${response.status}`,
                details: errorText.substring(0, 200),
            };
        }
    } catch (error: any) {
        return {
            success: false,
            message: "Connection failed",
            details: error.message,
        };
    }
}

async function testAzureOpenAIEmbeddings(): Promise<TestResult> {
    const apiKey = process.env.AZURE_OPENAI_API_KEY_EMBEDDING;
    const endpoint = process.env.AZURE_OPENAI_ENDPOINT_EMBEDDING;

    if (!apiKey || !endpoint) {
        return { success: false, message: "Missing required keys" };
    }

    try {
        let headers: Record<string, string>;
        
        if (apiKey.toLowerCase() === "identity") {
            const token = await getAzureAccessToken();
            if (!token) {
                return {
                    success: false,
                    message: "Failed to get Azure access token for keyless access",
                    details: "Make sure you are logged in with 'az login' and have access to the resource",
                };
            }
            headers = { Authorization: `Bearer ${token}` };
        } else {
            headers = { "api-key": apiKey };
        }

        const response = await fetch(endpoint, {
            method: "POST",
            headers: {
                ...headers,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                input: "test embedding",
            }),
        });

        if (response.ok) {
            const data = await response.json();
            const embedding = data.data?.[0]?.embedding;
            return {
                success: true,
                message: "Successfully generated embeddings",
                details: `Embedding dimension: ${embedding?.length || "unknown"}`,
            };
        } else {
            const errorText = await response.text();
            return {
                success: false,
                message: `API returned status ${response.status}`,
                details: errorText.substring(0, 200),
            };
        }
    } catch (error: any) {
        return {
            success: false,
            message: "Connection failed",
            details: error.message,
        };
    }
}

async function testOpenAIChat(): Promise<TestResult> {
    const apiKey = process.env.OPENAI_API_KEY;
    const endpoint = process.env.OPENAI_ENDPOINT;
    const org = process.env.OPENAI_ORGANIZATION;
    const model = process.env.OPENAI_MODEL || "gpt-4o";

    if (!apiKey || !endpoint) {
        return { success: false, message: "Missing required keys" };
    }

    try {
        const headers: Record<string, string> = {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
        };
        if (org) {
            headers["OpenAI-Organization"] = org;
        }

        const response = await fetch(endpoint, {
            method: "POST",
            headers,
            body: JSON.stringify({
                model,
                messages: [{ role: "user", content: "Say 'test'" }],
                max_tokens: 5,
            }),
        });

        if (response.ok) {
            const data = await response.json();
            return {
                success: true,
                message: "Successfully connected to OpenAI Chat",
                details: `Model: ${model}, Tokens used: ${data.usage?.total_tokens || "unknown"}`,
            };
        } else {
            const errorText = await response.text();
            return {
                success: false,
                message: `API returned status ${response.status}`,
                details: errorText.substring(0, 200),
            };
        }
    } catch (error: any) {
        return {
            success: false,
            message: "Connection failed",
            details: error.message,
        };
    }
}

async function testOpenAIEmbeddings(): Promise<TestResult> {
    const apiKey =
        process.env.OPENAI_API_KEY_EMBEDDING || process.env.OPENAI_API_KEY;
    const endpoint = process.env.OPENAI_ENDPOINT_EMBEDDING;
    const model = process.env.OPENAI_MODEL_EMBEDDING || "text-embedding-ada-002";

    if (!apiKey || !endpoint) {
        return { success: false, message: "Missing required keys" };
    }

    try {
        const response = await fetch(endpoint, {
            method: "POST",
            headers: {
                Authorization: `Bearer ${apiKey}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                model,
                input: "test embedding",
            }),
        });

        if (response.ok) {
            const data = await response.json();
            const embedding = data.data?.[0]?.embedding;
            return {
                success: true,
                message: "Successfully generated embeddings",
                details: `Model: ${model}, Dimension: ${embedding?.length || "unknown"}`,
            };
        } else {
            const errorText = await response.text();
            return {
                success: false,
                message: `API returned status ${response.status}`,
                details: errorText.substring(0, 200),
            };
        }
    } catch (error: any) {
        return {
            success: false,
            message: "Connection failed",
            details: error.message,
        };
    }
}

async function testAzureOpenAIEndpoint(
    endpointSuffix: string,
): Promise<TestResult> {
    const apiKey = process.env[`AZURE_OPENAI_API_KEY_${endpointSuffix}`];
    const endpoint = process.env[`AZURE_OPENAI_ENDPOINT_${endpointSuffix}`];

    if (!apiKey || !endpoint) {
        return { success: false, message: "Missing required keys" };
    }

    try {
        let headers: Record<string, string>;
        
        if (apiKey.toLowerCase() === "identity") {
            const token = await getAzureAccessToken();
            if (!token) {
                return {
                    success: false,
                    message: "Failed to get Azure access token for keyless access",
                    details: "Make sure you are logged in with 'az login' and have access to the resource",
                };
            }
            headers = { Authorization: `Bearer ${token}` };
        } else {
            headers = { "api-key": apiKey };
        }

        const response = await fetch(endpoint, {
            method: "POST",
            headers: {
                ...headers,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                messages: [{ role: "user", content: "Say 'test'" }],
                max_tokens: 5,
            }),
        });

        if (response.ok) {
            const data = await response.json();
            return {
                success: true,
                message: `Successfully connected to Azure OpenAI (${endpointSuffix})` + (apiKey.toLowerCase() === "identity" ? " (keyless)" : ""),
                details: `Tokens used: ${data.usage?.total_tokens || "unknown"}`,
            };
        } else {
            const errorText = await response.text();
            return {
                success: false,
                message: `API returned status ${response.status}`,
                details: errorText.substring(0, 200),
            };
        }
    } catch (error: any) {
        return {
            success: false,
            message: "Connection failed",
            details: error.message,
        };
    }
}

async function testSpeechSDK(): Promise<TestResult> {
    const key = process.env.SPEECH_SDK_KEY;
    const endpoint = process.env.SPEECH_SDK_ENDPOINT;
    const region = process.env.SPEECH_SDK_REGION;

    if (!key || !region) {
        return { success: false, message: "Missing required keys" };
    }

    // Validate region format
    const validRegions = [
        "eastus",
        "eastus2",
        "westus",
        "westus2",
        "westeurope",
        "northeurope",
        "southeastasia",
    ];
    if (
        !validRegions.some((r) => region.toLowerCase().includes(r)) &&
        region.length > 20
    ) {
        return {
            success: false,
            message: "Invalid region format",
            details: `Region should be a valid Azure region code (e.g., eastus, westus2, westeurope)`,
        };
    }

    try {
        // Test token endpoint
        const tokenEndpoint =
            endpoint ||
            `https://${region}.api.cognitive.microsoft.com/sts/v1.0/issuetoken`;
        const response = await fetch(tokenEndpoint, {
            method: "POST",
            headers: {
                "Ocp-Apim-Subscription-Key": key,
                "Content-Type": "application/x-www-form-urlencoded",
            },
        });

        if (response.ok) {
            return {
                success: true,
                message: "Successfully authenticated with Speech SDK",
                details: `Region: ${region}`,
            };
        } else {
            return {
                success: false,
                message: `Authentication failed with status ${response.status}`,
                details: await response.text(),
            };
        }
    } catch (error: any) {
        return {
            success: false,
            message: "Connection failed",
            details: error.message,
        };
    }
}

async function testBingGrounding(): Promise<TestResult> {
    const endpoint = process.env.BING_WITH_GROUNDING_ENDPOINT;
    const agentId = process.env.BING_WITH_GROUNDING_AGENT_ID;

    if (!endpoint || !agentId) {
        return { success: false, message: "Missing required keys" };
    }

    // Validate GUID format
    const guidRegex =
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!guidRegex.test(agentId)) {
        return {
            success: false,
            message: "Invalid Agent ID format",
            details:
                "Agent ID should be a GUID (xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx)",
        };
    }

    return {
        success: true,
        message: "Bing Grounding configuration looks valid",
        details: `Endpoint: ${endpoint.substring(0, 50)}...`,
    };
}

async function testMicrosoftGraph(): Promise<TestResult> {
    const clientId = process.env.MSGRAPH_APP_CLIENTID;
    const clientSecret = process.env.MSGRAPH_APP_CLIENTSECRET;
    const tenantId = process.env.MSGRAPH_APP_TENANTID;

    if (!clientId || !clientSecret || !tenantId) {
        return { success: false, message: "Missing required keys" };
    }

    // Validate GUID formats
    const guidRegex =
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!guidRegex.test(clientId)) {
        return {
            success: false,
            message: "Invalid Client ID format",
            details: "Client ID should be a GUID",
        };
    }
    if (!guidRegex.test(tenantId)) {
        return {
            success: false,
            message: "Invalid Tenant ID format",
            details: "Tenant ID should be a GUID",
        };
    }

    try {
        // Try to get an access token
        const tokenUrl = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`;
        const response = await fetch(tokenUrl, {
            method: "POST",
            headers: {
                "Content-Type": "application/x-www-form-urlencoded",
            },
            body: new URLSearchParams({
                client_id: clientId,
                client_secret: clientSecret,
                scope: "https://graph.microsoft.com/.default",
                grant_type: "client_credentials",
            }),
        });

        if (response.ok) {
            return {
                success: true,
                message: "Successfully authenticated with Microsoft Graph",
                details: "Client credentials flow successful",
            };
        } else {
            const errorText = await response.text();
            return {
                success: false,
                message: `Authentication failed with status ${response.status}`,
                details: errorText.substring(0, 200),
            };
        }
    } catch (error: any) {
        return {
            success: false,
            message: "Connection failed",
            details: error.message,
        };
    }
}

async function testSpotify(): Promise<TestResult> {
    const clientId = process.env.SPOTIFY_APP_CLI;
    const clientSecret = process.env.SPOTIFY_APP_CLISEC;

    if (!clientId || !clientSecret) {
        return { success: false, message: "Missing required keys" };
    }

    // Validate format (32-character alphanumeric)
    const spotifyIdRegex = /^[a-zA-Z0-9]{32}$/;
    if (!spotifyIdRegex.test(clientId)) {
        return {
            success: false,
            message: "Invalid Client ID format",
            details: "Spotify Client ID should be a 32-character alphanumeric string",
        };
    }

    try {
        // Try to get an access token using client credentials
        const response = await fetch("https://accounts.spotify.com/api/token", {
            method: "POST",
            headers: {
                "Content-Type": "application/x-www-form-urlencoded",
                Authorization:
                    "Basic " +
                    Buffer.from(`${clientId}:${clientSecret}`).toString("base64"),
            },
            body: "grant_type=client_credentials",
        });

        if (response.ok) {
            return {
                success: true,
                message: "Successfully authenticated with Spotify",
                details: "Client credentials flow successful",
            };
        } else {
            const errorText = await response.text();
            return {
                success: false,
                message: `Authentication failed with status ${response.status}`,
                details: errorText.substring(0, 200),
            };
        }
    } catch (error: any) {
        return {
            success: false,
            message: "Connection failed",
            details: error.message,
        };
    }
}

async function testOllama(): Promise<TestResult> {
    const endpoint = process.env.OLLAMA_ENDPOINT || "http://localhost:11434";

    try {
        const response = await fetch(`${endpoint}/api/tags`, {
            method: "GET",
        });

        if (response.ok) {
            const data = await response.json();
            const models = data.models?.map((m: any) => m.name) || [];
            return {
                success: true,
                message: "Ollama is running",
                details:
                    models.length > 0
                        ? `Available models: ${models.slice(0, 3).join(", ")}${models.length > 3 ? "..." : ""}`
                        : "No models installed",
            };
        } else {
            return {
                success: false,
                message: `Ollama returned status ${response.status}`,
            };
        }
    } catch (error: any) {
        return {
            success: false,
            message: "Ollama not running or not accessible",
            details: `Tried: ${endpoint}`,
        };
    }
}

// ============================================================================
// Main Test Runner
// ============================================================================

function hasRequiredKeys(config: ServiceKeyConfig): boolean {
    return config.requiredKeys.every((key) => {
        const value = process.env[key];
        return value !== undefined && value.trim().length > 0;
    });
}

function getMissingKeys(config: ServiceKeyConfig): string[] {
    return config.requiredKeys.filter((key) => {
        const value = process.env[key];
        return value === undefined || value.trim().length === 0;
    });
}

function printKeyExample(keyName: string, format: string) {
    console.log(`    ${colors.gray}${keyName}=${format}${colors.reset}`);
}

async function runTests() {
    console.log(
        `${colors.bright}TypeAgent Service Keys Verification${colors.reset}`,
    );
    console.log("=".repeat(50));

    let testedCount = 0;
    let passedCount = 0;
    let skippedCount = 0;
    let failedCount = 0;

    for (const config of serviceConfigs) {
        printHeader(config.name);
        console.log(`${colors.gray}${config.description}${colors.reset}\n`);

        if (!hasRequiredKeys(config)) {
            const missingKeys = getMissingKeys(config);
            printWarning(
                `Skipped - Missing required keys: ${missingKeys.join(", ")}`,
            );
            console.log("\n  Add the following to your .env file:");
            for (const key of missingKeys) {
                printKeyExample(key, config.expectedFormats[key] || "<value>");
            }
            skippedCount++;
            continue;
        }

        // Print which keys are being tested (key names only, not values)
        console.log("  Keys found:");
        for (const key of config.requiredKeys) {
            console.log(`    ${colors.green}✓${colors.reset} ${key}`);
        }
        if (config.optionalKeys) {
            for (const key of config.optionalKeys) {
                if (process.env[key]) {
                    console.log(`    ${colors.green}✓${colors.reset} ${key} (optional)`);
                }
            }
        }
        console.log();

        if (config.testFunction) {
            testedCount++;
            try {
                const result = await config.testFunction();
                if (result.success) {
                    printSuccess(result.message);
                    if (result.details) {
                        console.log(`    ${colors.gray}${result.details}${colors.reset}`);
                    }
                    passedCount++;
                } else {
                    printError(result.message);
                    if (result.details) {
                        console.log(`    ${colors.gray}${result.details}${colors.reset}`);
                    }
                    console.log("\n  Expected key formats:");
                    for (const [key, format] of Object.entries(
                        config.expectedFormats,
                    )) {
                        printKeyExample(key, format);
                    }
                    failedCount++;
                }
            } catch (error: any) {
                printError(`Test threw an exception: ${error.message}`);
                console.log("\n  Expected key formats:");
                for (const [key, format] of Object.entries(config.expectedFormats)) {
                    printKeyExample(key, format);
                }
                failedCount++;
            }
        } else {
            printInfo("Configuration present (no live test available)");
            testedCount++;
            passedCount++;
        }
    }

    // Summary
    printHeader("Summary");
    console.log(`  Total services: ${serviceConfigs.length}`);
    console.log(`  ${colors.green}Passed:${colors.reset}  ${passedCount}`);
    console.log(`  ${colors.red}Failed:${colors.reset}  ${failedCount}`);
    console.log(`  ${colors.yellow}Skipped:${colors.reset} ${skippedCount}`);

    if (failedCount > 0) {
        console.log(
            `\n${colors.red}Some tests failed. Check the error messages above for details.${colors.reset}`,
        );
        process.exit(1);
    } else if (passedCount === 0) {
        console.log(
            `\n${colors.yellow}No services were tested. Add keys to your .env file.${colors.reset}`,
        );
    } else {
        console.log(
            `\n${colors.green}All configured services are working correctly!${colors.reset}`,
        );
    }
}

// Run the tests
runTests().catch((error) => {
    console.error("Fatal error:", error);
    process.exit(1);
});
