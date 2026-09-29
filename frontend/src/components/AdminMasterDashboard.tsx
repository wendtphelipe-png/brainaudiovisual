import React, { useState, useEffect } from 'react';
import { 
  Radio, Shield, Plus, ExternalLink, CheckCircle2, AlertCircle, 
  RefreshCw, Power, Play, Users, Clock, ArrowRight, Settings, 
  Terminal, Sparkles, AlertTriangle, LogIn, LogOut
} from 'lucide-react';

export interface GoogleAccount {
  id: string;
  email: string;
  name: string;
  picture?: string;
  isPro: boolean;
  connected: boolean;
  connectedAt: string;
  lastRefreshedAt: string;
  assignedMeetingId?: string | null;
}

export interface MeetingSession {
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
}

export default function AdminMasterDashboard() {
  const [accounts, setAccounts] = useState<GoogleAccount[]>([]);
  const [meetings, setMeetings] = useState<MeetingSession[]>([]);
  const [logs, setLogs] = useState<string[]>([]);
  const [loading, setLoading] = useState<boolean>(true);

  // Formulário de Nova Reunião
  const [newTitle, setNewTitle] = useState<string>('');
  const [newCurrentMeetUrl, setNewCurrentMeetUrl] = useState<string>('');
  const [newNextMeetUrl, setNewNextMeetUrl] = useState<string>('');
  const [selectedAccountA, setSelectedAccountA] = useState<string>('');
  const [selectedAccountB, setSelectedAccountB] = useState<string>('');
  const [isStartingMeeting, setIsStartingMeeting] = useState<boolean>(false);
  const [formError, setFormError] = useState<string>('');

  const fetchData = async () => {
    try {
      const [resAcc, resMeet, resLogs] = await Promise.all([
        fetch('/api/accounts').then(r => r.json()).catch(() => ({ accounts: [] })),
        fetch('/api/meetings').then(r => r.json()).catch(() => ({ meetings: [] })),
        fetch('/api/logs').then(r => r.json()).catch(() => ({ logs: [] }))
      ]);

      setAccounts(resAcc.accounts || []);
      setMeetings(resMeet.meetings || []);
      setLogs(resLogs.logs || []);

      // Seleção padrão de contas se ainda não escolhidas
      const connectedAccs = (resAcc.accounts || []).filter((a: GoogleAccount) => a.connected);
      if (connectedAccs.length >= 2 && !selectedAccountA && !selectedAccountB) {
        setSelectedAccountA(connectedAccs[0].id);
        setSelectedAccountB(connectedAccs[1].id);
      }
    } catch (err) {
      console.error('Erro ao atualizar painel admin:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 3000);
    return () => clearInterval(interval);
  }, []);

  // Fazer login em um slot específico de conta Google Pro
  const handleLoginGoogleSlot = async (slotId: string) => {
    try {
      const res = await fetch(`/api/accounts/auth-url?slot=${slotId}`);
      const data = await res.json();
      if (data.url) {
        window.location.href = data.url;
      } else {
        alert('Erro ao gerar URL de consentimento do Google OAuth.');
      }
    } catch (e) {
      alert('Falha de conexão com o servidor ao autenticar.');
    }
  };

  // Desconectar conta
  const handleDisconnectSlot = async (slotId: string) => {
    if (!confirm('Deseja desconectar esta conta Google Pro?')) return;
    try {
      await fetch('/api/accounts/disconnect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: slotId })
      });
      fetchData();
    } catch (e) {
      alert('Erro ao desconectar conta.');
    }
  };

  // Adicionar novo slot
  const handleAddSlot = async () => {
    try {
      await fetch('/api/accounts/add-slot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: `Slot Google Pro 0${accounts.length + 1}` })
      });
      fetchData();
    } catch (e) {
      alert('Erro ao criar novo slot de conta.');
    }
  };

  // Iniciar Nova Reunião
  const handleStartMeeting = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');

    if (!newCurrentMeetUrl.includes('meet.google.com')) {
      setFormError('Por favor, insira uma URL válida do Google Meet para a reunião inicial.');
      return;
    }

    if (!selectedAccountA || !selectedAccountB) {
      setFormError('Selecione exatamente 2 contas Google Pro para viabilizar a tradução simultânea.');
      return;
    }

    if (selectedAccountA === selectedAccountB) {
      setFormError('As duas contas do par devem ser contas Google Pro distintas.');
      return;
    }

    setIsStartingMeeting(true);
    try {
      const res = await fetch('/api/meetings/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: newTitle || 'Reunião com Tradução Simultânea',
          currentMeetUrl: newCurrentMeetUrl,
          scheduledNextMeetUrl: newNextMeetUrl,
          accountIds: [selectedAccountA, selectedAccountB]
        })
      });

      const data = await res.json();
      if (data.error) {
        setFormError(data.error);
      } else {
        // Limpa campos
        setNewTitle('');
        setNewCurrentMeetUrl('');
        setNewNextMeetUrl('');
        fetchData();

        // Abre automaticamente a nova aba dedicada da reunião!
        if (data.meeting?.id) {
          window.open(`/?meeting=${data.meeting.id}`, '_blank');
        }
      }
    } catch (err) {
      setFormError('Erro ao iniciar a reunião.');
    } finally {
      setIsStartingMeeting(false);
    }
  };

  // Forçar Hot-Swap
  const handleTriggerSwap = async (meetingId: string) => {
    try {
      await fetch(`/api/meetings/${meetingId}/swap`, { method: 'POST' });
      fetchData();
    } catch (e) {
      alert('Erro ao disparar hot-swap.');
    }
  };

  // Encerrar Reunião
  const handleStopMeeting = async (meetingId: string) => {
    if (!confirm('Deseja encerrar esta sessão de reunião?')) return;
    try {
      await fetch(`/api/meetings/${meetingId}/stop`, { method: 'POST' });
      fetchData();
    } catch (e) {
      alert('Erro ao encerrar reunião.');
    }
  };

  const connectedCount = accounts.filter(a => a.connected).length;
  const capacityMeetings = Math.floor(connectedCount / 2);

  const formatCountdown = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}m ${secs < 10 ? '0' : ''}${secs}s`;
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 font-sans selection:bg-blue-500/30 selection:text-blue-200">
      
      {/* Header Superior */}
      <header className="border-b border-slate-800 bg-slate-900/60 backdrop-blur-xl sticky top-0 z-30 px-6 sm:px-12 py-4 flex flex-col sm:flex-row items-center justify-between gap-4">
        <div className="flex items-center gap-3.5">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-blue-600 to-indigo-500 flex items-center justify-center shadow-lg shadow-blue-500/20">
            <Radio className="w-5 h-5 text-white animate-pulse" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold tracking-tight text-white">Brain Audiovisual</h1>
              <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-400 border border-blue-500/20 uppercase tracking-wider">
                Painel Master
              </span>
            </div>
            <p className="text-xs text-slate-400">Gerenciador de Contas Google Pro & Orquestração Multi-Meet</p>
          </div>
        </div>

        {/* Resumo de Capacidade */}
        <div className="flex items-center gap-3">
          <div className="bg-slate-900 border border-slate-800 px-4 py-2 rounded-xl flex items-center gap-3 text-xs">
            <div className="flex items-center gap-1.5 text-slate-300">
              <Users className="w-4 h-4 text-blue-400" />
              <span>Contas Conectadas: <strong className="text-white">{connectedCount}</strong></span>
            </div>
            <span className="text-slate-700">|</span>
            <div className="flex items-center gap-1.5 text-slate-300">
              <Shield className="w-4 h-4 text-emerald-400" />
              <span>Capacidade Simultânea: <strong className="text-emerald-400">{capacityMeetings} Reuniões</strong></span>
            </div>
          </div>
        </div>
      </header>

      {/* Conteúdo Principal */}
      <main className="max-w-7xl mx-auto px-6 sm:px-12 py-8 space-y-10">

        {/* ========================================================
            SEÇÃO 1: POOL DE CONTAS GOOGLE PRO
            ======================================================== */}
        <section>
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-lg font-bold text-white flex items-center gap-2">
                <Shield className="w-5 h-5 text-blue-400" />
                Pool de Contas Google Pro / Workspace
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">
                Cadastre e autentique suas contas. Cada reunião com tradução consome obrigatoriamente <strong>2 contas Pro ativas</strong>.
              </p>
            </div>
            <button
              onClick={handleAddSlot}
              className="inline-flex items-center gap-1.5 bg-slate-900 hover:bg-slate-800 text-slate-200 text-xs font-semibold px-3.5 py-2 rounded-xl border border-slate-800 transition-all hover:border-slate-700"
            >
              <Plus className="w-3.5 h-3.5 text-blue-400" />
              Adicionar Novo Slot
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {accounts.map((acc, index) => (
              <div 
                key={acc.id} 
                className={`p-5 rounded-2xl border transition-all relative overflow-hidden flex flex-col justify-between ${
                  acc.connected 
                    ? 'bg-slate-900/80 border-slate-800 shadow-lg' 
                    : 'bg-slate-900/30 border-dashed border-slate-800/80 hover:border-slate-700'
                }`}
              >
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-[11px] font-bold tracking-wider uppercase text-slate-500">
                      Conta #{index + 1}
                    </span>
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full flex items-center gap-1 ${
                      acc.connected 
                        ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' 
                        : 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                    }`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${acc.connected ? 'bg-emerald-400' : 'bg-amber-400'}`} />
                      {acc.connected ? 'Conectada (Pro)' : 'Aguardando Login'}
                    </span>
                  </div>

                  <h3 className="font-bold text-sm text-slate-100 truncate mb-1">
                    {acc.name}
                  </h3>
                  <p className="text-xs text-slate-400 font-mono truncate mb-4">
                    {acc.email || 'Nenhum e-mail vinculado'}
                  </p>
                </div>

                <div className="pt-3 border-t border-slate-800/80 flex items-center justify-between gap-2">
                  {acc.connected ? (
                    <>
                      <span className="text-[11px] text-slate-500">Pronta para uso</span>
                      <div className="flex items-center gap-1.5">
                        <button
                          onClick={() => handleLoginGoogleSlot(acc.id)}
                          title="Reautenticar conta"
                          className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-colors"
                        >
                          <RefreshCw className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => handleDisconnectSlot(acc.id)}
                          title="Desconectar"
                          className="p-1.5 text-rose-400 hover:text-rose-300 rounded-lg hover:bg-rose-500/10 transition-colors"
                        >
                          <LogOut className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </>
                  ) : (
                    <button
                      onClick={() => handleLoginGoogleSlot(acc.id)}
                      className="w-full inline-flex items-center justify-center gap-2 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white text-xs font-semibold py-2 px-3 rounded-xl transition-all shadow-md shadow-blue-600/20"
                    >
                      <LogIn className="w-3.5 h-3.5" />
                      Fazer Login com Google
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* ========================================================
            SEÇÃO 2: CRIADOR E AGENDADOR DE NOVA REUNIÃO
            ======================================================== */}
        <section className="bg-slate-900/60 border border-slate-800 rounded-3xl p-6 sm:p-8 backdrop-blur-xl shadow-xl">
          <div className="max-w-3xl mb-6">
            <h2 className="text-lg font-bold text-white flex items-center gap-2">
              <Play className="w-5 h-5 text-blue-500" />
              Iniciar Nova Reunião com Tradução Simultânea
            </h2>
            <p className="text-xs text-slate-400 mt-1">
              Configure o link do Google Meet e selecione as duas contas Google Pro dedicadas. Ao iniciar, uma nova página no navegador será aberta com o monitor de áudio traduzido e telemetria.
            </p>
          </div>

          {formError && (
            <div className="mb-6 p-4 rounded-xl bg-rose-500/15 border border-rose-500/30 text-rose-300 text-xs flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
              <span>{formError}</span>
            </div>
          )}

          <form onSubmit={handleStartMeeting} className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                Título ou Identificador da Reunião
              </label>
              <input
                type="text"
                value={newTitle}
                onChange={e => setNewTitle(e.target.value)}
                placeholder="Ex: Summit Internacional — Painel 01"
                className="w-full bg-slate-950 border border-slate-800 focus:border-blue-500 rounded-xl px-4 py-2.5 text-xs text-white placeholder-slate-600 outline-none transition-all"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                Link do Google Meet Atual (Reunião 1) *
              </label>
              <input
                type="url"
                required
                value={newCurrentMeetUrl}
                onChange={e => setNewCurrentMeetUrl(e.target.value)}
                placeholder="https://meet.google.com/xxx-yyyy-zzz"
                className="w-full bg-slate-950 border border-slate-800 focus:border-blue-500 rounded-xl px-4 py-2.5 text-xs text-white placeholder-slate-600 outline-none transition-all font-mono"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                Link do Google Meet para Próxima Hora (Hot-Swap Agendado)
              </label>
              <input
                type="url"
                value={newNextMeetUrl}
                onChange={e => setNewNextMeetUrl(e.target.value)}
                placeholder="https://meet.google.com/aaa-bbbb-ccc (opcional)"
                className="w-full bg-slate-950 border border-slate-800 focus:border-blue-500 rounded-xl px-4 py-2.5 text-xs text-white placeholder-slate-600 outline-none transition-all font-mono"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                  Conta Google Pro A *
                </label>
                <select
                  value={selectedAccountA}
                  onChange={e => setSelectedAccountA(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 focus:border-blue-500 rounded-xl px-3 py-2.5 text-xs text-white outline-none"
                >
                  <option value="">Selecione a Conta A</option>
                  {accounts.map(acc => (
                    <option key={acc.id} value={acc.id} disabled={!acc.connected}>
                      {acc.name} {acc.connected ? '(Pronta)' : '(Desconectada)'}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                  Conta Google Pro B *
                </label>
                <select
                  value={selectedAccountB}
                  onChange={e => setSelectedAccountB(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 focus:border-blue-500 rounded-xl px-3 py-2.5 text-xs text-white outline-none"
                >
                  <option value="">Selecione a Conta B</option>
                  {accounts.map(acc => (
                    <option key={acc.id} value={acc.id} disabled={!acc.connected}>
                      {acc.name} {acc.connected ? '(Pronta)' : '(Desconectada)'}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="md:col-span-2 pt-2 flex justify-end">
              <button
                type="submit"
                disabled={isStartingMeeting || connectedCount < 2}
                className="inline-flex items-center gap-2 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white font-semibold text-xs px-6 py-3 rounded-xl transition-all shadow-lg shadow-blue-600/30 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
              >
                {isStartingMeeting ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    <span>Iniciando Robôs e Conectando...</span>
                  </>
                ) : (
                  <>
                    <span>Iniciar Reunião & Abrir Página Dedicada</span>
                    <ExternalLink className="w-4 h-4" />
                  </>
                )}
              </button>
            </div>
          </form>
        </section>

        {/* ========================================================
            SEÇÃO 3: REUNIÕES ATIVAS & MONITORAMENTO
            ======================================================== */}
        <section>
          <div className="mb-4">
            <h2 className="text-lg font-bold text-white flex items-center gap-2">
              <Clock className="w-5 h-5 text-emerald-400" />
              Reuniões em Andamento (Sessões Ativas)
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Acompanhe a contagem regressiva para hot-swap de 1 hora e abra a página individual de cada transmissão.
            </p>
          </div>

          {meetings.filter(m => m.status === 'active' || m.status === 'transitioning').length === 0 ? (
            <div className="bg-slate-900/30 border border-slate-800 rounded-2xl p-10 text-center text-slate-500 text-xs">
              Nenhuma reunião ativa no momento. Inicie uma reunião acima para abrir o monitor individual.
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
              {meetings.filter(m => m.status === 'active' || m.status === 'transitioning').map(m => (
                <div key={m.id} className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl relative overflow-hidden flex flex-col justify-between">
                  <div>
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse" />
                        <span className="text-xs font-bold text-emerald-400 uppercase tracking-wide">
                          {m.status === 'transitioning' ? 'Hot-Swap em Andamento' : 'Transmitindo'}
                        </span>
                      </div>
                      <div className="text-xs text-slate-400 bg-slate-950 border border-slate-800 px-3 py-1 rounded-lg font-mono">
                        Troca em: <strong className="text-blue-400">{formatCountdown(m.nextSwapInSeconds)}</strong>
                      </div>
                    </div>

                    <h3 className="text-base font-bold text-white mb-2">{m.title}</h3>
                    
                    <div className="space-y-1.5 text-xs text-slate-400 mb-5">
                      <div className="flex items-center justify-between">
                        <span>Meet Atual:</span>
                        <a href={m.currentMeetUrl} target="_blank" rel="noreferrer" className="text-blue-400 hover:underline font-mono truncate max-w-[240px]">
                          {m.currentMeetUrl}
                        </a>
                      </div>
                      {m.scheduledNextMeetUrl && (
                        <div className="flex items-center justify-between">
                          <span>Próximo Meet (Agendado):</span>
                          <span className="text-slate-300 font-mono truncate max-w-[240px]">{m.scheduledNextMeetUrl}</span>
                        </div>
                      )}
                      <div className="flex items-center justify-between">
                        <span>Latência WebRTC:</span>
                        <span className="text-emerald-400 font-semibold">{m.telemetry.latencyMs}ms (Sub-segundo)</span>
                      </div>
                    </div>
                  </div>

                  <div className="pt-4 border-t border-slate-800/80 flex items-center justify-between gap-3">
                    <button
                      onClick={() => handleTriggerSwap(m.id)}
                      className="text-xs text-amber-400 hover:text-amber-300 bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/20 px-3 py-2 rounded-xl transition-all"
                    >
                      Forçar Hot-Swap Agora
                    </button>

                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleStopMeeting(m.id)}
                        className="text-xs text-rose-400 hover:text-rose-300 bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/20 px-3 py-2 rounded-xl transition-all"
                      >
                        Encerrar
                      </button>
                      <button
                        onClick={() => window.open(`/?meeting=${m.id}`, '_blank')}
                        className="inline-flex items-center gap-1.5 bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold px-4 py-2 rounded-xl transition-all shadow-md shadow-blue-600/30"
                      >
                        <span>Abrir Painel da Reunião</span>
                        <ExternalLink className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* ========================================================
            SEÇÃO 4: LOGS DO SISTEMA EM TEMPO REAL
            ======================================================== */}
        <section className="bg-slate-900/60 border border-slate-800 rounded-3xl p-6 backdrop-blur-xl shadow-xl">
          <h2 className="text-sm font-bold text-white flex items-center gap-2 mb-3">
            <Terminal className="w-4 h-4 text-blue-400" />
            Terminal de Logs do Orquestrador de Robôs
          </h2>
          <div className="bg-slate-950 border border-slate-850 p-4 rounded-xl font-mono text-[11px] text-slate-400 h-44 overflow-y-auto space-y-1.5 scrollbar-thin scrollbar-thumb-slate-800">
            {logs.length > 0 ? (
              logs.map((log, idx) => (
                <div key={idx} className="leading-relaxed border-b border-slate-900/40 pb-1">
                  {log}
                </div>
              ))
            ) : (
              <div className="text-slate-600 text-center py-10">Aguardando eventos do sistema...</div>
            )}
          </div>
        </section>

      </main>

    </div>
  );
}
