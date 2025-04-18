## Scheam.org microdata extractor

## Features

- **Deduplicate**: Remove duplicate restaurant entries based on URL
- **Filter**: Filter restaurant data for TripAdvisor entries
- **Merge**: Merge restaurant datasets from different sources
- **Parse**: Parse restaurant data from N-Quad format
- **Scrape**: Scrape restaurant data from TripAdvisor


## Usage

### Deduplicate Restaurants

Remove duplicate restaurant entries based on URL:

```bash
pnpm start dedupe path/to/restaurants.json
pnpm start dedupe path/to/restaurants.json --output custom_output.json
```

### Filter TripAdvisor Restaurants

Filter restaurant data for TripAdvisor entries:

```bash
pnpm start filter path/to/restaurants1.json path/to/restaurants2.json
pnpm start filter path/to/*.json --output custom_output.json
```

### Merge Datasets

Merge restaurant datasets from different sources:

```bash
pnpm start merge path/to/parsed.json path/to/crawl.json
pnpm start merge path/to/parsed.json path/to/crawl.json --dir custom_output_dir
```

### Parse Restaurant Data

Parse restaurant data from N-Quad format:

```bash
pnpm start parse path/to/data.nq path/to/output.json
pnpm start parse path/to/data.nq path/to/output.json --debug
```

### Scrape TripAdvisor

Scrape restaurant data from TripAdvisor:

#### Discovery Mode
Automatically discovers and scrapes restaurant data:

```bash
pnpm start scrape --mode=discovery
pnpm start scrape --mode=discovery --base-url="https://www.tripadvisor.com/Restaurants-g60878-Seattle_Washington.html" --pages=5
```

#### Direct Mode
Scrapes data from a list of URLs:

```bash
pnpm start scrape --mode=direct --input=path/to/urls.json
pnpm start scrape --mode=direct --input=path/to/urls.json --output=path/to/results.json
```

## Commands Reference

```bash
# Show help
pnpm start help

# Show help for a specific command
pnpm start help [COMMAND]

# Show version
pnpm start --version
```


## Trademarks

This project may contain trademarks or logos for projects, products, or services. Authorized use of Microsoft
trademarks or logos is subject to and must follow
[Microsoft's Trademark & Brand Guidelines](https://www.microsoft.com/en-us/legal/intellectualproperty/trademarks/usage/general).
Use of Microsoft trademarks or logos in modified versions of this project must not cause confusion or imply Microsoft sponsorship.
Any use of third-party trademarks or logos are subject to those third-party's policies.
