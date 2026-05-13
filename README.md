<div align="center">
  <h1>Enzyme</h1>
  <p><strong>A chat agent that actually knows the ideas in your Obsidian vault.</strong></p>
  <p>
    <img
      alt="Obsidian community plugin downloads"
      src="https://img.shields.io/badge/dynamic/json?logo=obsidian&color=%23483699&label=downloads&query=%24%5B%22reason%22%5D.downloads&url=https%3A%2F%2Fraw.githubusercontent.com%2Fobsidianmd%2Fobsidian-releases%2Fmaster%2Fcommunity-plugin-stats.json&style=for-the-badge"
    >
  </p>
  <p>
    <img src="assets/zoomed.gif" alt="Enzyme chat sidebar in Obsidian" width="760">
  </p>
</div>

Enzyme creates a conceptual map of the ideas in your vault from your existing tags, links, folders, and note recency. When you start a chat, it can pull the right context before you ask a follow-up.

When Enzyme responds, it quotes from your vault with clickable note links and highlights the graph nodes it used.

## How is this different from Claude Code?

Enzyme builds its context graph in a fraction of the time and tokens that Claude Code would use to explore a vault. It keeps that map fresh as your notes change.

In practice, Enzyme can save up to 90% of the tokens of Claude Code because it uses an agent harness optimized for Markdown, not code. It also works well with local models, including Gemma4 E4B.

## Install

Install Enzyme from Obsidian's [Community Plugins](https://obsidian.md/plugins?id=reason).

## Setup

In **Settings → Enzyme**, configure the chat model Enzyme should use:

| Setting | Example | Notes |
|---------|---------|-------|
| Chat API key | `sk-or-...` | Used for Enzyme chat. Leave blank only if your endpoint does not require one |
| Base URL | `https://openrouter.ai/api/v1` | Chat completions endpoint, or `http://localhost:8080` for local |
| Model | `google/gemini-3-flash-preview` | Chat model served by the endpoint |

Works with OpenRouter, OpenAI, Anthropic (via proxy), llama-server, Ollama, vLLM — anything that speaks the OpenAI chat completions API.

Enzyme uses a local CLI under the hood. Sign in for included indexing credits, or use advanced settings to pass `OPENAI_API_KEY`, `OPENAI_BASE_URL`, and `OPENAI_MODEL` to the indexing process.

VaultSearch uses Enzyme's on-device index and does not call an AI provider. Initialization does use AI providers. See [Enzyme's privacy details](https://www.enzyme.garden/privacy).

### Running locally

```bash
# llama-server with a small model
llama-server -hf ggml-org/gemma-4-E4B-it-GGUF
```

Then set Base URL to `http://localhost:8080` in settings.

## Development

```bash
# Clone
git clone https://github.com/jshph/obsidian-enzyme
cd obsidian-enzyme

# Install (uses bun)
bun install

# Dev mode (watch + auto-deploy to vault)
bun run dev

# Production build
bun run build
```

The agent core lives in [`@jshph/digest`](https://github.com/jshph/digest) as a dependency. To develop against a local checkout:

```bash
bun run link:local    # switches to file:../digest
bun run link:remote   # switches back to github
```

## CLI

The agent core also works as a standalone CLI without Obsidian. See the [`digest` repo](https://github.com/jshph/digest) for CLI docs and the full agent architecture.
