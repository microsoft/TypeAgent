// fix-service-worker.js
const fs = require('fs');
const path = require('path');

// Path to the service worker in your build output
const serviceWorkerPath = path.resolve(__dirname, 'dist/extension/serviceWorker.js');

console.log(`Checking for service worker at: ${serviceWorkerPath}`);

if (fs.existsSync(serviceWorkerPath)) {
  const content = fs.readFileSync(serviceWorkerPath, 'utf8');
  
  // Add the Content-Type header comment
  const fixedContent = `// Content-Type: text/javascript\n${content}`;
  
  // Write back to the file
  fs.writeFileSync(serviceWorkerPath, fixedContent, 'utf8');
  
  console.log('✓ Service worker fixed with proper Content-Type header');
} else {
  console.error('❌ Service worker file not found at expected path!');
  
  // List files in the dist directory to help debug
  console.log('Looking for service worker in dist directory:');
  
  function scanDirectory(directory, level = 0) {
    const indent = '  '.repeat(level);
    const files = fs.readdirSync(directory);
    
    files.forEach(file => {
      const fullPath = path.join(directory, file);
      const stats = fs.statSync(fullPath);
      
      if (stats.isDirectory()) {
        console.log(`${indent}📁 ${file}`);
        scanDirectory(fullPath, level + 1);
      } else {
        if (file.includes('service') || file.includes('worker')) {
          console.log(`${indent}📄 ${file} (This might be your service worker)`);
        } else {
          console.log(`${indent}📄 ${file}`);
        }
      }
    });
  }
  
  scanDirectory(path.resolve(__dirname, 'dist'));
}

// Check the manifest.json file to verify service worker path
const manifestPath = path.resolve(__dirname, 'dist/extension/manifest.json');

if (fs.existsSync(manifestPath)) {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  
  console.log('\nManifest service worker path:', 
    manifest.background && manifest.background.service_worker || 'Not found');
  
  // Suggest fix if paths don't match
  if (manifest.background && manifest.background.service_worker) {
    const expectedPath = 'serviceWorker.js';
    const specifiedPath = manifest.background.service_worker;
    
    if (specifiedPath !== expectedPath) {
      console.log(`⚠️ Manifest has service_worker path as "${specifiedPath}", but file is built as "${expectedPath}"`);
      console.log('Consider updating your manifest.json to match the built file path');
    } else {
      console.log('✓ Manifest service_worker path looks correct');
    }
  }
} else {
  console.error('❌ Manifest.json not found!');
}