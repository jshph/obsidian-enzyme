# Gemini Live Voice Notes

As of 2026-05-09, the official Gemini realtime voice path is Gemini Live API.

## What Works

- Speech-to-speech is supported over a stateful WebSocket.
- Audio input and audio output are supported for realtime sessions.
- Function calling is supported, but the client is responsible for receiving tool calls and returning function responses.
- Browser/client deployments should use ephemeral tokens rather than embedding long-lived API keys.

## Agent Handoffs

Gemini Live API does not expose native agent handoff as a single realtime primitive.

For multi-agent routing, use Google Agent Development Kit above Gemini/Live:

- ADK supports multi-agent systems and `transfer_to_agent(...)`.
- ADK supports wrapping agents as tools.
- ADK has experimental Agent2Agent integration.

## Current API Names To Revisit

- Gemini API Live: `gemini-3.1-flash-live-preview`
- Gemini API native-audio examples: `gemini-2.5-flash-native-audio-preview-12-2025`
- Vertex AI GA native-audio: `gemini-live-2.5-flash-native-audio`

## Constraints

- Sessions are WebSocket-based and stateful.
- Response modality is chosen per session.
- Function calling behavior differs by model generation. Gemini 3.1 Flash Live is sequential; Gemini 2.5 Flash Live supports non-blocking async function calling.
- Longer conversations need session resumption or context compression.

## Sources

- https://ai.google.dev/gemini-api/docs/live-api
- https://ai.google.dev/gemini-api/docs/live-api/capabilities
- https://ai.google.dev/gemini-api/docs/live-api/tools
- https://ai.google.dev/api/live
- https://adk.dev/agents/multi-agents/
- https://adk.dev/a2a/
