// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Vite plugin for caching vendor chunks to speed up builds
 * Only rebuilds vendor chunks when dependencies actually change
 */

import { createHash } from 'crypto';
import { readFileSync, writeFileSync, existsSync, statSync } from 'fs';
import path from 'path';

export function vendorCachePlugin() {
    const cacheFile = '.vite-vendor-cache.json';
    let isProduction = false;
    let root = '';
    let dependencyHash = '';
    let shouldUseCache = false;
    
    return {
        name: 'vendor-cache',
        configResolved(config) {
            isProduction = config.command === 'build';
            root = config.root;
        },
        buildStart() {
            if (!isProduction) return;
            
            try {
                // Calculate hash of package.json and pnpm-lock.yaml to detect dependency changes
                const packageJsonPath = path.resolve(root, '../../../package.json');
                const lockfilePath = path.resolve(root, '../../../pnpm-lock.yaml');
                
                let depHash = '';
                if (existsSync(packageJsonPath)) {
                    depHash += readFileSync(packageJsonPath, 'utf8');
                }
                if (existsSync(lockfilePath)) {
                    depHash += readFileSync(lockfilePath, 'utf8');
                }
                
                const currentHash = createHash('md5').update(depHash).digest('hex');
                
                // Check if dependencies changed
                const cacheFilePath = path.resolve(root, '../../../', cacheFile);
                let useCache = false;
                
                if (existsSync(cacheFilePath)) {
                    try {
                        const cache = JSON.parse(readFileSync(cacheFilePath, 'utf8'));
                        useCache = cache.dependencyHash === currentHash;
                    } catch (e) {
                        // Invalid cache file, rebuild
                    }
                }
                
                dependencyHash = currentHash;
                shouldUseCache = useCache;
                
                if (shouldUseCache) {
                    console.log('📦 Dependencies unchanged, using cached vendor chunks...');
                }
            } catch (error) {
                console.warn('⚠️  Could not check vendor cache, proceeding with full build...');
                shouldUseCache = false;
            }
        },
        generateBundle(options, bundle) {
            if (!isProduction) return;
            
            // Update cache after successful build
            try {
                const cacheFilePath = path.resolve(root, '../../../', cacheFile);
                const cache = {
                    dependencyHash: dependencyHash,
                    timestamp: Date.now(),
                    chunks: Object.keys(bundle).filter(name => 
                        name.includes('vendor') || 
                        name.includes('milkdown') || 
                        name.includes('mermaid') ||
                        name.includes('prosemirror')
                    )
                };
                writeFileSync(cacheFilePath, JSON.stringify(cache, null, 2));
            } catch (error) {
                console.warn('⚠️  Could not update vendor cache');
            }
        }
    };
}
