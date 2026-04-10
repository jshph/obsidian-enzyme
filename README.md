# Enzyme

An Obsidian plugin that surfaces connections across your vault, rendered as a clickable digest of older thinking to revisit.

**[Install from Obsidian](https://obsidian.md/plugins?id=reason)**

## What it does

Enzyme uses semantic search to find threads between your notes — including highlights you've saved from books, articles, and tweets — and weaves them into a digest that helps you continue writing and thinking.

Each digest block:

1. Takes your prompt and generates diverse search queries across different registers
2. Runs those queries against your vault via [Enzyme](https://enzyme.garden) catalyze (in parallel)
3. Sends the results to an LLM that sequences them into a digest with specific probes pushing you to revisit and build on older thinking

Excerpts are clickable — they open the source note directly in Obsidian.

## Usage

Use the command palette: **Insert Enzyme block**

This inserts a code block you can customize:

````
```enzyme-digest
prompt: what threads connect my recent thinking about interfaces?
freq: daily  # replace with: hourly | daily | 3d | weekly | manual
```
````

If you have text selected when you invoke the command, it becomes the prompt.

## Setup

1. Install the plugin from the [Obsidian plugin directory](https://obsidian.md/plugins?id=reason)
2. Open **Settings > Enzyme**
3. Add your API key and configure the LLM provider (defaults to OpenRouter)
4. If the Enzyme CLI isn't installed, click **Install Enzyme** (or see [enzyme.garden/setup](https://enzyme.garden/setup))
5. Click **Initialize vault** to index your notes

Enzyme will auto-refresh its index in the background based on your configured interval.

## Settings

| Setting | Description |
|---|---|
| **API Key** | OpenAI-compatible API key (e.g. OpenRouter, OpenAI) |
| **Base URL** | API endpoint (default: `https://openrouter.ai/api/v1`) |
| **Model** | Model identifier (default: `google/gemini-3-flash-preview`) |
| **Vault path** | Path for enzyme catalyze (leave empty for current vault) |
| **Queries per digest** | Number of search queries per prompt (1-10) |
| **Highlights per query** | Results per query (1-20) |
| **Max per source** | Cap per source file for diversity (1-10) |
| **Default prompt** | Pre-filled when inserting a new block |
| **Auto-refresh interval** | How often enzyme re-indexes (1/3/7 days) |

The LLM configuration is shared — it's used by both Enzyme (for catalyst generation during indexing) and the digest block (for query generation and weaving).

## How it works

The plugin shells out to the [Enzyme CLI](https://enzyme.garden), which maintains a local semantic index of your vault:

- **Embeddings** are computed entirely on-device using a local ONNX model (no data leaves your machine)
- **Catalyst generation** requires one LLM API call per index refresh
- The index lives in `.enzyme/` inside your vault

The digest block then uses the LLM to generate search queries from your prompt, retrieves results via `enzyme catalyze`, and weaves them into a sequence with register-matched probes — intellectual content gets probed on tensions and gaps, experiential content on observations, practical content on decisions.

## Development

```sh
# Install dependencies
npm install

# Dev mode (watches for changes, copies to plugins dir)
npm run dev

# Production build
npm run build
```

## License

MIT
