// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { defineConfig } from "vite";
import path from "path";

export default defineConfig({
    logLevel: "warn",
    root: "src/view/site",
    build: {
        outDir: "../../../dist/view/site",
        emptyOutDir: true,
        reportCompressedSize: false,
        chunkSizeWarningLimit: 5000,
        sourcemap: false,
        minify: 'esbuild',
        target: 'es2020',
        
        rollupOptions: {
            input: {
                main: path.resolve(__dirname, "src/view/site/index.html"),
            },
            
            cache: true,
            preserveEntrySignatures: 'strict',
            
            output: {
                // Optimized chunk splitting for better caching
                manualChunks: (id) => {
                    if (id.includes('node_modules')) {
                        // Core Milkdown - most stable
                        if (id.includes('@milkdown/core') || id.includes('@milkdown/crepe')) {
                            return 'milkdown-core';
                        }
                        
                        // Milkdown features
                        if (id.includes('@milkdown/preset') || 
                            id.includes('@milkdown/plugin') ||
                            id.includes('@milkdown/theme') ||
                            id.includes('@milkdown/utils')) {
                            return 'milkdown-features';
                        }
                        
                        // Math rendering
                        if (id.includes('katex') || id.includes('markdown-it-texmath')) {
                            return 'math-rendering';
                        }
                        
                        // ProseMirror
                        if (id.includes('prosemirror')) {
                            return 'prosemirror';
                        }
                        
                        // Collaboration
                        if (id.includes('yjs') || id.includes('y-websocket') || id.includes('lib0')) {
                            return 'collaboration';
                        }
                        
                        // Mermaid
                        if (id.includes('mermaid')) {
                            return 'mermaid';
                        }
                        
                        // Markdown processing
                        if (id.includes('markdown-it') && !id.includes('texmath')) {
                            return 'markdown';
                        }
                        
                        // Utils
                        if (id.includes('unist-util') || id.includes('dompurify')) {
                            return 'utils';
                        }
                        
                        return 'vendor';
                    }
                },
                
                chunkFileNames: 'chunks/[name]-[hash:8].js',
                assetFileNames: (assetInfo) => {
                    const extType = assetInfo.name.split('.').pop();
                    if (['woff', 'woff2', 'ttf'].includes(extType)) {
                        return `fonts/[name]-[hash:8].[ext]`;
                    }
                    if (['css'].includes(extType)) {
                        return `styles/[name]-[hash:8].[ext]`;
                    }
                    return `assets/[name]-[hash:8].[ext]`;
                }
            }
        },
    },
    
    cacheDir: '../../../node_modules/.vite',
    
    server: {
        port: parseInt(process.env.VITE_FRONTEND_PORT) || 5173,
        host: true,
        proxy: {
            "/document": {
                target: `http://localhost:${process.env.VITE_BACKEND_PORT || 3000}`,
                changeOrigin: true,
            },
            "/preview": {
                target: `http://localhost:${process.env.VITE_BACKEND_PORT || 3000}`,
                changeOrigin: true,
            },
            "/events": {
                target: `http://localhost:${process.env.VITE_BACKEND_PORT || 3000}`,
                changeOrigin: true,
            },
            "/agent": {
                target: `http://localhost:${process.env.VITE_BACKEND_PORT || 3000}`,
                changeOrigin: true,
            },
        },
    },
    
    css: {
        modules: false,
    },
    
    resolve: {
        alias: {
            "@": path.resolve(__dirname, "src/view/site"),
        },
        dedupe: [
            "prosemirror-model",
            "prosemirror-state", 
            "prosemirror-view",
            "yjs"
        ]
    },
    
    optimizeDeps: {
        entries: ['src/view/site/**/*.ts', 'src/view/site/**/*.js'],
        include: [
            "@milkdown/core",
            "@milkdown/crepe", 
            "@milkdown/preset-commonmark",
            "@milkdown/preset-gfm",
            "@milkdown/plugin-history",
            "@milkdown/plugin-math",
            "@milkdown/plugin-collab",
            "@milkdown/theme-nord",
            "@milkdown/utils",
            "mermaid",
            "katex",
            "prosemirror-model",
            "prosemirror-state", 
            "prosemirror-view",
            "prosemirror-inputrules",
            "yjs",
            "y-websocket",
            "lib0",
            "markdown-it",
            "markdown-it-texmath",
            "unist-util-visit",
            "dompurify"
        ],
        exclude: ['y-protocols'],
        force: false,
        holdUntilCrawlEnd: true
    },
    
    esbuild: {
        target: 'es2020',
        legalComments: 'none',
        drop: ['console', 'debugger'],
        treeShaking: true
    }
});
