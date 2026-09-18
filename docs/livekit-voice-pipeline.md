# LiveKit Voice Agent Pipeline

## Audio Pipeline Architecture
- STT: Deepgram Nova-3 with smart formatting and VAD events.
- Orchestration: LiveKit Agents framework with `AgentSession`.
- LLM: Groq LLaMA models with function tools.
- TTS: Cartesia Sonic-3 with low-latency streaming fallback.
