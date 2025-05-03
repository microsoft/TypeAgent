// debug-service-worker.js
const fs = require('fs');
const path = require('path');

console.log('Service Worker Debugging Tool');
console.log('----------------------------');

// Function to check if a file exists
function checkFile(filePath) {
  try {
    return fs.existsSync(filePath);
  } catch (err) {
    console.error(`Error checking ${filePath}:`, err);
    return false;
  }
}

// Function to read manifest.json
function readManifest(manifestPath) {
  try {
    const manifestData = fs.readFileSync(manifestPath, 'utf8');
    return JSON.parse(manifestData);
  } catch (err) {
    console.error(`Error reading manifest at ${manifestPath}:`, err);
    return null;
  }
}

// Main execution
const extensionDir = path.resolve(__dirname, 'dist/extension');
const manifestPath = path.join(extensionDir, 'manifest.json');

console.log(`Looking for manifest at: ${manifestPath}`);
if (!checkFile(manifestPath)) {
  console.error('❌ Manifest file not found!');
  process.exit(1);
}

const manifest = readManifest(manifestPath);
if (!manifest) {
  console.error('❌ Could not parse manifest.json!');
  process.exit(1);
}

console.log('✅ Manifest found and parsed');

// Check service worker configuration
if (!manifest.background || !manifest.background.service_worker) {
  console.error('❌ No service_worker entry in manifest background section!');
  process.exit(1);
}

console.log(`Service worker path in manifest: ${manifest.background.service_worker}`);
console.log(`Service worker type in manifest: ${manifest.background.type || 'not specified'}`);

// Check if service worker file exists
const swPath = path.join(extensionDir, manifest.background.service_worker);
console.log(`Looking for service worker at: ${swPath}`);

if (!checkFile(swPath)) {
  console.error('❌ Service worker file not found at the path specified in manifest!');
  
  // Try to find where the service worker might be
  console.log('Searching for possible service worker files...');
  
  function findServiceWorkerFiles(dir, fileList = []) {
    const files = fs.readdirSync(dir);
    
    files.forEach(file => {
      const filePath = path.join(dir, file);
      const stat = fs.statSync(filePath);
      
      if (stat.isDirectory()) {
        findServiceWorkerFiles(filePath, fileList);
      } else if (file.includes('service') || file.includes('worker') || file.includes('background')) {
        fileList.push(filePath);
      }
    });
    
    return fileList;
  }
  
  const possibleFiles = findServiceWorkerFiles(extensionDir);
  
  if (possibleFiles.length > 0) {
    console.log('Possible service worker files found:');
    possibleFiles.forEach(file => {
      console.log(`- ${path.relative(extensionDir, file)}`);
    });
    
    console.log('\nFix options:');
    console.log('1. Update manifest.json to point to one of these files');
    console.log('2. Modify your vite.config.js to output the service worker to the correct path');
  } else {
    console.log('No potential service worker files found in the build output.');
  }
  
  process.exit(1);
}

console.log('✅ Service worker file found');

// Check file content
try {
  const swContent = fs.readFileSync(swPath, 'utf8');
  const firstLine = swContent.split('\n')[0];
  
  console.log(`First line of service worker: ${firstLine}`);
  
  if (!firstLine.includes('Content-Type') && !firstLine.includes('content-type')) {
    console.log('⚠️ Service worker does not have Content-Type comment at the top');
    console.log('Adding Content-Type header...');
    
    const newContent = `// Content-Type: text/javascript\n${swContent}`;
    fs.writeFileSync(swPath, newContent, 'utf8');
    
    console.log('✅ Content-Type header added to service worker');
  } else {
    console.log('✅ Service worker has Content-Type header');
  }
  
  if (manifest.background.type !== 'module') {
    console.log('⚠️ Service worker type is not set to "module" in manifest');
    console.log('This can cause issues with ES modules in service workers');
    
    // Update manifest
    manifest.background.type = 'module';
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
    
    console.log('✅ Updated manifest to set service_worker type to "module"');
  }
  
  console.log('\nAll checks complete. Service worker should be ready for use.');
  console.log('If you still encounter issues, check the Chrome extension error logs.');
  
} catch (err) {
  console.error('❌ Error reading service worker file:', err);
  process.exit(1);
}