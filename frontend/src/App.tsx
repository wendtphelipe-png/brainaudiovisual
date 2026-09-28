import { useState, useEffect, useRef } from 'react';
import { 
  LiveKitRoom, 
  RoomAudioRenderer,
  useConnectionState,
  useTracks
} from '@livekit/components-react';
import { ConnectionState, Track } from 'livekit-client';
import { 
  Volume2, VolumeX, Activity, AlertCircle, Play, Square, 
  RefreshCw, Calendar as CalendarIcon, CheckCircle2, 
  AlertTriangle, ExternalLink, Settings, Terminal, Radio, ShieldAlert
} from 'lucide-react';
// @ts-ignore
import '@livekit/components-styles';

// URLs devem vir do .env ou fallback
const serverUrl = import.meta.env.VITE_LIVEKIT_URL || 'ws://localhost:7880';
const devToken = '';

export default function App() {
  const [isAdmin, setIsAdmin] = useState<boolean>(false);
  const [token, setToken] = useState<string>(devToken);
  const [roomName, setRoomName] = useState<string>('evento-01');

  // Pega parâmetros da URL (ex: ?room=evento-01&token=xyz&admin=true)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const urlToken = params.get('token');
    const urlRoom = params.get('room') || 'evento-01';
    const isUrlAdmin = params.get('admin') === 'true';
    
    setRoomName(urlRoom);
    setIsAdmin(isUrlAdmin);

    if (isUrlAdmin) {
      // Admin não precisa carregar LiveKitRoom na página principal
      return;
    }

    if (urlToken) {
      setToken(urlToken);
    } else {
      // Se não tem token na URL, pede pro backend gerar um na hora!
      fetch('/api/get-student-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roomName: urlRoom })
      })
      .then(r => r.json())
      .then(data => {
        if (data.token) setToken(data.token);
      })
      .catch(console.error);
    }
  }, []);

  if (isAdmin) {
    return <AdminDashboard />;
  }

  if (token === '') {
    return (
      <div className="flex flex-col items-center justify-center h-screen p-6 bg-slate-950 text-center">
        <div className="animate-spin rounded-full h-16 w-16 border-t-2 border-b-2 border-blue-500" />
        <p className="mt-4 text-slate-400 font-medium">Gerando ingresso de áudio...</p>
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
      className="h-screen w-screen bg-slate-950 text-white"
    >
      <RoomAudioRenderer />
      <PlayerInterface roomName={roomName} />
    </LiveKitRoom>
  );
}

