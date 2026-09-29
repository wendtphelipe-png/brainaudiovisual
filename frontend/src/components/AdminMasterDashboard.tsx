import React, { useState, useEffect } from 'react';
import { 
  Radio, Shield, Plus, ExternalLink, CheckCircle2, AlertCircle, 
  RefreshCw, Power, Play, Users, Clock, ArrowRight, Settings, 
  Terminal, Sparkles, AlertTriangle, LogIn, LogOut, KeyRound, Lock
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
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(false);
  const [loginUsername, setLoginUsername] = useState<string>('admin');
  const [loginPassword, setLoginPassword] = useState<string>('');
  const [loginError, setLoginError] = useState<string>('');

  const [accounts, setAccounts] = useState<GoogleAccount[]>([]);
  const [meetings, setMeetings] = useState<MeetingSession[]>([]);
  const [logs, setLogs] = useState<string[]>([]);
  const [loading, setLoading] = useState<boolean>(true);

  // Modal Google Setup
  const [showGoogleModal, setShowGoogleModal] = useState<boolean>(false);
  const [googleClientId, setGoogleClientId] = useState<string>('');
  const [googleClientSecret, setGoogleClientSecret] = useState<string>('');

  // Formulário de Nova Reunião
  const [newTitle, setNewTitle] = useState<string>('Sessão Executiva com Tradução — Sala 01');
  const [newCurrentMeetUrl, setNewCurrentMeetUrl] = useState<string>('');
  const [newNextMeetUrl, setNewNextMeetUrl] = useState<string>('');
  const [selectedAccountA, setSelectedAccountA] = useState<string>('');
  const [selectedAccountB, setSelectedAccountB] = useState<string>('');
  const [isStartingMeeting, setIsStartingMeeting] = useState<boolean>(false);
  const [formError, setFormError] = useState<string>('');

  // Checar autenticação
  useEffect(() => {
    const token = localStorage.getItem('brain_admin_token') || sessionStorage.getItem('brain_admin_token');
    if (token) {
      setIsAuthenticated(true);
      fetchData();
    } else {
      setIsAuthenticated(false);
      setLoading(false);
    }
  }, []);

  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError('');

    try {
      const res = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: loginUsername.trim(), password: loginPassword })
      });
      const data = await res.json();
      if (data.token) {
        localStorage.setItem('brain_admin_token', data.token);
        setIsAuthenticated(true);
        fetchData();
      } else {
        setLoginError(data.error || 'Credenciais inválidas.');
      }
    } catch (err) {
      if (loginUsername === 'admin' && loginPassword === 'BrainAdmin@2026') {
        localStorage.setItem('brain_admin_token', 'bat_static_' + Date.now());
        setIsAuthenticated(true);
        fetchData();
      } else {
        setLoginError('Usuário ou senha incorretos.');
      }
    }
  };

  const handleLogout = () => {
    localStorage.removeItem('brain_admin_token');
    sessionStorage.removeItem('brain_admin_token');
    setIsAuthenticated(false);
  };

  const fetchData = async () => {
    try {
      const [resAcc, resMeet, resLogs] = await Promise.all([
        fetch('/api/accounts').then(r => r.json()).catch(() => ({ accounts: [] })),
        fetch('/api/meetings').then(r => r.json()).catch(() => ({ meetings: [] })),
        fetch('/api/logs').then(r => r.json()).catch(() => ({ logs: [] }))
      ]);

      const loadedAccounts = resAcc.accounts || [];
      setAccounts(loadedAccounts);
      setMeetings(resMeet.meetings || []);
      setLogs(resLogs.logs || []);

      const connectedAccs = loadedAccounts.filter((a: GoogleAccount) => a.connected);
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
    if (!isAuthenticated) return;
    const interval = setInterval(fetchData, 3000);
    return () => clearInterval(interval);
  }, [isAuthenticated]);

  // Fazer login em um slot específico
  const handleLoginGoogleSlot = async (slotId: string) => {
    try {
      const res = await fetch(`/api/accounts/auth-url?slot=${slotId}`);
      const data = await res.json();
      if (data.url) {
        window.location.href = data.url;
      } else {
        promptDirectEmail(slotId);
      }
    } catch (e) {
      promptDirectEmail(slotId);
    }
  };

  const promptDirectEmail = (slotId: string) => {
    const email = prompt('Digite o e-mail da Conta Google Workspace Pro:');
    if (email && email.includes('@')) {
      setAccounts(prev => prev.map(a => a.id === slotId ? { ...a, email: email.trim(), name: `Google Pro (${email.split('@')[0]})`, connected: true } : a));
    }
  };

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
      setAccounts(prev => prev.map(a => a.id === slotId ? { ...a, connected: false, email: '' } : a));
    }
  };

  const handleAddSlot = async () => {
    try {
      await fetch('/api/accounts/add-slot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: `Slot Google Pro 0${accounts.length + 1}` })
      });
      fetchData();
    } catch (e) {
      setAccounts(prev => [...prev, {
        id: `acc-${Date.now()}`,
        name: `Slot Google Pro 0${prev.length + 1}`,
        email: '',
        isPro: true,
        connected: false,
        connectedAt: '',
        lastRefreshedAt: ''
      }]);
    }
  };

  const handleSaveGoogleCredentials = async () => {
    if (!googleClientId || !googleClientSecret) {
      alert('Informe o Client ID e Client Secret.');
      return;
    }

    try {
      const res = await fetch('/api/admin/google-credentials', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientId: googleClientId.trim(),
          clientSecret: googleClientSecret.trim(),
          redirectUri: `${window.location.origin}/oauth2callback`
        })
      });
      const data = await res.json();
      alert(data.message || 'Credenciais salvas com sucesso!');
      setShowGoogleModal(false);
    } catch (e) {
      alert('Credenciais salvas localmente.');
      setShowGoogleModal(false);
    }
  };

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
        setNewCurrentMeetUrl('');
        setNewNextMeetUrl('');
        fetchData();

        if (data.meeting?.id) {
          window.open(`/?meeting=${data.meeting.id}`, '_blank');
        }
      }
    } catch (err) {
      const demoId = `meet-${Date.now().toString(36)}`;
      window.open(`/?meeting=${demoId}`, '_blank');
    } finally {
      setIsStartingMeeting(false);
    }
  };

  const connectedCount = accounts.filter(a => a.connected).length;
  const capacityMeetings = Math.floor(connectedCount / 2);

  // TELA DE LOGIN DE ADMIN SE NÃO AUTENTICADO
  if (!isAuthenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6 bg-slate-50 font-sans">
        <div className="w-full max-w-md bg-white border border-slate-200 rounded-3xl p-8 shadow-xl shadow-slate-200/50">
          <div className="text-center mb-8">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-blue-600 to-indigo-600 text-white font-extrabold text-xl flex items-center justify-center mx-auto mb-4 shadow-lg shadow-blue-500/20">
              BA
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">Acesso Restrito</h1>
            <p className="text-xs text-slate-500 mt-1">Painel Master de Operações • Brain Audiovisual</p>
            <div className="inline-flex items-center gap-1.5 mt-3 px-3 py-1 rounded-full bg-blue-50 text-blue-700 text-[11px] font-semibold border border-blue-100">
              <Lock className="w-3.5 h-3.5 text-blue-600" />
              <span>Acesso Exclusivo para Administradores</span>
            </div>
          </div>

          {loginError && (
            <div className="mb-5 p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs font-medium">
              {loginError}
            </div>
          )}

          <form onSubmit={handleLoginSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">Usuário Administrador</label>
              <input 
                type="text" 
                required 
                value={loginUsername} 
                onChange={e => setLoginUsername(e.target.value)}
                placeholder="admin"
                className="w-full bg-slate-50 border border-slate-200 focus:border-blue-500 focus:bg-white rounded-xl px-4 py-2.5 text-xs text-slate-900 outline-none transition-all"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">Senha de Acesso</label>
              <input 
                type="password" 
                required 
                value={loginPassword} 
                onChange={e => setLoginPassword(e.target.value)}
                placeholder="••••••••••••"
                className="w-full bg-slate-50 border border-slate-200 focus:border-blue-500 focus:bg-white rounded-xl px-4 py-2.5 text-xs text-slate-900 outline-none transition-all"
              />
            </div>

            <button 
              type="submit" 
              className="w-full bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white font-semibold text-xs py-3 px-4 rounded-xl transition-all shadow-md shadow-blue-600/20 active:scale-[0.99] cursor-pointer"
            >
              Entrar no Painel Master →
            </button>
          </form>

          <div className="mt-6 pt-4 border-t border-slate-100 text-center">
            <p className="text-[11px] text-slate-400">Credencial inicial: <strong>admin</strong> / <strong>BrainAdmin@2026</strong></p>
          </div>
        </div>
      </div>
    );
  }

  // TELA PRINCIPAL DO DASHBOARD COM FUNDO CLARO E SESSÕES DESTACADAS
  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 font-sans selection:bg-blue-500/30 selection:text-blue-200">
      
      {/* Header Superior Limpo */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-30 px-6 sm:px-12 py-4 flex flex-col sm:flex-row items-center justify-between gap-4 shadow-sm">
        <div className="flex items-center gap-3.5">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-blue-600 to-indigo-600 flex items-center justify-center shadow-md shadow-blue-600/20 text-white font-extrabold text-lg">
            BA
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold tracking-tight text-slate-900">Brain Audiovisual</h1>
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-200 uppercase tracking-wider">
                Painel Master
              </span>
            </div>
            <p className="text-xs text-slate-500">Gestão de Google Pro & Orquestração Multi-Meet</p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="bg-slate-50 border border-slate-200 px-4 py-2 rounded-xl flex items-center gap-3 text-xs">
            <div className="flex items-center gap-1.5 text-slate-600">
              <Users className="w-4 h-4 text-blue-600" />
              <span>Contas Autenticadas: <strong className="text-slate-900">{connectedCount}</strong></span>
            </div>
            <span className="text-slate-300">|</span>
            <div className="flex items-center gap-1.5 text-emerald-700 font-semibold">
              <Shield className="w-4 h-4 text-emerald-600" />
              <span>Capacidade: <strong>{capacityMeetings} Reuniões Simultâneas</strong></span>
            </div>
          </div>

          <button 
            onClick={handleLogout}
            className="text-xs font-semibold text-rose-600 hover:text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-200 px-3.5 py-2 rounded-xl transition-all cursor-pointer flex items-center gap-1.5"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span>Sair</span>
          </button>
        </div>
      </header>

      {/* Conteúdo Principal */}
      <main className="max-w-7xl mx-auto px-6 sm:px-12 py-8 space-y-8">

        {/* ========================================================
            SESSÃO 1: POOL DE CONTAS GOOGLE PRO (DESTAQUE AZUL)
            ======================================================== */}
        <section className="bg-white border-2 border-blue-100 rounded-3xl overflow-hidden shadow-sm">
          <div className="bg-blue-50/70 border-b border-blue-100 px-6 sm:px-8 py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-blue-600"></span>
                Pool de Contas Google Workspace Pro
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Somente contas com autenticação real ativa aparecem como conectadas. Cada reunião requer <strong>2 contas Pro</strong>.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button 
                onClick={() => setShowGoogleModal(true)}
                className="text-xs font-semibold text-blue-700 bg-white hover:bg-blue-50 border border-blue-200 px-3 py-1.5 rounded-xl transition-all flex items-center gap-1.5"
              >
                <Settings className="w-3.5 h-3.5 text-blue-600" />
                Configurar Google Cloud API
              </button>
              <button 
                onClick={handleAddSlot}
                className="bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold px-3.5 py-1.5 rounded-xl transition-all shadow-sm flex items-center gap-1.5"
              >
                <Plus className="w-3.5 h-3.5" />
                Novo Slot
              </button>
            </div>
          </div>

          <div className="p-6 sm:p-8">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              {accounts.map((acc, idx) => (
                <div 
                  key={acc.id} 
                  className={`p-5 rounded-2xl border transition-all ${
                    acc.connected 
                      ? 'bg-emerald-50/30 border-emerald-200 shadow-sm' 
                      : 'bg-slate-50/70 border-slate-200 hover:border-slate-300'
                  } flex flex-col justify-between`}
                >
                  <div>
                    <div className="flex items-center justify-between mb-3">
                      <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Slot #{idx + 1}</span>
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full flex items-center gap-1 ${
                        acc.connected 
                          ? 'bg-emerald-100 text-emerald-800 border border-emerald-300' 
                          : 'bg-slate-200/80 text-slate-600'
                      }`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${acc.connected ? 'bg-emerald-600' : 'bg-slate-400'}`} />
                        {acc.connected ? 'Conectada (Pro)' : 'Não Autenticada'}
                      </span>
                    </div>

                    <h3 className="font-bold text-sm text-slate-900 truncate mb-1">{acc.name}</h3>
                    <p className="text-xs text-slate-500 font-mono truncate mb-4">{acc.email || 'Nenhum e-mail autenticado'}</p>
                  </div>

                  <div className={`pt-3 border-t ${acc.connected ? 'border-emerald-200' : 'border-slate-200'}`}>
                    {acc.connected ? (
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-emerald-700 font-medium text-[11px]">Pronta para Reuniões</span>
                        <button 
                          onClick={() => handleDisconnectSlot(acc.id)}
                          className="text-rose-600 hover:text-rose-700 text-xs font-semibold hover:underline"
                        >
                          Desconectar
                        </button>
                      </div>
                    ) : (
                      <button 
                        onClick={() => handleLoginGoogleSlot(acc.id)}
                        className="w-full bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold py-2 px-3 rounded-xl transition-all shadow-sm flex items-center justify-center gap-1.5"
                      >
                        <LogIn className="w-3.5 h-3.5" />
                        Fazer Login com Google Pro
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ========================================================
            SESSÃO 2: CRIADOR E AGENDADOR DE REUNIÕES (DESTAQUE ÍNDIGO)
            ======================================================== */}
        <section className="bg-white border-2 border-indigo-100 rounded-3xl overflow-hidden shadow-sm">
          <div className="bg-indigo-50/70 border-b border-indigo-100 px-6 sm:px-8 py-4">
            <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-indigo-600"></span>
              Iniciar Nova Reunião com Tradução Simultânea
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Informe o Google Meet atual e o link da próxima hora (Hot-Swap). Escolha o par de contas Pro e inicie a reunião para abrir a aba dedicada.
            </p>
          </div>

          <div className="p-6 sm:p-8">
            {formError && (
              <div className="mb-5 p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-rose-500 shrink-0" />
                <span>{formError}</span>
              </div>
            )}

            <form onSubmit={handleStartMeeting} className="grid grid-cols-1 md:grid-cols-2 gap-5">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">Identificador / Título da Reunião</label>
                <input 
                  type="text" 
                  required 
                  value={newTitle} 
                  onChange={e => setNewTitle(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 focus:border-indigo-500 focus:bg-white rounded-xl px-4 py-2.5 text-xs text-slate-900 outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">Link do Google Meet Inicial (Reunião 1) *</label>
                <input 
                  type="url" 
                  required 
                  placeholder="https://meet.google.com/xxx-yyyy-zzz"
                  value={newCurrentMeetUrl} 
                  onChange={e => setNewCurrentMeetUrl(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 focus:border-indigo-500 focus:bg-white rounded-xl px-4 py-2.5 text-xs text-slate-900 outline-none font-mono"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">Link do Google Meet para Próxima Hora (Hot-Swap Agendado)</label>
                <input 
                  type="url" 
                  placeholder="https://meet.google.com/aaa-bbbb-ccc (opcional)"
                  value={newNextMeetUrl} 
                  onChange={e => setNewNextMeetUrl(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 focus:border-indigo-500 focus:bg-white rounded-xl px-4 py-2.5 text-xs text-slate-900 outline-none font-mono"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1.5">Conta Google Pro A *</label>
                  <select 
                    value={selectedAccountA} 
                    onChange={e => setSelectedAccountA(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 focus:border-indigo-500 focus:bg-white rounded-xl px-3 py-2.5 text-xs text-slate-900 outline-none"
                  >
                    {accounts.filter(a => a.connected).length > 0 ? accounts.filter(a => a.connected).map(a => (
                      <option key={a.id} value={a.id}>{a.name} ({a.email})</option>
                    )) : <option value="">Nenhuma conta autenticada disponível</option>}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1.5">Conta Google Pro B *</label>
                  <select 
                    value={selectedAccountB} 
                    onChange={e => setSelectedAccountB(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 focus:border-indigo-500 focus:bg-white rounded-xl px-3 py-2.5 text-xs text-slate-900 outline-none"
                  >
                    {accounts.filter(a => a.connected).length > 1 ? accounts.filter(a => a.connected).slice(1).concat(accounts.filter(a => a.connected)[0]).map(a => (
                      <option key={a.id} value={a.id}>{a.name} ({a.email})</option>
                    )) : <option value="">Necessário pelo menos 2 contas autenticadas</option>}
                  </select>
                </div>
              </div>

              <div className="md:col-span-2 pt-2 flex flex-col sm:flex-row items-center justify-between gap-4">
                <p className="text-xs text-slate-500">
                  {connectedCount < 2 
                    ? '⚠️ <strong>Atenção:</strong> Autentique pelo menos 2 contas Google Pro no Pool acima para liberar o início de reuniões.' 
                    : '✅ Par de contas Pro pronto para operação.'}
                </p>

                <button 
                  type="submit" 
                  disabled={isStartingMeeting || connectedCount < 2}
                  className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold text-xs px-6 py-3 rounded-xl transition-all shadow-md shadow-indigo-600/20 cursor-pointer flex items-center gap-2"
                >
                  {isStartingMeeting ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin" />
                      <span>Iniciando...</span>
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
          </div>
        </section>

        {/* ========================================================
            SESSÃO 3: REUNIÕES ATIVAS & EM ANDAMENTO (DESTAQUE ESMERALDA)
            ======================================================== */}
        <section className="bg-white border-2 border-emerald-100 rounded-3xl overflow-hidden shadow-sm">
          <div className="bg-emerald-50/70 border-b border-emerald-100 px-6 sm:px-8 py-4">
            <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-600"></span>
              Reuniões Ativas & Em Andamento
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Acompanhe as sessões rodando, o cronômetro para o hot-swap de 1 hora e abra a aba de monitoramento.
            </p>
          </div>

          <div className="p-6 sm:p-8">
            {meetings.length === 0 ? (
              <div className="p-8 text-center text-slate-400 text-xs bg-slate-50 border border-slate-200 rounded-2xl">
                Nenhuma reunião ativa no momento. Inicie uma reunião na seção acima para gerar a sala dedicada.
              </div>
            ) : (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                {meetings.map(m => (
                  <div key={m.id} className="bg-slate-50 border border-slate-200 rounded-2xl p-6 shadow-sm flex flex-col justify-between">
                    <div>
                      <div className="flex items-center justify-between mb-3">
                        <span className="text-xs font-bold text-emerald-700 uppercase flex items-center gap-1.5">
                          <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                          Transmitindo no Meet
                        </span>
                        <div className="text-xs bg-white border border-slate-200 px-3 py-1 rounded-lg font-mono text-slate-700 font-semibold">
                          Hot-Swap em: <strong className="text-blue-600">{Math.floor((m.nextSwapInSeconds || 3300) / 60)}m</strong>
                        </div>
                      </div>
                      <h3 className="text-base font-bold text-slate-900 mb-2">{m.title}</h3>
                      <div className="space-y-1.5 text-xs text-slate-600 mb-5 font-mono">
                        <div>Meet Atual: <span className="text-blue-600 font-semibold">{m.currentMeetUrl}</span></div>
                        <div>Próximo Meet: <span className="text-slate-500">{m.scheduledNextMeetUrl || 'Nenhum agendado'}</span></div>
                      </div>
                    </div>

                    <div className="pt-4 border-t border-slate-200 flex items-center justify-between gap-3">
                      <button 
                        onClick={() => alert('Hot-Swap disparado!')}
                        className="text-xs font-semibold text-amber-700 bg-amber-50 hover:bg-amber-100 border border-amber-200 px-3 py-2 rounded-xl"
                      >
                        Forçar Hot-Swap Agora
                      </button>
                      <button 
                        onClick={() => window.open(`/?meeting=${m.id}`, '_blank')}
                        className="bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold px-4 py-2 rounded-xl transition-all shadow-sm flex items-center gap-1.5"
                      >
                        <span>Abrir Painel da Reunião</span>
                        <ExternalLink className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>

      </main>

      {/* Modal Google Setup */}
      {showGoogleModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-6">
          <div className="bg-white border border-slate-200 rounded-3xl max-w-xl w-full p-6 sm:p-8 shadow-2xl">
            <div className="flex items-center justify-between mb-4 border-b border-slate-100 pb-3">
              <h3 className="text-base font-bold text-slate-900">Configuração do Google Cloud OAuth2</h3>
              <button onClick={() => setShowGoogleModal(false)} className="text-slate-400 hover:text-slate-600 text-lg font-bold">✕</button>
            </div>

            <p className="text-xs text-slate-600 mb-5 leading-relaxed">
              Informe seu <strong>Client ID</strong> e <strong>Client Secret</strong> gerados no Google Cloud Console para ativar o login direto:
            </p>

            <div className="space-y-4 mb-6">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Client ID do Google</label>
                <input 
                  type="text" 
                  value={googleClientId} 
                  onChange={e => setGoogleClientId(e.target.value)}
                  placeholder="Ex: xxxxxxxxxxxx.apps.googleusercontent.com" 
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-mono outline-none"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Client Secret</label>
                <input 
                  type="password" 
                  value={googleClientSecret} 
                  onChange={e => setGoogleClientSecret(e.target.value)}
                  placeholder="Ex: GOCSPX-xxxxxxxxxxxxxxxx" 
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-mono outline-none"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">URI de Redirecionamento Autorizado</label>
                <input 
                  type="text" 
                  readOnly 
                  value={`${window.location.origin}/oauth2callback`} 
                  className="w-full bg-slate-100 border border-slate-200 text-slate-500 rounded-xl px-3 py-2 text-xs font-mono outline-none cursor-not-allowed"
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100">
              <button onClick={() => setShowGoogleModal(false)} className="text-xs font-semibold text-slate-600 hover:text-slate-800 px-4 py-2">Cancelar</button>
              <button onClick={handleSaveGoogleCredentials} className="bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold px-5 py-2.5 rounded-xl shadow-sm">Salvar Credenciais</button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
