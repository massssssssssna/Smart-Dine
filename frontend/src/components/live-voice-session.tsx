'use client';

import { useMemo, useState } from 'react';
import {
  BarVisualizer,
  LiveKitRoom,
  RoomAudioRenderer,
  StartAudio,
  useLocalParticipant,
  useVoiceAssistant,
} from '@livekit/components-react';
import { Mic, MicOff, PhoneOff, Sparkles } from 'lucide-react';

import { api, AssistantVoiceToken } from '@/lib/api';

type Props = {
  conversationId: string | null;
  startDate: string;
  endDate: string;
  onConversationReady: (id: string) => void;
  onEnded: (conversationId: string | null) => void;
};

function VoiceRoom({ onEnded, conversationId }: {onEnded: () => void; conversationId: string}) {
  const { state, audioTrack, agentTranscriptions } = useVoiceAssistant();
  const { localParticipant, isMicrophoneEnabled } = useLocalParticipant();
  const latestTranscript = agentTranscriptions.at(-1)?.text;
  const status = useMemo(() => {
    if (state === 'listening') return 'Listening…';
    if (state === 'thinking') return 'Checking your restaurant records…';
    if (state === 'speaking') return 'Smart Dine is speaking';
    if (state === 'connecting') return 'Connecting to your private room…';
    return 'Ready when you are';
  }, [state]);

  const toggleMicrophone = async () => {
    await localParticipant.setMicrophoneEnabled(!isMicrophoneEnabled);
  };

  return (
    <div className="voice-call-card" data-lk-theme="default">
      <div className={`voice-orb ${state === 'listening' || state === 'speaking' ? 'listening' : ''}`}>
        {audioTrack ? <BarVisualizer state={state} trackRef={audioTrack} barCount={5} /> : <Sparkles size={30}/>} 
      </div>
      <small>SMART DINE LIVE</small>
      <h3>Voice conversation</h3>
      <p className="voice-status">{status}</p>
      {latestTranscript && <p className="voice-transcript">“{latestTranscript}”</p>}
      <StartAudio className="voice-audio-permission" label="Enable assistant audio" />
      <div className="voice-call-actions">
        <button type="button" className={`voice-mic-button ${!isMicrophoneEnabled ? 'muted' : ''}`} onClick={toggleMicrophone}>
          {isMicrophoneEnabled ? <Mic size={22}/> : <MicOff size={22}/>} 
          <span>{isMicrophoneEnabled ? 'Mute' : 'Unmute'}</span>
        </button>
        <button type="button" className="voice-end-button" onClick={onEnded}>
          <PhoneOff size={17}/> End call
        </button>
      </div>
      <span className="voice-private-note">Private manager session · saved in chat history</span>
      <span className="sr-only">Conversation {conversationId}</span>
      <RoomAudioRenderer />
    </div>
  );
}

export function LiveVoiceSession({ conversationId, startDate, endDate, onConversationReady, onEnded }: Props) {
  const [credentials, setCredentials] = useState<AssistantVoiceToken | null>(null);
  const [error, setError] = useState('');

  const connect = async () => {
    setError('');
    try {
      const result = await api<AssistantVoiceToken>('assistant/voice/token', 'POST', {
        start_date: startDate,
        end_date: endDate,
        ...(conversationId ? {conversation_id: conversationId} : {}),
      });
      setCredentials(result);
      onConversationReady(result.conversation_id);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Voice service is unavailable.');
    }
  };

  if (!credentials) {
    return (
      <div className="voice-call-card voice-call-start">
        <div className="voice-orb"><Sparkles size={30}/></div>
        <small>SMART DINE LIVE</small>
        <h3>Talk to your restaurant assistant</h3>
        <p>Your call uses the same secure records and saved conversation as typed chat.</p>
        {error && <p className="voice-error" role="alert">{error}</p>}
        <button type="button" className="voice-connect-button" onClick={connect}><Mic size={18}/> Start private call</button>
        <button type="button" className="voice-cancel-button" onClick={() => onEnded(conversationId)}>Cancel</button>
      </div>
    );
  }

  return (
    <LiveKitRoom
      token={credentials.token}
      serverUrl={credentials.url}
      connect
      audio
      video={false}
      className="voice-livekit-room"
      onError={reason => setError(reason.message)}
      onDisconnected={() => onEnded(credentials.conversation_id)}
    >
      <VoiceRoom conversationId={credentials.conversation_id} onEnded={() => onEnded(credentials.conversation_id)} />
      {error && <div className="voice-room-error" role="alert">{error}</div>}
    </LiveKitRoom>
  );
}
