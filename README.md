<div align="center">
  <h1>Digest</h1>
  <p><strong>A chat agent that actually knows the ideas in your Obsidian vault.</strong></p>
  <p>
    <img
      alt="Obsidian community plugin downloads"
      src="https://img.shields.io/badge/dynamic/json?logo=obsidian&color=%23483699&label=downloads&query=%24%5B%22reason%22%5D.downloads&url=https%3A%2F%2Fraw.githubusercontent.com%2Fobsidianmd%2Fobsidian-releases%2Fmaster%2Fcommunity-plugin-stats.json&style=for-the-badge"
    >
  </p>
  <p>
    <img src="assets/zoomed.gif" alt="Digest chat sidebar in Obsidian" width="760">
  </p>
</div>

Digest uses [Enzyme](https://enzyme.garden) to create a conceptual map of the fragmented ideas in your vault, leveraging the existing tag, link, and folder structure, as well as temporal recency by using frontmatter fields. When you start a new chat, it already has the context before you ask the question.

When chat responds, it quotes from your vault's material with clickable links so you can revisit notes you may have forgotten about. It also highlights nodes in your graph view that it used to respond.

## How is this different from Claude Code?

Enzyme builds its context graph in a fraction of the time and tokens that Claude Code would have used to explore. It's like an agent that quickly onboards itself to your recent ideas. And it automatically refreshes itself with new content and drifts.

In practice, a conversation with Digest saves up to 90% of the tokens of Claude Code, because Digest is built on an agent harness optimized for Markdown, not code. This also means Digest can work flawlessly with local models (tested with as small as Gemma4 E4B).

## Install

Install Digest from Obsidian's [Community Plugins](https://obsidian.md/plugins?id=reason) (manifest there is out of date but will be updated soon)

## Setup

In **Settings → Digest**, configure the chat model Digest should use:

| Setting | Example | Notes |
|---------|---------|-------|
| Chat API key | `sk-or-...` | Used for Digest chat. Leave blank only if your endpoint does not require one |
| Base URL | `https://openrouter.ai/api/v1` | Chat completions endpoint, or `http://localhost:8080` for local |
| Model | `google/gemini-3-flash-preview` | Chat model served by the endpoint |

Works with OpenRouter, OpenAI, Anthropic (via proxy), llama-server, Ollama, vLLM — anything that speaks the OpenAI chat completions API.

Digest uses the Enzyme CLI under the hood, which comes with free AI credits for initializing the Enzyme index. If you prefer not to login, advanced settings can pass `OPENAI_API_KEY`, `OPENAI_BASE_URL`, and `OPENAI_MODEL` to the Enzyme child process.

VaultSearch uses uses Enzyme's on-device index and does not call an AI provider. However, initialization does use US-based AI providers. See [Enzyme's privacy details](https://www.enzyme.garden/privacy).

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

Digest also works as a standalone CLI without Obsidian. See the [`digest` repo](https://github.com/jshph/digest) for CLI docs and the full agent architecture.
