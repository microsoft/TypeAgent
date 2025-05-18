# TypeAgent Documentation Site

This repository contains the documentation site for [TypeAgent](https://github.com/hillary-mutisya/TypeAgent), a TypeScript library for building personal agents with natural language interfaces using TypeChat.

## About This Site

This documentation site is built using [GitHub Pages](https://pages.github.com/) with [Jekyll](https://jekyllrb.com/), a static site generator. It provides comprehensive documentation, examples, and API references for TypeAgent.

## Local Development

To run this site locally, follow these steps:

1. Install [Ruby](https://www.ruby-lang.org/en/documentation/installation/)
2. Install Bundler and Jekyll:
   ```
   gem install bundler jekyll
   ```
3. Clone this repository:
   ```
   git clone https://github.com/hillary-mutisya/TypeAgent.git
   cd TypeAgent/docs
   ```
4. Install dependencies:
   ```
   bundle install
   ```
5. Start the local development server:
   ```
   bundle exec jekyll serve
   ```
6. Open your browser and navigate to `http://localhost:4000/TypeAgent/`

## Site Structure

```
docs/
├── _config.yml          # Jekyll configuration
├── _layouts/            # Layout templates
│   ├── default.html     # Default layout
│   └── page.html        # Page layout for documentation
├── _docs/               # Documentation content (Markdown)
│   ├── getting-started.md
│   ├── installation.md
│   └── ...
├── _includes/           # Reusable components
│   ├── header.html
│   ├── footer.html
│   └── ...
├── assets/              # Static assets
│   ├── css/
│   ├── js/
│   └── images/
├── examples/            # Example pages
│   ├── list-agent.html
│   └── ...
├── api/                 # API documentation
│   └── index.html
└── index.html           # Home page
```

## Contributing

If you'd like to contribute to the documentation, please submit a pull request or open an issue in the [main repository](https://github.com/hillary-mutisya/TypeAgent).

## License

This documentation is licensed under the same license as the TypeAgent project.