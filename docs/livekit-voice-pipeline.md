# LiveKit Voice Agent Pipeline

## Audio Pipeline Architecture
- STT: Deepgram Nova-3 with smart formatting and VAD events.
- Orchestration: LiveKit Agents framework with `AgentSession`.
- LLM: Groq LLaMA models with function tools.
- TTS: Cartesia Sonic-3 with low-latency streaming fallback.

## Latency Optimization
Audio frame buffer configured at 20ms chunks to achieve sub-400ms time-to-first-audio across Asia/Karachi network routes.

## Visual Indicator
Voice drawer renders animated SVG wave forms corresponding to speech volume and agent thinking states.

## Voice Agent Bilingual Protocol
Voice agent mirrors the speaker's language instantaneously without asterisks or markdown syntax for clean text-to-speech output.
