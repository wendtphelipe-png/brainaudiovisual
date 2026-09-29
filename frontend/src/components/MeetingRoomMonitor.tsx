import React, { useState, useEffect, useRef } from 'react';
import { 
  Volume2, VolumeX, Activity, ArrowLeft, RefreshCw, 
  ExternalLink, Mic, Radio, Shield, Copy, Check, 
  Sliders, Wifi, Clock, AlertTriangle, ArrowRight, Play, Square
} from 'lucide-react';
import { LiveKitRoom, RoomAudioRenderer } from '@livekit/components-react';

interface MeetingData {
  id: string;
  title: string;
  currentMeetUrl: string;
  scheduledNextMeetUrl: string;
  accountIds: [string, string];
  status: 'active' | 'transitioning' | 'scheduled' | 'ended';
  startedAt: string;
  nextSwapInSeconds: number;
  totalDurationSeconds: number;
  audioRoomName: string;
  telemetry: {
    latencyMs: number;
    jitterMs: number;
    packetLossPct: number;
    bitrateKbps: number;
    networkQuality: 'excellent' | 'good' | 'poor';
    audioLevelPct: number;
    activeBotInstance: string;
    transitionBotInstance?: string | null;
  };
  transcriptions: Array<{
    id: string;
    speaker: string;
    originalText: string;
    translatedText: string;
    timestamp: string;
    language: string;
  }>;
}

interface MeetingRoomMonitorProps {
  meetingId: string;
  onBackToAdmin?: () => void;
}

