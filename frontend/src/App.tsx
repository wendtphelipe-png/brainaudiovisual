import { useState, useEffect } from 'react';
import { 
  LiveKitRoom, 
  RoomAudioRenderer,
  useConnectionState,
  useTracks
} from '@livekit/components-react';
import { ConnectionState, Track } from 'livekit-client';
import { Play, Square, Volume2, VolumeX, Activity, AlertCircle } from 'lucide-react';
import '@livekit/components-styles';

// URLs devem vir do .env
const serverUrl = 'ws://localhost:7880';
// Em produção, o token deve ser gerado pelo seu backend para cada aluno.
// Para testarmos, vamos colocar uma variável simulada ou você deve injetar.
const devToken = ''; // DEIXAR VAZIO E MOSTRAR ERRO SE NÃO TIVER

export default function App() {
  const [token, setToken] = useState<string>(devToken);
  const [roomName, setRoomName] = useState<string>('evento-01');

  // Pega parâmetros da URL (ex: ?room=evento-01&token=xyz)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const urlToken = params.get('token');
    const urlRoom = params.get('room');
    if (urlToken) setToken(urlToken);
    if (urlRoom) setRoomName(urlRoom);
  }, []);

  if (token === '') {
    return (
      <div className="flex flex-col items-center justify-center h-screen p-6 bg-background text-center">
        <div className="bg-surface p-8 rounded-3xl shadow-2xl border border-slate-700 max-w-sm w-full">
          <AlertCircle className="w-16 h-16 text-rose-500 mx-auto mb-4" />
          <h1 className="text-2xl font-bold mb-2">Acesso Inválido</h1>
          <p className="text-slate-400 text-sm">
            Nenhum token de acesso foi encontrado. Escaneie o QR Code oficial do evento para entrar.
          </p>
        </div>
      </div>
    );
  }

  return (
    <LiveKitRoom
      video={false}
      audio={false}
      token={token}
      serverUrl={serverUrl}
      connect={true}
      className="h-screen w-screen bg-background"
    >
      {/* Esse componente renderiza as faixas de áudio recebidas invisivelmente */}
      <RoomAudioRenderer />
      
      <PlayerInterface roomName={roomName} />
    </LiveKitRoom>
  );
}

function PlayerInterface({ roomName }: { roomName: string }) {
  const connectionState = useConnectionState();
  const tracks = useTracks([Track.Source.Microphone, Track.Source.ScreenShareAudio]);
  
  // Status de UI baseado na conexão
  const isConnected = connectionState === ConnectionState.Connected;
  const isConnecting = connectionState === ConnectionState.Connecting;
  
  // Verifica se há alguma faixa de áudio ativa sendo recebida
  const isReceivingAudio = tracks.length > 0;

  return (
    <div className="flex flex-col h-full items-center justify-between p-6 sm:p-12">
      
      {/* Header */}
      <header className="w-full max-w-md flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wider">Tradução ao Vivo</h2>
          <h1 className="text-xl font-bold text-white truncate">{roomName}</h1>
        </div>
        <div className={`px-3 py-1 rounded-full text-xs font-bold flex items-center gap-2 ${
          isConnected ? 'bg-emerald-500/20 text-emerald-400' : 'bg-rose-500/20 text-rose-400'
        }`}>
          <div className={`w-2 h-2 rounded-full ${isConnected ? 'bg-emerald-400 animate-pulse' : 'bg-rose-400'}`} />
          {isConnected ? 'Conectado' : isConnecting ? 'Conectando...' : 'Desconectado'}
        </div>
      </header>

      {/* Main Center UI - Visualizer / Play Button */}
      <main className="flex-1 flex flex-col items-center justify-center w-full">
        
        {/* Círculo animado */}
        <div className="relative group">
          <div className={`absolute inset-0 rounded-full blur-3xl opacity-50 transition-all duration-1000 ${
            isConnected && isReceivingAudio ? 'bg-primary scale-150 animate-pulse' : 'bg-slate-700 scale-100'
          }`} />
          
          <div className="relative z-10 w-48 h-48 sm:w-64 sm:h-64 rounded-full bg-surface border border-slate-700 flex flex-col items-center justify-center shadow-2xl transition-transform hover:scale-105">
             {isConnected ? (
                isReceivingAudio ? (
                  <>
                    <Activity className="w-16 h-16 text-primary mb-2 animate-bounce" />
                    <p className="text-lg font-bold">Ouvindo</p>
                    <p className="text-xs text-slate-400">Áudio em tempo real</p>
                  </>
                ) : (
                  <>
                    <VolumeX className="w-16 h-16 text-slate-500 mb-2" />
                    <p className="text-lg font-bold text-slate-300">Aguardando</p>
                    <p className="text-xs text-slate-500">Nenhum áudio detectado</p>
                  </>
                )
             ) : (
                <div className="animate-spin rounded-full h-16 w-16 border-t-2 border-b-2 border-primary" />
             )}
          </div>
        </div>

      </main>

      {/* Controls Footer */}
      <footer className="w-full max-w-md bg-surface/50 backdrop-blur-xl border border-slate-700 p-6 rounded-3xl flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-full bg-primary/20 text-primary flex items-center justify-center">
             <Volume2 className="w-6 h-6" />
          </div>
          <div>
            <p className="font-semibold">Volume</p>
            <p className="text-xs text-slate-400">Controlado pelo sistema</p>
          </div>
        </div>
        
        {/* Placeholder para botão de Stop/Play manual do WebRTC se necessário */}
      </footer>

    </div>
  );
}
