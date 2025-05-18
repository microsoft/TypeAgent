# TypeAgent Documentation

This directory contains the documentation site for TypeAgent.

## Development

### Prerequisites

- Node.js (v14 or later)
- npm or yarn

### Setup

1. Install dependencies:
   ```bash
   cd docs
   npm install
   ```

2. Start the development server:
   ```bash
   npm start
   ```

3. Open your browser and navigate to `http://localhost:8080`

### Directory Structure

```
docs/
├── _data/              # Global data files
│   ├── navigation.js   # Navigation structure
│   └── site.json       # Site metadata
├── _includes/          # Layout templates
│   ├── base.njk        # Base layout
│   └── docs.njk        # Documentation layout
├── assets/             # Static assets
│   └── css/
│       └── style.css   # CSS styles
├── content/            # Markdown content
│   ├── index.md        # Homepage/Documentation index
│   ├── getting-started/
│   │   └── index.md    # Getting started guide
│   └── ...             # Other documentation pages
├── .eleventy.js        # Eleventy configuration
├── .gitignore          # Git ignore file
└── package.json        # Node.js dependencies
```

### Building

To build the site:

```bash
cd docs
npm run build
```

The built site will be in the `docs/_site` directory.

## Deployment

The site is automatically deployed to GitHub Pages when changes are pushed to the main branch. The deployment is handled by GitHub Actions.