// ---------------------------------------------------------
// COMPONENTE: PLAYER DO ALUNO (STUDENT AUDIO PLAYER)
// ---------------------------------------------------------
function PlayerInterface({ roomName }: { roomName: string }) {
  const connectionState = useConnectionState();
  const tracks = useTracks([Track.Source.Microphone, Track.Source.ScreenShareAudio]);
  
  const isConnected = connectionState === ConnectionState.Connected;
  const isConnecting = connectionState === ConnectionState.Connecting;
  const isReceivingAudio = tracks.length > 0;

  return (
    <div className="flex flex-col h-full items-center justify-between p-6 sm:p-12 bg-slate-950 text-white">
      
      {/* Header */}
      <header className="w-full max-w-md flex items-center justify-between">
        <div>
          <h2 className="text-xs font-semibold text-blue-400 uppercase tracking-widest">Tradução ao Vivo</h2>
          <h1 className="text-xl font-bold text-white truncate max-w-[200px]">{roomName}</h1>
        </div>
        <div className={`px-3 py-1.5 rounded-full text-xs font-bold flex items-center gap-2 transition-all duration-300 ${
          isConnected ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' : 'bg-rose-500/20 text-rose-400 border border-rose-500/30'
        }`}>
          <div className={`w-2.5 h-2.5 rounded-full ${isConnected ? 'bg-emerald-400 animate-pulse' : 'bg-rose-400'}`} />
          {isConnected ? 'Ao Vivo' : isConnecting ? 'Conectando...' : 'Desconectado'}
        </div>
      </header>

      {/* Main Center UI - Visualizer / Play Button */}
      <main className="flex-1 flex flex-col items-center justify-center w-full">
        <div className="relative group">
          <div className={`absolute inset-0 rounded-full blur-3xl opacity-30 transition-all duration-1000 ${
            isConnected && isReceivingAudio ? 'bg-blue-500 scale-150 animate-pulse' : 'bg-slate-800 scale-100'
          }`} />
          
          <div className="relative z-10 w-52 h-52 sm:w-64 sm:h-64 rounded-full bg-slate-900 border border-slate-800 flex flex-col items-center justify-center shadow-2xl transition-transform duration-500 hover:scale-105">
             {isConnected ? (
                isReceivingAudio ? (
                  <>
                    <Activity className="w-16 h-16 text-blue-400 mb-3 animate-bounce" />
                    <p className="text-lg font-bold text-white tracking-wide">Ouvindo...</p>
                    <p className="text-xs text-slate-400 mt-1">Áudio original traduzido</p>
                  </>
                ) : (
                  <>
                    <VolumeX className="w-16 h-16 text-slate-600 mb-3" />
                    <p className="text-lg font-bold text-slate-400">Aguardando áudio</p>
                    <p className="text-xs text-slate-500 mt-1">O tradutor ainda não iniciou</p>
                  </>
                )
             ) : (
                <div className="flex flex-col items-center">
                  <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-blue-500 mb-3" />
                  <p className="text-sm font-semibold text-slate-400">Reconectando canal...</p>
                </div>
             )}
          </div>
        </div>
      </main>

      {/* Controls Footer */}
      <footer className="w-full max-w-md bg-slate-900/80 backdrop-blur-xl border border-slate-800 p-5 rounded-3xl flex items-center justify-between shadow-lg">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-full bg-blue-500/10 text-blue-400 flex items-center justify-center">
             <Volume2 className="w-6 h-6 animate-pulse" />
          </div>
          <div>
            <p className="font-semibold text-sm text-slate-200">Áudio do Estudante</p>
            <p className="text-xs text-slate-400">Use os botões de volume do seu celular</p>
          </div>
        </div>
      </footer>

    </div>
  );
}

// ---------------------------------------------------------
// COMPONENTE: ADMIN DASHBOARD (PAINEL DO ADMINISTRADOR)
// ---------------------------------------------------------
interface BotInstanceStatus {
  id: string;
  meetUrl: string;
  status: 'connecting' | 'active' | 'closing' | 'error';
  startedAt: string;
}

interface CalendarStatus {
  connected: boolean;
  autoSync: boolean;
  upcoming: Array<{
    id: string;
    summary: string;
    start: string;
    end: string;
    meetLink: string | null;
    isActive: boolean;
  }>;
}

