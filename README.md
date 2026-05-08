# Digest

**A chat sidebar that actually knows your vault.**

Digest reads your notes through [Enzyme](https://enzyme.garden)'s semantic index — not keyword search, not embeddings-in-a-vacuum, but a concept graph built from your existing tags, links, and folder structure. When you ask a question, it already has context before the model starts thinking.

The result: responses that reference what you've actually written, quote specific passages, and surface connections you didn't see. Every source is a clickable `[[wikilink]]` that opens in a new tab.

## What it does

- **Finds notes by meaning, not keywords.** Ask "what have I written about feeling stuck?" and it finds relevant entries even if they never use that phrase.
- **Quotes your own writing back to you.** Responses cite specific passages with `[[links]]` to the source notes. Click through to read the full thing.
- **Writes and creates notes.** Draft directly from the chat — new notes land in your vault immediately.
- **Stays fast on small models.** Runs on any OpenAI-compatible endpoint. Works with OpenRouter, local llama-server, Ollama. A response takes 5-20K tokens instead of the 60-90K that explore-mode agents burn.

## Install

1. Clone or download this repo into your vault's `.obsidian/plugins/reason/` folder
2. Enable "Digest" in Settings → Community Plugins
3. Open Settings → Digest and add your model settings
4. In the Enzyme section, install Enzyme, sign in or add your own AI credentials, then initialize the vault

Digest can install and initialize Enzyme from its settings page. If you prefer Homebrew, `brew install steipete/tap/enzyme` works too.

## Setup

In **Settings → Digest**, configure the chat model Digest should use:

| Setting | Example | Notes |
|---------|---------|-------|
| Chat API key | `sk-or-...` | Used for Digest chat. Leave blank only if your endpoint does not require one |
| Base URL | `https://openrouter.ai/api/v1` | Chat completions endpoint, or `http://localhost:8080` for local |
| Model | `openai/gpt-4.1-mini` | Chat model served by the endpoint |

Works with OpenRouter, OpenAI, Anthropic (via proxy), llama-server, Ollama, vLLM — anything that speaks the OpenAI chat completions API.

For Enzyme initialization and refresh, Digest uses your signed-in Enzyme account when available. If you are not signed in, advanced settings can pass `OPENAI_API_KEY`, `OPENAI_BASE_URL`, and `OPENAI_MODEL` to the Enzyme child process. You can also leave those fields blank and launch Obsidian with the same environment variables already set.

Local semantic search uses Enzyme's on-device index and does not call an AI provider. Catalyst generation does use AI. See [Enzyme's privacy details](https://www.enzyme.garden/privacy).

### Running locally

```bash
# llama-server with a small model
llama-server -hf ggml-org/gemma-4-E4B-it-GGUF
```

Then set Base URL to `http://localhost:8080` in settings.

## How it works

When you send a message, Digest:

1. **Prefetches** — runs an 8ms `enzyme catalyze` lookup to find what your vault knows about this topic, before the model sees the prompt
2. **Decides** — the model either responds from existing context (fast) or calls VaultSearch for deeper results (thorough)
3. **Cites sources** — quotes passages and links to source notes as `[[wikilinks]]`
4. **Manages context** — old search results are cleared automatically; long conversations get summarized to stay within the token window

This means follow-up questions ("tell me more", "how does X connect to Y") are fast — the model works from what's already in the conversation instead of re-searching.

### Why Enzyme matters

Tags help you find what you remember. Enzyme finds the rest.

Your vault already has structure — tags, links, folders. Enzyme compiles that structure into a semantic index with AI-generated "catalyst questions" anchored to each entity. At query time, a vector lookup against those catalysts returns conceptually relevant content in 8ms. No cloud embeddings, no token cost for retrieval.

The practical difference: a typical agent exploring a vault burns 60-90K tokens across 5-10 LLM round trips deciding what to search for. Digest gets relevant context from Enzyme before the first LLM call, so it uses 5-20K tokens in 1-2 turns.

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

Digest also works as a standalone CLI without Obsidian:

```bash
export OPENAI_API_KEY=sk-or-...
export OPENAI_BASE_URL=https://openrouter.ai/api/v1
export OPENAI_MODEL=google/gemini-3-flash-preview
cd ~/vault && npx @jshph/digest
```

See the [`digest` repo](https://github.com/jshph/digest) for CLI docs and the full agent architecture.
