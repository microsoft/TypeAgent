// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { defineConfig } from "vite";
import path from "path";
import { vendorCachePlugin } from "./vendor-cache-plugin.mjs";

const isDev = process.env.NODE_ENV === 'development';

export default defineConfig({
    plugins: [vendorCachePlugin()],
    logLevel: "warn",
    root: "src/view/site",
    build: {
        outDir: "../../../dist/view/site",
        emptyOutDir: true,
        reportCompressedSize: false,
        chunkSizeWarningLimit: 5000,
        sourcemap: isDev,
        minify: isDev ? false : 'esbuild',
        target: 'es2020',
        rollupOptions: {
            input: {
                main: path.resolve(__dirname, "src/view/site/index.html"),
            },
            // Enable Rollup caching for faster incremental builds
            cache: true,
            output: {
                // More granular chunking for better caching
                manualChunks: (id) => {
                    if (id.includes('node_modules')) {
                        // Separate stable deps into different chunks for better caching
                        if (id.includes('@milkdown/core') || id.includes('@milkdown/crepe')) return 'milkdown-core';
                        if (id.includes('@milkdown/preset')) return 'milkdown-presets';
                        if (id.includes('@milkdown/plugin')) return 'milkdown-plugins';
                        if (id.includes('@milkdown/theme')) return 'milkdown-theme';
                        if (id.includes('@milkdown/utils')) return 'milkdown-utils';
                        if (id.includes('prosemirror')) return 'prosemirror';
                        if (id.includes('mermaid')) return 'mermaid';
                        if (id.includes('katex') || id.includes('markdown-it-texmath')) return 'math';
                        if (id.includes('yjs') || id.includes('y-protocols') || id.includes('lib0')) return 'collaboration';
                        if (id.includes('dompurify') || id.includes('unist-util')) return 'utils';
                        if (id.includes('markdown-it') && !id.includes('texmath')) return 'markdown';
                        return 'vendor';
                    }
                },
                // Better chunk naming for cache stability
                chunkFileNames: (chunkInfo) => {
                    const facadeModuleId = chunkInfo.facadeModuleId;
                    if (facadeModuleId && facadeModuleId.includes('node_modules')) {
                        return `chunks/[name]-[hash].js`;
                    }
                    return `chunks/[name]-[hash].js`;
                }
            }
        },
    },
    cacheDir: '../../../node_modules/.vite', // Use monorepo cache directory
    server: {
        port: parseInt(process.env.VITE_FRONTEND_PORT) || 5173,
        host: true,
        proxy: {
            // Proxy API requests to the backend during development
            // Backend port can be overridden via VITE_BACKEND_PORT env var
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
    },
    optimizeDeps: {
        entries: ['src/view/site/**/*.ts', 'src/view/site/**/*.js'],
        include: [
            // Core editor dependencies - these are heavy and stable
            "@milkdown/core",
            "@milkdown/crepe", 
            "@milkdown/preset-commonmark",
            "@milkdown/preset-gfm",
            "@milkdown/plugin-history",
            "@milkdown/plugin-math",
            "@milkdown/plugin-collab",
            "@milkdown/theme-nord",
            "@milkdown/utils",
            
            // Heavy rendering libraries
            "mermaid",
            "katex",
            
            // ProseMirror ecosystem
            "prosemirror-model",
            "prosemirror-state", 
            "prosemirror-view",
            "prosemirror-inputrules",
            
            // Collaboration libraries
            "yjs",
            "y-websocket",
            
            // Markdown processing
            "markdown-it",
            "markdown-it-texmath",
            
            // Utilities
            "unist-util-visit",
            "dompurify"
        ],
        // Force aggressive caching - only rebuild when package.json changes
        force: false,
        holdUntilCrawlEnd: true // Wait for all deps to be discovered before optimizing
    },
    esbuild: {
        target: 'es2020',
        legalComments: isDev ? 'inline' : 'none'
    }
});