function AdminDashboard() {
  const [meetUrl, setMeetUrl] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [activeBot, setActiveBot] = useState<BotInstanceStatus | null>(null);
  const [transitionBot, setTransitionBot] = useState<BotInstanceStatus | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [calendar, setCalendar] = useState<CalendarStatus>({
    connected: false,
    autoSync: false,
    upcoming: []
  });
  
  const logTerminalRef = useRef<HTMLDivElement>(null);

  // Busca o status do orquestrador de bots e do calendário
  const fetchStatus = async () => {
    try {
      const resBot = await fetch('/api/bot/status');
      const dataBot = await resBot.json();
      setActiveBot(dataBot.activeBot);
      setTransitionBot(dataBot.transitionBot);
      setLogs(dataBot.logs || []);

      const resCal = await fetch('/api/calendar/status');
      const dataCal = await resCal.json();
      setCalendar(dataCal);
    } catch (e) {
      console.error('Erro ao buscar status do servidor:', e);
    }
  };

  // Efeito de polling para sincronizar o status em tempo real a cada 2.5s
  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, 2500);
    return () => clearInterval(interval);
  }, []);

  // Auto-scroll para os logs mais novos no terminal
  useEffect(() => {
    if (logTerminalRef.current) {
      logTerminalRef.current.scrollTop = 0; // Logs mais novos estão no topo (unshifted)
    }
  }, [logs]);

  // Função para enviar o bot manualmente para uma reunião
  const handleStartBot = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!meetUrl.includes('meet.google.com')) {
      alert('Por favor, insira uma URL válida do Google Meet.');
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await fetch('/api/start-bot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ meetUrl })
      });
      const data = await res.json();
      if (data.error) {
        alert(data.error);
      } else {
        setMeetUrl('');
        fetchStatus();
      }
    } catch (err) {
      alert('Falha ao se conectar com o servidor.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Parar todos os robôs
  const handleStopAll = async () => {
    if (!confirm('Deseja interromper e fechar todos os robôs tradutores ativos?')) return;
    try {
      await fetch('/api/stop-bot', { method: 'POST' });
      fetchStatus();
    } catch (err) {
      alert('Erro ao interromper robôs.');
    }
  };

  // Alternar sincronização automática do calendário
  const handleToggleAutoSync = async () => {
    try {
      const res = await fetch('/api/calendar/toggle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enable: !calendar.autoSync })
      });
      const data = await res.json();
      setCalendar(prev => ({ ...prev, autoSync: data.autoSync }));
      fetchStatus();
    } catch (err) {
      alert('Erro ao alternar sincronização.');
    }
  };

  // Forçar sincronização manual imediata do calendário
  const handleSyncCalendarNow = async () => {
    try {
      const res = await fetch('/api/calendar/sync-now', { method: 'POST' });
      const data = await res.json();
      if (data.error) {
        alert(data.error);
      } else {
        alert(data.activeMeetUrl 
          ? `Sincronização completa! Nova reunião ativa disparada: ${data.activeMeetUrl}`
          : 'Calendário sincronizado. Nenhuma nova reunião ativa agendada para este momento.'
        );
        fetchStatus();
      }
    } catch (err) {
      alert('Erro ao sincronizar calendário.');
    }
  };

  // Iniciar fluxo Google OAuth2
  const handleOAuthConnect = async () => {
    try {
      const res = await fetch('/api/oauth/url');
      const data = await res.json();
      if (data.url) {
        window.location.href = data.url;
      } else {
        alert('Erro ao carregar URL do consent screen.');
      }
    } catch (err) {
      alert('Erro de conexão ao obter link do Google OAuth.');
    }
  };

  // Formatar tempo de início
  const formatTime = (isoString: string) => {
    try {
      return new Date(isoString).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    } catch (e) {
      return '';
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-white font-sans flex flex-col selection:bg-blue-500/30 selection:text-blue-200">
      
      {/* Header do Painel */}
      <header className="border-b border-slate-800 bg-slate-900/50 backdrop-blur-md sticky top-0 z-30 px-6 py-4 flex flex-col sm:flex-row items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-blue-600 flex items-center justify-center shadow-lg shadow-blue-500/20">
            <Radio className="w-6 h-6 animate-pulse" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight bg-gradient-to-r from-white to-slate-400 bg-clip-text text-transparent">BrainLingo</h1>
            <p className="text-xs text-slate-500 font-medium">Orquestrador e Hot-Swap de Reuniões</p>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-xs text-slate-400 flex items-center gap-1.5 bg-slate-800 border border-slate-700 px-3 py-1.5 rounded-lg">
            <Settings className="w-3.5 h-3.5" />
            Modo Administrativo
          </span>
          <button 
            onClick={() => window.location.href = '/'}
            className="text-xs bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold px-4 py-2 rounded-lg transition-colors border border-slate-700 hover:text-white"
          >
            Visualizar Aluno
          </button>
        </div>
      </header>

      {/* Conteúdo Principal */}
      <main className="flex-1 p-6 grid grid-cols-1 lg:grid-cols-12 gap-6 max-w-7xl w-full mx-auto">
        
        {/* COLUNA ESQUERDA: Status e Controle do Bot (7/12) */}
        <div className="lg:col-span-7 flex flex-col gap-6">
          
          {/* Card de Status do Bot Tradutor */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 relative overflow-hidden shadow-xl">
            {/* Efeitos de gradiente ao fundo */}
            <div className="absolute top-0 right-0 w-32 h-32 bg-blue-500/5 rounded-full blur-3xl pointer-events-none" />
            
            <div className="flex items-center justify-between border-b border-slate-800 pb-4 mb-5">
              <h2 className="text-md font-bold flex items-center gap-2">
                <Radio className="w-5 h-5 text-blue-500" />
                Status do Tradutor Headless
              </h2>
              {activeBot ? (
                <span className={`px-2.5 py-1 rounded-full text-xs font-black uppercase flex items-center gap-1.5 animate-pulse ${
                  activeBot.status === 'active' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30' : 'bg-amber-500/10 text-amber-400 border border-amber-500/30'
                }`}>
                  <span className={`w-1.5 h-1.5 rounded-full ${activeBot.status === 'active' ? 'bg-emerald-400' : 'bg-amber-400'}`} />
                  {activeBot.status === 'active' ? 'Live' : 'Entrando...'}
                </span>
              ) : (
                <span className="px-2.5 py-1 rounded-full text-xs font-bold bg-slate-800 text-slate-500 border border-slate-700">
                  Offline
                </span>
              )}
            </div>

            {/* Informações da Reunião Ativa */}
            {activeBot ? (
              <div className="space-y-4">
                <div className="bg-slate-950 border border-slate-850 p-4 rounded-xl">
                  <div className="flex justify-between items-center mb-1">
                    <span className="text-xs font-medium text-slate-500">Google Meet Ativo</span>
                    <span className="text-xs text-slate-600 font-mono">ID: {activeBot.id}</span>
                  </div>
                  <a 
                    href={activeBot.meetUrl} 
                    target="_blank" 
                    rel="noreferrer" 
                    className="text-sm font-bold text-blue-400 hover:text-blue-300 hover:underline flex items-center gap-1 break-all"
                  >
                    {activeBot.meetUrl}
                    <ExternalLink className="w-3.5 h-3.5 flex-shrink-0" />
                  </a>
                  <div className="mt-2 text-xs text-slate-500 flex items-center gap-1">
                    Iniciado às: {new Date(activeBot.startedAt).toLocaleTimeString('pt-BR')}
                  </div>
                </div>

                {/* Se houver transição hot-swap rodando em background */}
                {transitionBot && (
                  <div className="bg-amber-500/5 border border-amber-500/20 p-4 rounded-xl animate-pulse">
                    <div className="flex justify-between items-center mb-1 text-amber-400">
                      <span className="text-xs font-bold flex items-center gap-1.5">
                        <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                        🔄 Troca em Andamento (Hot-Swap)...
                      </span>
                      <span className="text-[10px] text-amber-500 font-mono">ID: {transitionBot.id}</span>
                    </div>
                    <p className="text-xs text-slate-300 font-semibold truncate break-all mb-2">
                      Conectando à nova sala: <span className="text-blue-400 font-normal">{transitionBot.meetUrl}</span>
                    </p>
                    <div className="w-full bg-slate-800 h-1.5 rounded-full overflow-hidden">
                      <div className="bg-amber-500 h-full w-2/3 rounded-full animate-pulse" />
                    </div>
                    <p className="text-[10px] text-slate-500 mt-2">
                      Mantendo overlap de áudio ativo no bot anterior para transição suave sem interrupções.
                    </p>
                  </div>
                )}

                <div className="flex gap-3 mt-4">
                  <button 
                    onClick={handleStopAll}
                    className="flex-1 bg-rose-600/10 hover:bg-rose-600 text-rose-400 hover:text-white border border-rose-500/20 py-2.5 rounded-xl font-bold text-sm transition-all flex items-center justify-center gap-2"
                  >
                    <Square className="w-4 h-4" />
                    Desligar Tradutor
                  </button>
                </div>
              </div>
            ) : (
              <div className="py-8 flex flex-col items-center justify-center text-center">
                <div className="w-16 h-16 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center text-slate-500 mb-3 shadow-inner">
                  <VolumeX className="w-8 h-8" />
                </div>
                <p className="text-sm font-bold text-slate-300">Nenhum robô tradutor ativo</p>
                <p className="text-xs text-slate-500 mt-1 max-w-[280px]">
                  Cole o link de uma reunião do Meet abaixo ou ative a sincronização do Google Calendar.
                </p>
              </div>
            )}
          </div>

          {/* Card de Controle Manual (Entrada de URL) */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl">
            <h2 className="text-md font-bold flex items-center gap-2 mb-4 border-b border-slate-800 pb-3">
              <Play className="w-5 h-5 text-blue-500" />
              Trocar Reunião Manualmente (Hot-Swap)
            </h2>
            <form onSubmit={handleStartBot} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">
                  Link do Google Meet
                </label>
                <input 
                  type="text" 
                  value={meetUrl}
                  onChange={(e) => setMeetUrl(e.target.value)}
                  placeholder="https://meet.google.com/abc-defg-hij"
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-blue-500 transition-colors placeholder:text-slate-700 text-white font-medium"
                  required
                />
              </div>
              <button 
                type="submit"
                disabled={isSubmitting}
                className="w-full bg-blue-600 hover:bg-blue-500 disabled:bg-blue-800 text-white py-3 rounded-xl font-bold text-sm shadow-lg shadow-blue-500/10 transition-colors flex items-center justify-center gap-2"
              >
                {isSubmitting ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    Buscando Sala no Meet...
                  </>
                ) : (
                  <>
                    <Radio className="w-4 h-4" />
                    {activeBot ? 'Iniciar Hot-Swap Suave' : 'Iniciar Robô Tradutor'}
                  </>
                )}
              </button>
            </form>
          </div>

        </div>

        {/* COLUNA DIREITA: Google Calendar e Terminal de Logs (5/12) */}
        <div className="lg:col-span-5 flex flex-col gap-6">
          
          {/* Card de Automação com Google Calendar */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-800 pb-4 mb-4">
              <h2 className="text-md font-bold flex items-center gap-2">
                <CalendarIcon className="w-5 h-5 text-blue-500" />
                Google Calendar Sync
              </h2>
              {calendar.connected ? (
                <span className="text-[10px] bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-2 py-0.5 rounded-full font-bold flex items-center gap-1">
                  <CheckCircle2 className="w-3 h-3" /> Conectado
                </span>
              ) : (
                <span className="text-[10px] bg-rose-500/10 text-rose-400 border border-rose-500/20 px-2 py-0.5 rounded-full font-bold flex items-center gap-1">
                  <AlertCircle className="w-3 h-3" /> Ausente
                </span>
              )}
            </div>

            {/* Conteúdo Calendar */}
            {calendar.connected ? (
              <div className="space-y-4">
                
                {/* Switch de Auto-Sync elegante */}
                <div className="flex items-center justify-between bg-slate-950 p-3.5 border border-slate-850 rounded-xl">
                  <div>
                    <p className="text-xs font-bold text-slate-200">Sincronização Automática</p>
                    <p className="text-[10px] text-slate-500 mt-0.5">Troca de bot programada por eventos</p>
                  </div>
                  <button 
                    onClick={handleToggleAutoSync}
                    className={`w-12 h-6.5 rounded-full p-1 transition-colors duration-300 focus:outline-none flex items-center ${
                      calendar.autoSync ? 'bg-blue-600 justify-end' : 'bg-slate-800 justify-start'
                    }`}
                  >
                    <div className="w-4.5 h-4.5 rounded-full bg-white shadow-md transition-transform duration-300" />
                  </button>
                </div>

                {/* Forçar verificação agora */}
                <button 
                  onClick={handleSyncCalendarNow}
                  className="w-full bg-slate-950 hover:bg-slate-800 border border-slate-800 py-2.5 rounded-xl text-xs font-bold flex items-center justify-center gap-2 transition-all"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  Sincronizar Calendário Agora
                </button>

                {/* Próximas Reuniões */}
                <div>
                  <h3 className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-3">Próximos Eventos do Dia</h3>
                  
                  {calendar.upcoming && calendar.upcoming.length > 0 ? (
                    <div className="space-y-2 max-h-36 overflow-y-auto">
                      {calendar.upcoming.map((ev) => (
                        <div 
                          key={ev.id} 
                          className={`p-3 rounded-xl border transition-all text-left ${
                            ev.isActive 
                              ? 'bg-blue-500/10 border-blue-500/30' 
                              : 'bg-slate-950/80 border-slate-900 hover:border-slate-800'
                          }`}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <span className="text-xs font-bold truncate max-w-[170px]">{ev.summary}</span>
                            <span className="text-[9px] bg-slate-800 border border-slate-700 px-2 py-0.5 rounded font-mono font-medium whitespace-nowrap text-slate-400">
                              {formatTime(ev.start)} - {formatTime(ev.end)}
                            </span>
                          </div>
                          {ev.meetLink && (
                            <div className="mt-2 flex items-center justify-between">
                              <span className="text-[10px] text-blue-400 font-mono truncate max-w-[180px]">{ev.meetLink}</span>
                              {ev.isActive && (
                                <span className="text-[9px] bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-1.5 py-0.5 rounded font-black uppercase tracking-wider animate-pulse flex items-center gap-1">
                                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" /> Ativo
                                </span>
                              )}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-slate-600 text-center py-4">Nenhum evento do Meet agendado hoje.</p>
                  )}
                </div>

              </div>
            ) : (
              <div className="py-6 flex flex-col items-center justify-center text-center">
                <div className="w-12 h-12 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-500 mb-3">
                  <ShieldAlert className="w-6 h-6" />
                </div>
                <p className="text-xs font-bold text-slate-300">Conexão Necessária</p>
                <p className="text-[11px] text-slate-500 mt-1 max-w-[260px] mb-4">
                  Sincronize sua conta Google Calendar para permitir que o bot detecte reuniões ativas e efetue as trocas de forma 100% autônoma.
                </p>
                <button 
                  onClick={handleOAuthConnect}
                  className="bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs px-5 py-2.5 rounded-xl flex items-center gap-2 transition-colors shadow-lg shadow-blue-500/10"
                >
                  <CalendarIcon className="w-4 h-4" />
                  Conectar Conta Google
                </button>
              </div>
            )}
          </div>

          {/* Terminal de Logs do Sistema em Tempo Real */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl flex-1 flex flex-col min-h-[300px]">
            <h2 className="text-md font-bold flex items-center gap-2 mb-4 border-b border-slate-800 pb-3">
              <Terminal className="w-5 h-5 text-blue-500" />
              Logs do Orquestrador
            </h2>
            <div 
              ref={logTerminalRef}
              className="bg-slate-950 border border-slate-850 p-4 rounded-xl flex-1 font-mono text-[11px] text-slate-400 overflow-y-auto space-y-2 scrollbar-thin scrollbar-thumb-slate-800"
            >
              {logs.length > 0 ? (
                logs.map((log, index) => {
                  let logColor = 'text-slate-400';
                  if (log.includes('✅') || log.includes('sucesso') || log.includes('completa!')) logColor = 'text-emerald-400 font-semibold';
                  else if (log.includes('❌') || log.includes('Falha') || log.includes('Erro')) logColor = 'text-rose-400 font-semibold';
                  else if (log.includes('🔄') || log.includes('swap') || log.includes('transição')) logColor = 'text-amber-400';
                  
                  return (
                    <div key={index} className={`leading-relaxed border-b border-slate-900/50 pb-1 ${logColor}`}>
                      {log}
                    </div>
                  );
                })
              ) : (
                <div className="text-slate-600 text-center py-12">Aguardando eventos do sistema...</div>
              )}
            </div>
          </div>

        </div>

      </main>

      {/* Footer */}
      <footer className="border-t border-slate-900 py-6 text-center text-xs text-slate-600 mt-6 bg-slate-900/10">
        <p>© 2026 BrainLingo Translator Agent Team. Todos os direitos reservados.</p>
      </footer>

    </div>
  );
}