export default function MeetingRoomMonitor({ meetingId, onBackToAdmin }: MeetingRoomMonitorProps) {
  const [meeting, setMeeting] = useState<MeetingData | null>(null);
  const [token, setToken] = useState<string>('');
  const [volume, setVolume] = useState<number>(85);
  const [isMuted, setIsMuted] = useState<boolean>(false);
  const [audioDevices, setAudioDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedOutputDevice, setSelectedOutputDevice] = useState<string>('default');
  const [autoScroll, setAutoScroll] = useState<boolean>(true);
  const [copied, setCopied] = useState<boolean>(false);
  const [isSwapping, setIsSwapping] = useState<boolean>(false);

  const transcriptionEndRef = useRef<HTMLDivElement>(null);
  const audioElementRef = useRef<HTMLAudioElement | null>(null);

  const serverUrl = import.meta.env.VITE_LIVEKIT_URL || 'ws://localhost:7880';

  // Buscar dados da reunião e telemetria com fallback imediato do localStorage para evitar tela preta
  const fetchMeetingData = async () => {
    try {
      const res = await fetch(`/api/meetings/${meetingId}`);
      const data = await res.json();
      if (data.meeting) {
        setMeeting(data.meeting);
        return;
      }
    } catch (e) {
      console.error('Erro ao buscar reunião na API:', e);
    }

    // Fallback imediato do localStorage
    try {
      const saved = JSON.parse(localStorage.getItem('brain_saved_meetings') || '[]');
      const found = saved.find((m: any) => m.id === meetingId);
      if (found) {
        setMeeting(found);
        return;
      }
    } catch (e) {}

    // Fallback padrão se não houver dados salvos
    setMeeting({
      id: meetingId,
      title: 'Sessão com Tradução Simultânea — ' + meetingId,
      currentMeetUrl: 'https://meet.google.com',
      scheduledNextMeetUrl: '',
      accountIds: ['acc-1', 'acc-2'],
      status: 'active',
      startedAt: new Date().toISOString(),
      nextSwapInSeconds: 120,
      totalDurationSeconds: 0,
      audioRoomName: meetingId,
      telemetry: {
        latencyMs: 140,
        jitterMs: 3.0,
        packetLossPct: 0.0,
        bitrateKbps: 128,
        networkQuality: 'excellent',
        audioLevelPct: 80,
        activeBotInstance: 'bot-pro-01'
      },
      transcriptions: []
    });
  };

  // Gerar token de áudio para o operador
  const fetchAudioToken = async (roomName: string) => {
    try {
      const res = await fetch('/api/get-audio-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roomName, identity: `operador-${meetingId}` })
      });
      const data = await res.json();
      if (data.token) {
        setToken(data.token);
      }
    } catch (e) {
      console.error('Erro ao gerar token LiveKit:', e);
    }
  };

  // Enumerar dispositivos de saída de áudio (alto-falantes, fones, cabos virtuais como VB-CABLE)
  const loadAudioDevices = async () => {
    try {
      if (navigator.mediaDevices && navigator.mediaDevices.enumerateDevices) {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const outputs = devices.filter(d => d.kind === 'audiooutput');
        setAudioDevices(outputs);
      }
    } catch (e) {
      console.warn('Não foi possível enumerar dispositivos de saída:', e);
    }
  };

  useEffect(() => {
    fetchMeetingData();
    loadAudioDevices();
    const interval = setInterval(fetchMeetingData, 2000);
    return () => clearInterval(interval);
  }, [meetingId]);

  useEffect(() => {
    if (meeting?.audioRoomName && !token) {
      fetchAudioToken(meeting.audioRoomName);
    }
  }, [meeting?.audioRoomName]);

  // Auto-scroll da transcrição
  useEffect(() => {
    if (autoScroll && transcriptionEndRef.current) {
      transcriptionEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [meeting?.transcriptions, autoScroll]);

  // Aplicar dispositivo de saída selecionado (HTMLMediaElement.setSinkId)
  const handleDeviceChange = async (deviceId: string) => {
    setSelectedOutputDevice(deviceId);
    const audioEl = document.querySelector('audio');
    if (audioEl && 'setSinkId' in audioEl) {
      try {
        // @ts-ignore
        await audioEl.setSinkId(deviceId);
        console.log(`Dispositivo de saída alterado para: ${deviceId}`);
      } catch (err) {
        console.error('Falha ao aplicar setSinkId:', err);
      }
    }
  };

  // Forçar Hot-Swap
  const handleTriggerSwap = async () => {
    setIsSwapping(true);
    try {
      await fetch(`/api/meetings/${meetingId}/swap`, { method: 'POST' });
      await fetchMeetingData();
    } catch (e) {
      alert('Erro ao disparar hot-swap.');
    } finally {
      setIsSwapping(false);
    }
  };

  // Copiar transcrição
  const handleCopyTranscription = () => {
    if (!meeting?.transcriptions) return;
    const text = meeting.transcriptions
      .map(t => `[${t.timestamp}] ${t.speaker} (${t.language}):\nOriginal: ${t.originalText}\nTraduzido: ${t.translatedText}\n`)
      .join('\n');
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const formatCountdown = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}m ${secs < 10 ? '0' : ''}${secs}s`;
  };

  if (!meeting) {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center text-white p-6">
        <div className="animate-spin rounded-full h-14 w-14 border-t-2 border-b-2 border-blue-500 mb-4" />
        <p className="text-slate-400 font-medium">Conectando à sessão da reunião {meetingId}...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 font-sans flex flex-col selection:bg-blue-500/30 selection:text-blue-200">
      
      {/* Elemento oculto do LiveKit para renderizar o áudio WebRTC se token existir */}
      {token && (
        <div className="hidden">
          <LiveKitRoom
            video={false}
            audio={true}
            token={token}
            serverUrl={serverUrl}
            connect={true}
          >
            <RoomAudioRenderer />
          </LiveKitRoom>
        </div>
      )}

      {/* Header da Reunião */}
      <header className="border-b border-slate-800 bg-slate-900/80 backdrop-blur-xl sticky top-0 z-30 px-6 py-4 flex flex-col md:flex-row items-center justify-between gap-4">
        <div className="flex items-center gap-3.5">
          <div className="w-10 h-10 rounded-xl bg-blue-600 flex items-center justify-center shadow-lg shadow-blue-500/20">
            <Radio className="w-5 h-5 text-white animate-pulse" />
          </div>
          <div>
            <div className="flex items-center gap-2.5">
              <h1 className="text-lg font-bold text-white tracking-tight">{meeting.title}</h1>
              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full flex items-center gap-1.5 ${
                meeting.status === 'transitioning' 
                  ? 'bg-amber-500/15 text-amber-400 border border-amber-500/30' 
                  : 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
              }`}>
                <span className={`w-1.5 h-1.5 rounded-full ${meeting.status === 'transitioning' ? 'bg-amber-400' : 'bg-emerald-400'} animate-ping`} />
                {meeting.status === 'transitioning' ? 'Transição em Andamento' : 'Transmissão Ao Vivo'}
              </span>
            </div>
            <p className="text-xs text-slate-400">ID da Reunião: <span className="font-mono text-slate-300">{meeting.id}</span></p>
          </div>
        </div>

        {/* Hot-Swap Countdown & Ações */}
        <div className="flex items-center gap-3">
          <div className="bg-slate-950 border border-slate-800 px-3.5 py-1.5 rounded-xl flex items-center gap-2 text-xs">
            <Clock className="w-3.5 h-3.5 text-blue-400" />
            <span className="text-slate-400">Próximo Hot-Swap:</span>
            <strong className="text-blue-400 font-mono">{formatCountdown(meeting.nextSwapInSeconds)}</strong>
          </div>

          <button
            onClick={handleTriggerSwap}
            disabled={isSwapping}
            className="text-xs font-semibold text-amber-400 hover:text-amber-300 bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/20 px-3.5 py-2 rounded-xl transition-all cursor-pointer"
          >
            {isSwapping ? 'Executando Swap...' : 'Forçar Hot-Swap Agora'}
          </button>

          <a
            href={meeting.currentMeetUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-300 hover:text-white bg-slate-900 hover:bg-slate-800 border border-slate-800 px-3.5 py-2 rounded-xl transition-all"
          >
            <span>Abrir no Google Meet</span>
            <ExternalLink className="w-3.5 h-3.5" />
          </a>
        </div>
      </header>

      {/* Grid Principal do Monitor */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-6 grid grid-cols-1 lg:grid-cols-12 gap-6">

        {/* ========================================================
            COLUNA ESQUERDA: HUB DE SAÍDA DE ÁUDIO TRADUZIDO (O MAIS IMPORTANTE)
            ======================================================== */}
        <div className="lg:col-span-5 flex flex-col gap-6">
          
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-xl relative overflow-hidden flex flex-col justify-between">
            <div className="absolute top-0 right-0 w-36 h-36 bg-blue-500/10 rounded-full blur-2xl pointer-events-none" />

            <div>
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-lg bg-blue-500/10 text-blue-400 flex items-center justify-center border border-blue-500/20">
                    <Volume2 className="w-4 h-4 animate-pulse" />
                  </div>
                  <div>
                    <h2 className="text-base font-bold text-white">Hub de Saída de Áudio Traduzido</h2>
                    <p className="text-[11px] text-slate-400">Controle total da trilha de áudio recebida</p>
                  </div>
                </div>
                <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                  Opus 128kbps
                </span>
              </div>

              {/* Visualizador de Ondas Sonoras / Audio Spectrum */}
              <div className="bg-slate-950 border border-slate-850 rounded-2xl p-6 mb-6 flex flex-col items-center justify-center text-center relative overflow-hidden">
                <div className="flex items-end justify-center gap-1.5 h-20 w-full mb-3">
                  {[45, 80, 60, 95, 30, 75, 90, 65, 85, 40, 70, 100, 55, 80, 60, 90, 50, 75].map((h, i) => {
                    const dynamicHeight = Math.max(12, Math.round((h * (meeting.telemetry.audioLevelPct / 100))));
                    return (
                      <div
                        key={i}
                        className="w-1.5 bg-gradient-to-t from-blue-600 via-cyan-400 to-indigo-400 rounded-full transition-all duration-150"
                        style={{ height: `${dynamicHeight}%` }}
                      />
                    );
                  })}
                </div>
                <div className="flex items-center gap-2 text-xs font-semibold text-slate-300">
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                  Áudio Traduzido em Tempo Real
                </div>
                <p className="text-[11px] text-slate-500 mt-0.5">Latência de ponta a ponta: <strong className="text-blue-400">{meeting.telemetry.latencyMs}ms</strong></p>
              </div>

              {/* Controle de Volume Master */}
              <div className="space-y-4 mb-6">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-slate-300">Volume de Saída (Master)</span>
                  <span className="font-mono text-blue-400">{isMuted ? 'MUDO' : `${volume}%`}</span>
                </div>
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => setIsMuted(!isMuted)}
                    className="p-2 rounded-xl bg-slate-950 border border-slate-800 text-slate-400 hover:text-white hover:border-slate-700 transition-colors"
                  >
                    {isMuted || volume === 0 ? <VolumeX className="w-4 h-4 text-rose-400" /> : <Volume2 className="w-4 h-4 text-blue-400" />}
                  </button>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={isMuted ? 0 : volume}
                    onChange={e => {
                      setVolume(Number(e.target.value));
                      if (isMuted) setIsMuted(false);
                    }}
                    className="flex-1 accent-blue-500 h-2 bg-slate-950 rounded-lg cursor-pointer"
                  />
                </div>
              </div>

              {/* Seletor de Dispositivo de Saída (Para Mesa de Som / Virtual Cable / OBS) */}
              <div className="space-y-2 mb-4">
                <label className="block text-xs font-semibold text-slate-300">
                  Roteamento de Saída de Áudio (Dispositivo Físico ou Cabo Virtual)
                </label>
                <select
                  value={selectedOutputDevice}
                  onChange={e => handleDeviceChange(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 focus:border-blue-500 rounded-xl px-3 py-2.5 text-xs text-slate-200 outline-none transition-all"
                >
                  <option value="default">Dispositivo de Áudio Padrão do Sistema</option>
                  {audioDevices.map(d => (
                    <option key={d.deviceId} value={d.deviceId}>
                      {d.label || `Saída de Áudio (${d.deviceId.slice(0, 8)})`}
                    </option>
                  ))}
                </select>
                <p className="text-[11px] text-slate-500">
                  Você pode selecionar sua placa de som, fone ou um cabo virtual (como VB-CABLE) para injetar o áudio na mesa de som física ou no OBS.
                </p>
              </div>

            </div>

            <div className="pt-4 border-t border-slate-800 text-xs text-slate-400 flex items-center justify-between">
              <span>Bitrate: <strong>128 kbps (48kHz)</strong></span>
              <span>Canal: <strong>Stereo / WebRTC</strong></span>
            </div>

          </div>

          {/* Card de Diagnóstico e Telemetria de Rede */}
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-xl">
            <h3 className="text-sm font-bold text-white flex items-center gap-2 mb-4">
              <Wifi className="w-4 h-4 text-emerald-400" />
              Telemetria de Rede & Estabilidade
            </h3>

            <div className="grid grid-cols-2 gap-3 text-xs">
              <div className="bg-slate-950 border border-slate-850 p-3 rounded-xl">
                <span className="text-slate-500 block mb-1">Latência RTT</span>
                <span className="font-bold text-emerald-400 text-sm font-mono">{meeting.telemetry.latencyMs} ms</span>
              </div>
              <div className="bg-slate-950 border border-slate-850 p-3 rounded-xl">
                <span className="text-slate-500 block mb-1">Jitter de Áudio</span>
                <span className="font-bold text-slate-200 text-sm font-mono">{meeting.telemetry.jitterMs} ms</span>
              </div>
              <div className="bg-slate-950 border border-slate-850 p-3 rounded-xl">
                <span className="text-slate-500 block mb-1">Perda de Pacotes</span>
                <span className="font-bold text-emerald-400 text-sm font-mono">{meeting.telemetry.packetLossPct}%</span>
              </div>
              <div className="bg-slate-950 border border-slate-850 p-3 rounded-xl">
                <span className="text-slate-500 block mb-1">Robô Ativo</span>
                <span className="font-bold text-blue-400 text-xs truncate block font-mono">{meeting.telemetry.activeBotInstance}</span>
              </div>
            </div>
          </div>

        </div>

        {/* ========================================================
            COLUNA DIREITA: TRANSCRIÇÃO EM TEMPO REAL
            ======================================================== */}
        <div className="lg:col-span-7 flex flex-col bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-xl min-h-[500px]">
          
          {/* Header da Transcrição */}
          <div className="flex items-center justify-between border-b border-slate-800 pb-4 mb-4">
            <div>
              <h2 className="text-base font-bold text-white flex items-center gap-2">
                <Mic className="w-4 h-4 text-blue-400" />
                Transcrição & Legendas em Tempo Real
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">Captura simultânea do que está sendo dito e traduzido</p>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={() => setAutoScroll(!autoScroll)}
                className={`text-[11px] font-semibold px-2.5 py-1.5 rounded-lg border transition-all ${
                  autoScroll 
                    ? 'bg-blue-500/10 text-blue-400 border-blue-500/20' 
                    : 'bg-slate-800 text-slate-400 border-slate-700'
                }`}
              >
                Auto-Scroll: {autoScroll ? 'ON' : 'OFF'}
              </button>

              <button
                onClick={handleCopyTranscription}
                className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 border border-slate-700 px-3 py-1.5 rounded-lg transition-all"
              >
                {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copied ? 'Copiado!' : 'Copiar'}</span>
              </button>
            </div>
          </div>

          {/* Feed de Transcrição */}
          <div className="flex-1 bg-slate-950 border border-slate-850 rounded-2xl p-4 overflow-y-auto space-y-4 max-h-[550px] scrollbar-thin scrollbar-thumb-slate-800">
            {meeting.transcriptions.length === 0 ? (
              <div className="text-center py-20 text-slate-600 text-xs">
                Aguardando início das falas na reunião...
              </div>
            ) : (
              meeting.transcriptions.map(item => (
                <div key={item.id} className="p-3.5 rounded-xl bg-slate-900/60 border border-slate-800/80 space-y-1.5">
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="font-bold text-blue-400">{item.speaker}</span>
                    <div className="flex items-center gap-2 text-slate-500">
                      <span className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 font-mono text-[10px]">{item.language}</span>
                      <span>{item.timestamp}</span>
                    </div>
                  </div>
                  
                  {/* Texto Traduzido em Destaque */}
                  <div className="text-sm font-medium text-slate-100 leading-relaxed">
                    {item.translatedText}
                  </div>

                  {/* Texto Original */}
                  {item.originalText && (
                    <div className="text-xs text-slate-500 italic">
                      Original: "{item.originalText}"
                    </div>
                  )}
                </div>
              ))
            )}
            <div ref={transcriptionEndRef} />
          </div>

        </div>

      </main>

    </div>
  );
}
