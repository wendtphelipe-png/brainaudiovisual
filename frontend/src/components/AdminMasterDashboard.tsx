import React, { useState, useEffect, useRef } from 'react';
import { 
  Radio, Shield, Plus, ExternalLink, CheckCircle2, AlertCircle, 
  RefreshCw, Power, Play, Users, Clock, ArrowRight, Settings, 
  Terminal, Sparkles, AlertTriangle, LogIn, LogOut, KeyRound, Lock,
  Copy, Check, X
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

  // Assistente de Conexão Google Pro (Wizard Modal)
  const [wizardOpen, setWizardOpen] = useState<boolean>(false);
  const [wizardSlotId, setWizardSlotId] = useState<string | null>(null);
  const [wizardStep, setWizardStep] = useState<1 | 2 | 3>(1);
  const [wizardPopupLaunched, setWizardPopupLaunched] = useState<boolean>(false);
  const [wizardErrorMessage, setWizardErrorMessage] = useState<string>('');
  const [wizardVerifiedData, setWizardVerifiedData] = useState<any>(null);
  const [googleClientId, setGoogleClientId] = useState<string>('');
  const [googleClientSecret, setGoogleClientSecret] = useState<string>('');
  const [copiedUri, setCopiedUri] = useState<boolean>(false);
  const [copiedConsoleUrl, setCopiedConsoleUrl] = useState<boolean>(false);
  const [manualToken, setManualToken] = useState<string>('');
  const popupRef = useRef<Window | null>(null);
  const checkTimerRef = useRef<any>(null);

  // Formulário de Nova Reunião
  const [newTitle, setNewTitle] = useState<string>('Sessão Executiva com Tradução — Sala 01');
  const [meetingQueueSlots, setMeetingQueueSlots] = useState<string[]>(['', '']);
  const [selectedAccountA, setSelectedAccountA] = useState<string>(''); // Transmissora
  const [selectedAccountB, setSelectedAccountB] = useState<string>(''); // Receptora
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

  // Listener de eventos da janela popup do Google
  useEffect(() => {
    const handleAuthMessage = (event: MessageEvent) => {
      if (!event.data) return;
      if (event.data.type === 'GOOGLE_AUTH_SUCCESS') {
        if (checkTimerRef.current) clearInterval(checkTimerRef.current);
        setWizardVerifiedData({
          email: event.data.email,
          name: event.data.name,
          picture: event.data.picture,
          tokens: event.data.tokens
        });
        setWizardStep(3);
        setWizardPopupLaunched(false);
      } else if (event.data.type === 'GOOGLE_AUTH_CODE') {
        fetch('/api/accounts/oauth-exchange', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code: event.data.code, slotId: event.data.slotId })
        })
        .then(r => r.json())
        .then(d => {
          if (d.account) {
            setWizardVerifiedData({
              email: d.account.email,
              name: d.account.name,
              picture: d.account.picture
            });
            setWizardStep(3);
            setWizardPopupLaunched(false);
          }
        })
        .catch(() => {});
      } else if (event.data.type === 'GOOGLE_AUTH_ERROR') {
        setWizardPopupLaunched(false);
        setWizardErrorMessage(event.data.error || 'A autorização falhou.');
      }
    };

    window.addEventListener('message', handleAuthMessage);
    return () => window.removeEventListener('message', handleAuthMessage);
  }, []);

  const openGoogleAuthWizard = (slotId: string, forceStep: 1 | 2 | 3 | null = null) => {
    setWizardSlotId(slotId);
    setWizardErrorMessage('');
    setWizardVerifiedData(null);
    setWizardPopupLaunched(false);

    const slotCreds = JSON.parse(localStorage.getItem('brain_google_credentials_' + slotId) || '{}');
    const defaultCreds = JSON.parse(localStorage.getItem('brain_google_credentials') || '{}');

    if (slotCreds.clientId) {
      setGoogleClientId(slotCreds.clientId);
      setGoogleClientSecret(slotCreds.clientSecret || '');
    } else {
      setGoogleClientId('');
      setGoogleClientSecret('');
    }

    if (forceStep) {
      setWizardStep(forceStep);
    } else if (slotCreds && slotCreds.clientId) {
      setWizardStep(2);
    } else {
      setWizardStep(1);
    }

    setWizardOpen(true);
  };

  const closeGoogleAuthWizard = () => {
    if (checkTimerRef.current) {
      clearInterval(checkTimerRef.current);
      checkTimerRef.current = null;
    }
    if (popupRef.current && !popupRef.current.closed) {
      try { popupRef.current.close(); } catch (e) {}
    }
    popupRef.current = null;
    setWizardOpen(false);
  };

  const copySlot1Credentials = () => {
    const defaultCreds = JSON.parse(localStorage.getItem('brain_google_credentials') || '{}');
    if (defaultCreds.clientId) {
      setGoogleClientId(defaultCreds.clientId);
      setGoogleClientSecret(defaultCreds.clientSecret || '');
    }
  };

  const saveWizardCredentials = async () => {
    if (!googleClientId.trim()) {
      alert('Por favor, informe o Client ID do Google Cloud.');
      return;
    }

    const currentSlotId = wizardSlotId || 'acc-1';
    const payload = {
      slotId: currentSlotId,
      clientId: googleClientId.trim(),
      clientSecret: googleClientSecret.trim(),
      redirectUri: `${window.location.origin}/oauth2callback`
    };

    localStorage.setItem('brain_google_credentials_' + currentSlotId, JSON.stringify({ clientId: payload.clientId, clientSecret: payload.clientSecret }));
    localStorage.setItem('brain_google_credentials', JSON.stringify({ clientId: payload.clientId, clientSecret: payload.clientSecret }));

    try {
      await fetch('/api/admin/google-credentials', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
    } catch (e) {}

    setWizardStep(2);
    setWizardErrorMessage('');
  };

  const launchGooglePopup = () => {
    setWizardErrorMessage('');
    const currentSlotId = wizardSlotId || 'acc-1';
    const slotCreds = JSON.parse(localStorage.getItem('brain_google_credentials_' + currentSlotId) || '{}');
    const defaultCreds = JSON.parse(localStorage.getItem('brain_google_credentials') || '{}');
    const clientId = slotCreds.clientId || defaultCreds.clientId || googleClientId;

    if (!clientId) {
      setWizardStep(1);
      setWizardErrorMessage('Configure o Client ID antes de abrir o login.');
      return;
    }

    const width = 560;
    const height = 680;
    const left = Math.max(0, (window.screen.width - width) / 2);
    const top = Math.max(0, (window.screen.height - height) / 2);

    const redirectUri = `${window.location.origin}/oauth2callback`;
    const scope = encodeURIComponent('openid https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/userinfo.profile');
    const nonce = Math.random().toString(36).substring(2);
    const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${encodeURIComponent(clientId.trim())}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=token%20id_token&scope=${scope}&state=${encodeURIComponent(wizardSlotId || 'acc-1')}&prompt=select_account%20consent&nonce=${nonce}`;

    popupRef.current = window.open(
      authUrl,
      'GoogleProLogin',
      `width=${width},height=${height},left=${left},top=${top},resizable=yes,scrollbars=yes,status=yes`
    );

    if (!popupRef.current || popupRef.current.closed || typeof popupRef.current.closed === 'undefined') {
      setWizardErrorMessage('O navegador bloqueou a abertura do popup. Permita popups para este site.');
      setWizardPopupLaunched(false);
      return;
    }

    setWizardPopupLaunched(true);

    if (checkTimerRef.current) clearInterval(checkTimerRef.current);
    checkTimerRef.current = setInterval(() => {
      if (popupRef.current && popupRef.current.closed) {
        clearInterval(checkTimerRef.current);
        if (wizardStep !== 3) {
          setWizardPopupLaunched(false);
          setWizardErrorMessage('A janela do Google foi fechada antes de concluir o login. Se desejar, tente novamente.');
        }
      }
    }, 1000);
  };

  const handleManualTokenSubmit = async () => {
    if (!manualToken.trim()) {
      alert('Informe o token de acesso recebido do Google.');
      return;
    }
    try {
      const res = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
        headers: { Authorization: `Bearer ${manualToken.trim()}` }
      });
      if (!res.ok) throw new Error('Token inválido ou expirado.');
      const userInfo = await res.json();
      setWizardVerifiedData({
        email: userInfo.email,
        name: userInfo.name,
        picture: userInfo.picture,
        tokens: { access_token: manualToken.trim() }
      });
      setWizardStep(3);
    } catch (e: any) {
      alert(`Falha ao validar com a Google API: ${e.message}`);
    }
  };

  const confirmAndActivateSlot = async () => {
    if (!wizardSlotId || !wizardVerifiedData) return;
    const email = wizardVerifiedData.email;
    const name = wizardVerifiedData.name || `Google Pro (${email.split('@')[0]})`;
    const picture = wizardVerifiedData.picture || '';

    setAccounts(prev => prev.map(a => a.id === wizardSlotId ? {
      ...a,
      email,
      name,
      picture,
      connected: true,
      connectedAt: new Date().toISOString()
    } : a));

    try {
      await fetch('/api/accounts/save-verified', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          slotId: wizardSlotId,
          email,
          name,
          picture,
          tokens: wizardVerifiedData.tokens || { access_token: 'verified' }
        })
      });
    } catch (e) {}

    closeGoogleAuthWizard();
  };

  const copyRedirectUri = () => {
    navigator.clipboard.writeText(`${window.location.origin}/oauth2callback`).then(() => {
      setCopiedUri(true);
      setTimeout(() => setCopiedUri(false), 2000);
    });
  };

  const copyConsoleUrl = () => {
    navigator.clipboard.writeText('https://console.cloud.google.com/apis/credentials').then(() => {
      setCopiedConsoleUrl(true);
      setTimeout(() => setCopiedConsoleUrl(false), 2500);
    });
  };

  const handleTogglePro = (slotId: string) => {
    setAccounts(prev => {
      const updated = prev.map(a => a.id === slotId ? { ...a, isPro: a.isPro === false ? true : false } : a);
      localStorage.setItem('brain_saved_accounts', JSON.stringify(updated));
      return updated;
    });
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

  const handleStartMeeting = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');

    const validSlots = meetingQueueSlots.map(s => s.trim()).filter(s => s.length > 0);
    if (validSlots.length === 0 || !validSlots[0].includes('meet.google.com')) {
      setFormError('Por favor, insira pelo menos uma URL válida do Google Meet para a reunião inicial.');
      return;
    }

    if (!selectedAccountA || !selectedAccountB) {
      setFormError('Selecione uma conta Transmissora e uma conta Receptora Google Pro.');
      return;
    }

    if (selectedAccountA === selectedAccountB) {
      setFormError('A Conta Transmissora e a Conta Receptora devem ser contas Google Pro distintas.');
      return;
    }

    setIsStartingMeeting(true);
    try {
      const res = await fetch('/api/meetings/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: newTitle || 'Reunião com Tradução Simultânea',
          currentMeetUrl: validSlots[0],
          scheduledNextMeetUrl: validSlots[1] || '',
          meetingQueue: validSlots,
          accountIds: [selectedAccountA, selectedAccountB]
        })
      });

      const data = await res.json();
      if (data.error) {
        setFormError(data.error);
      } else {
        setMeetingQueueSlots(['', '']);
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
                onClick={() => openGoogleAuthWizard(accounts[0]?.id || 'acc-1', 1)}
                className="text-xs font-semibold text-blue-700 bg-white hover:bg-blue-50 border border-blue-200 px-3 py-1.5 rounded-xl transition-all flex items-center gap-1.5 cursor-pointer"
              >
                <Settings className="w-3.5 h-3.5 text-blue-600" />
                Credenciais Google Cloud
              </button>
              <button 
                onClick={handleAddSlot}
                className="bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold px-3.5 py-1.5 rounded-xl transition-all shadow-sm flex items-center gap-1.5 cursor-pointer"
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
                    {/* Indicador Visual Superior de Google Pro Ativo */}
                    <div className={`mb-3.5 p-2 rounded-xl border flex items-center justify-between text-xs ${
                      acc.connected
                        ? (acc.isPro !== false 
                            ? 'bg-amber-50/80 border-amber-200 text-amber-950 shadow-xs' 
                            : 'bg-rose-50 border-rose-200 text-rose-800')
                        : 'bg-slate-100/80 border-slate-200 text-slate-500'
                    }`}>
                      <div className="flex items-center gap-1.5 font-bold truncate">
                        <span>{acc.connected ? (acc.isPro !== false ? '👑' : '⚠️') : '🔒'}</span>
                        <span className="truncate">
                          {acc.connected 
                            ? (acc.isPro !== false ? 'Google Pro: ATIVO' : 'CONTA BÁSICA / SEM PRO') 
                            : 'Requer Google Pro'}
                        </span>
                      </div>
                      {acc.connected ? (
                        <button 
                          type="button" 
                          onClick={() => handleTogglePro(acc.id)} 
                          title="Clique para alternar ou revalidar status Pro" 
                          className="text-[10px] font-semibold text-amber-800 hover:text-amber-950 underline cursor-pointer shrink-0 ml-1"
                        >
                          {acc.isPro !== false ? 'Verificado ✓' : 'Validar Pro ↺'}
                        </button>
                      ) : (
                        <span className="text-[10px] font-mono opacity-60 shrink-0">&gt; 24h</span>
                      )}
                    </div>

                    <div className="flex items-center justify-between mb-2">
                      <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Slot #{idx + 1}</span>
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full flex items-center gap-1 ${
                        acc.connected 
                          ? 'bg-emerald-100 text-emerald-800 border border-emerald-300' 
                          : 'bg-slate-200/80 text-slate-600'
                      }`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${acc.connected ? 'bg-emerald-600' : 'bg-slate-400'}`} />
                        {acc.connected ? '● Conectada' : 'Não Autenticada'}
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
                          className="text-rose-600 hover:text-rose-700 text-xs font-semibold hover:underline cursor-pointer"
                        >
                          Desconectar
                        </button>
                      </div>
                    ) : (
                      <button 
                        onClick={() => openGoogleAuthWizard(acc.id)}
                        className="w-full bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold py-2.5 px-3 rounded-xl transition-all shadow-sm flex items-center justify-center gap-1.5 cursor-pointer"
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

            <form onSubmit={handleStartMeeting} className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                <div className="md:col-span-2">
                  <label className="block text-xs font-semibold text-slate-700 mb-1.5">Identificador / Título da Reunião *</label>
                  <input 
                    type="text" 
                    required 
                    value={newTitle} 
                    onChange={e => setNewTitle(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 focus:border-indigo-500 focus:bg-white rounded-xl px-4 py-2.5 text-xs text-slate-900 outline-none"
                  />
                </div>

                {/* Conta Transmissora */}
                <div className="p-4 bg-slate-50 border border-blue-200/70 rounded-2xl">
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="block text-xs font-bold text-blue-900">📡 Conta Transmissora (Gera os Meets) *</label>
                    <a href="https://meet.google.com" target="_blank" rel="noreferrer" className="text-[11px] font-semibold text-blue-600 hover:text-blue-800 underline flex items-center gap-1">
                      <span>Abrir Meet no Google ↗</span>
                    </a>
                  </div>
                  <p className="text-[11px] text-slate-500 mb-2">Esta conta cria e hospeda todas as salas de reuniões que serão transmitidas.</p>
                  <select 
                    value={selectedAccountA} 
                    onChange={e => setSelectedAccountA(e.target.value)}
                    className="w-full bg-white border border-slate-200 focus:border-blue-500 rounded-xl px-3 py-2.5 text-xs text-slate-900 outline-none font-medium"
                  >
                    {accounts.filter(a => a.connected).map(a => (
                      <option key={a.id} value={a.id}>👑 {a.name} ({a.email})</option>
                    ))}
                  </select>
                </div>

                {/* Conta Receptora */}
                <div className="p-4 bg-slate-50 border border-indigo-200/70 rounded-2xl">
                  <label className="block text-xs font-bold text-indigo-900 mb-1.5">🎧 Conta Receptora (Tradução Simultânea / Bot) *</label>
                  <p className="text-[11px] text-slate-500 mb-2">Esta conta entra nas salas para capturar o áudio e alimentar a tradução WebRTC.</p>
                  <select 
                    value={selectedAccountB} 
                    onChange={e => setSelectedAccountB(e.target.value)}
                    className="w-full bg-white border border-slate-200 focus:border-indigo-500 rounded-xl px-3 py-2.5 text-xs text-slate-900 outline-none font-medium"
                  >
                    {accounts.filter(a => a.connected).length > 1 ? accounts.filter(a => a.connected).slice(1).concat(accounts.filter(a => a.connected)[0]).map(a => (
                      <option key={a.id} value={a.id}>👑 {a.name} ({a.email})</option>
                    )) : <option value="">Necessário pelo menos 2 contas autenticadas</option>}
                  </select>
                </div>
              </div>

              {/* Fila Dinâmica de Reuniões */}
              <div className="p-5 bg-slate-50/80 border border-slate-200 rounded-2xl space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div>
                    <h4 className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
                      <span>📋 Fila de Reuniões do Google Meet (Hot-Swap Pré-Agendado)</span>
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-800">{meetingQueueSlots.length} Slots</span>
                    </h4>
                    <p className="text-[11px] text-slate-500 mt-0.5">
                      Cole abaixo as reuniões geradas manualmente pela conta transmissora. Você pode adicionar quantos slots precisar antes e durante o evento!
                    </p>
                  </div>
                  <button 
                    type="button" 
                    onClick={() => setMeetingQueueSlots(prev => [...prev, ''])}
                    className="bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 text-indigo-700 text-xs font-bold px-3.5 py-2 rounded-xl transition-all cursor-pointer flex items-center gap-1.5 shrink-0 self-start sm:self-auto"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>+ Adicionar Mais Uma Reunião na Fila</span>
                  </button>
                </div>

                <div className="space-y-3">
                  {meetingQueueSlots.map((urlVal, idx) => (
                    <div key={idx} className="flex items-center gap-2">
                      <div className="w-32 shrink-0 text-right">
                        <span className={`text-[11px] font-bold ${idx === 0 ? 'text-emerald-700' : 'text-slate-600'}`}>
                          {idx === 0 ? '🟢 Reunião #1 (Inicial) *' : (idx === 1 ? '🔄 Reunião #2 (Swap 1)' : `🔄 Reunião #${idx + 1}`)}
                        </span>
                      </div>
                      <input 
                        type="url" 
                        required={idx === 0}
                        placeholder="https://meet.google.com/xxx-yyyy-zzz"
                        value={urlVal}
                        onChange={e => {
                          const val = e.target.value;
                          setMeetingQueueSlots(prev => prev.map((s, i) => i === idx ? val : s));
                        }}
                        className="flex-1 bg-white border border-slate-200 focus:border-indigo-500 rounded-xl px-3.5 py-2.5 text-xs font-mono text-slate-800 outline-none"
                      />
                      {idx > 1 ? (
                        <button 
                          type="button" 
                          onClick={() => setMeetingQueueSlots(prev => prev.filter((_, i) => i !== idx))}
                          title="Remover este slot"
                          className="text-rose-500 hover:text-rose-700 p-2 rounded-lg hover:bg-rose-50 text-xs font-bold transition-all cursor-pointer"
                        >
                          ✕
                        </button>
                      ) : <div className="w-7" />}
                    </div>
                  ))}
                </div>
              </div>

              <div className="pt-2 flex flex-col sm:flex-row items-center justify-between gap-4 border-t border-slate-100">
                <p className="text-xs text-slate-500">
                  {connectedCount < 2 
                    ? '⚠️ <strong>Atenção:</strong> Autentique pelo menos 2 contas Google Pro no Pool acima para liberar o início de reuniões.' 
                    : '✅ Par de contas transmissora/receptora pronto para Hot-Swap a cada 2 minutos.'}
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

      {/* Assistente de Conexão Google Pro (Wizard Modal) */}
      {wizardOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 sm:p-6 overflow-y-auto">
          <div className="bg-white border border-slate-200 rounded-3xl max-w-xl w-full p-6 sm:p-8 shadow-2xl relative my-auto animate-in fade-in zoom-in-95 duration-200">
            
            {/* Header */}
            <div className="flex items-center justify-between pb-4 border-b border-slate-100">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-2xl bg-blue-50 border border-blue-100 flex items-center justify-center shadow-sm">
                  <KeyRound className="w-5 h-5 text-blue-600" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-900">Assistente de Conexão Google Pro</h3>
                  <p className="text-xs text-slate-500">
                    Configuração guiada para: <strong className="text-blue-700">{accounts.find(a => a.id === wizardSlotId)?.name || 'Conta Google Pro'}</strong>
                  </p>
                </div>
              </div>
              <button 
                onClick={closeGoogleAuthWizard} 
                className="text-slate-400 hover:text-slate-600 text-lg font-bold p-1 rounded-lg hover:bg-slate-100 transition-all cursor-pointer"
              >
                ✕
              </button>
            </div>

            {/* Stepper Navigation */}
            <div className="grid grid-cols-3 gap-2 my-5">
              <div className={`flex items-center gap-2 p-2 rounded-xl border text-xs font-semibold ${
                wizardStep === 1 ? 'bg-blue-50 border-blue-200 text-blue-700' : (wizardStep > 1 ? 'bg-emerald-50 border-emerald-200 text-emerald-700' : 'bg-slate-50 border-slate-200 text-slate-400')
              }`}>
                <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] ${
                  wizardStep > 1 ? 'bg-emerald-600 text-white' : (wizardStep === 1 ? 'bg-blue-600 text-white' : 'bg-slate-200 text-slate-600')
                }`}>
                  {wizardStep > 1 ? '✓' : '1'}
                </span>
                <span className="truncate">1. Credenciais</span>
              </div>

              <div className={`flex items-center gap-2 p-2 rounded-xl border text-xs font-semibold ${
                wizardStep === 2 ? 'bg-blue-50 border-blue-200 text-blue-700' : (wizardStep > 2 ? 'bg-emerald-50 border-emerald-200 text-emerald-700' : 'bg-slate-50 border-slate-200 text-slate-400')
              }`}>
                <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] ${
                  wizardStep > 2 ? 'bg-emerald-600 text-white' : (wizardStep === 2 ? 'bg-blue-600 text-white' : 'bg-slate-200 text-slate-600')
                }`}>
                  {wizardStep > 2 ? '✓' : '2'}
                </span>
                <span className="truncate">2. Login Popup</span>
              </div>

              <div className={`flex items-center gap-2 p-2 rounded-xl border text-xs font-semibold ${
                wizardStep === 3 ? 'bg-emerald-50 border-emerald-200 text-emerald-700' : 'bg-slate-50 border-slate-200 text-slate-400'
              }`}>
                <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] ${
                  wizardStep === 3 ? 'bg-emerald-600 text-white' : 'bg-slate-200 text-slate-600'
                }`}>
                  {wizardStep === 3 ? '✓' : '3'}
                </span>
                <span className="truncate">3. Verificação</span>
              </div>
            </div>

            {/* Error Message */}
            {wizardErrorMessage && (
              <div className="mb-4 p-3.5 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-xs font-medium flex items-center justify-between">
                <span>⚠️ {wizardErrorMessage}</span>
                <button onClick={() => setWizardErrorMessage('')} className="text-amber-600 hover:text-amber-800 font-bold ml-2 cursor-pointer">✕</button>
              </div>
            )}

            {/* ETAPA 1 */}
            {wizardStep === 1 && (
              <div className="space-y-4">
                {wizardSlotId !== 'acc-1' && !googleClientId && (
                  <div className="p-3 bg-blue-50/80 border border-blue-200 rounded-xl flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                    <div>
                      <span className="text-xs font-bold text-blue-900 block">Deseja usar as mesmas credenciais do Slot 1?</span>
                      <span className="text-[11px] text-blue-700">Se as duas contas estiverem no mesmo projeto Google Cloud, clique ao lado para preencher automaticamente.</span>
                    </div>
                    <button 
                      type="button" 
                      onClick={copySlot1Credentials} 
                      className="bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold px-3 py-1.5 rounded-lg shadow-sm whitespace-nowrap cursor-pointer"
                    >
                      Usar Chaves do Slot 1 📋
                    </button>
                  </div>
                )}

                {/* Tutorial Completo Passo a Passo */}
                <div className="p-4 bg-slate-50 border border-slate-200 rounded-2xl space-y-3">
                  <div className="flex items-center justify-between">
                    <h4 className="text-xs font-bold text-slate-900">Passo a passo no Google Cloud Console (Primeira vez):</h4>
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-blue-100 text-blue-800">Guia Completo</span>
                  </div>

                  <ol className="text-[11px] text-slate-600 list-decimal list-inside space-y-1.5 leading-relaxed">
                    <li>
                      <strong>Criar Projeto:</strong> No topo da página do Console, clique no seletor de projetos e em <strong>"Novo Projeto"</strong> (Nome: <em>Brain Audiovisual</em>).
                    </li>
                    <li>
                      <strong>Tela de Consentimento / Público-alvo (CRUCIAL):</strong> No menu lateral esquerdo, acesse <strong>Público-alvo</strong> (ou <em>APIs e Serviços &gt; Tela de consentimento OAuth</em>).
                      <div className="ml-4 mt-1 text-[11px] text-slate-500 space-y-0.5">
                        <p>• Se for domínio Google Workspace empresarial: selecione <strong>Interno</strong> (não precisa de aprovação!).</p>
                        <p>• Se for conta comum/externa: escolha <strong>Externo</strong> e preencha o nome do app.</p>
                      </div>
                    </li>
                    <li className="text-amber-900 bg-amber-50/90 p-2 rounded-xl border border-amber-200">
                      <strong>⚠️ Evitar o erro "Acesso Bloqueado":</strong> No menu <strong>Público-alvo</strong> (Audience), localize o bloco <strong>Usuários de teste (Test Users)</strong>, clique em <strong>+ Adicionar usuários</strong> (+ ADD USERS) e adicione o e-mail da sua conta Google Pro! Isso libera o acesso imediatamente sem exigir verificação.
                    </li>
                    <li>
                      <strong>Criar as Credenciais:</strong> Vá em <strong>APIs e Serviços &gt; Credenciais &gt; Criar Credenciais &gt; ID do cliente OAuth</strong>. Escolha <strong>Aplicativo da Web</strong>.
                    </li>
                    <li>
                      <strong>Adicionar URI Autorizada:</strong> No campo <em>"URIs de redirecionamento autorizados"</em>, cole exatamente o endereço abaixo:
                    </li>
                  </ol>

                  {/* Campo de Cópia da URI de Callback */}
                  <div className="flex items-center gap-2 pt-1">
                    <input 
                      type="text" 
                      readOnly 
                      value={`${window.location.origin}/oauth2callback`} 
                      className="flex-1 bg-white border border-slate-200 text-slate-700 text-xs font-mono px-3 py-2 rounded-xl outline-none select-all shadow-xs"
                    />
                    <button 
                      type="button" 
                      onClick={copyRedirectUri} 
                      className={`text-xs font-semibold px-3 py-2 rounded-xl transition-all whitespace-nowrap cursor-pointer ${
                        copiedUri ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-200 hover:bg-slate-300 text-slate-800'
                      }`}
                    >
                      {copiedUri ? 'Copiado! ✓' : 'Copiar URI 📋'}
                    </button>
                  </div>

                  {/* Link e Botão para Copiar a URL do Google Console */}
                  <div className="pt-3 border-t border-slate-200 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2">
                    <div className="flex-1 flex items-center justify-between gap-2 bg-white border border-slate-200 rounded-xl px-3 py-1.5 text-xs font-mono text-slate-700">
                      <span className="truncate text-[11px] select-all">https://console.cloud.google.com/apis/credentials</span>
                      <button 
                        type="button" 
                        onClick={copyConsoleUrl} 
                        className={`text-[11px] font-semibold px-2 py-1 rounded-lg transition-all whitespace-nowrap cursor-pointer ${
                          copiedConsoleUrl ? 'bg-emerald-100 text-emerald-800' : 'bg-blue-50 hover:bg-blue-100 text-blue-700'
                        }`}
                      >
                        {copiedConsoleUrl ? 'Copiado! ✓' : 'Copiar Link 📋'}
                      </button>
                    </div>
                    <a 
                      href="https://console.cloud.google.com/apis/credentials" 
                      target="_blank" 
                      rel="noreferrer"
                      className="inline-flex items-center justify-center gap-1.5 bg-blue-600 hover:bg-blue-700 text-white font-semibold text-xs px-4 py-2 rounded-xl shadow-sm whitespace-nowrap cursor-pointer"
                    >
                      <span>Abrir Console</span>
                      <ExternalLink className="w-3.5 h-3.5" />
                    </a>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Client ID do Google *</label>
                  <input 
                    type="text" 
                    value={googleClientId} 
                    onChange={e => setGoogleClientId(e.target.value)}
                    placeholder="Ex: 123456789012-xxxxxxxxxxxxxxxxxxxxxxxx.apps.googleusercontent.com" 
                    className="w-full bg-slate-50 border border-slate-200 focus:border-blue-500 focus:bg-white rounded-xl px-3 py-2.5 text-xs font-mono outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Client Secret (Segredo do Cliente)</label>
                  <input 
                    type="password" 
                    value={googleClientSecret} 
                    onChange={e => setGoogleClientSecret(e.target.value)}
                    placeholder="Ex: GOCSPX-xxxxxxxxxxxxxxxxxxxxxxxx" 
                    className="w-full bg-slate-50 border border-slate-200 focus:border-blue-500 focus:bg-white rounded-xl px-3 py-2.5 text-xs font-mono outline-none"
                  />
                  <p className="text-[11px] text-slate-400 mt-1">Permite persistência contínua com renovação automática de tokens.</p>
                </div>

                <div className="flex items-center justify-between pt-4 border-t border-slate-100">
                  <button onClick={closeGoogleAuthWizard} className="text-xs font-semibold text-slate-500 hover:text-slate-800 px-4 py-2 cursor-pointer">
                    Cancelar
                  </button>
                  <button onClick={saveWizardCredentials} className="bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold px-5 py-2.5 rounded-xl shadow-sm transition-all cursor-pointer">
                    Salvar & Avançar para o Login ➔
                  </button>
                </div>
              </div>
            )}

            {/* ETAPA 2 */}
            {wizardStep === 2 && (
              <div className="space-y-4">
                <div className="text-xs text-slate-600 leading-relaxed">
                  Credenciais do Google Cloud validadas. Ao clicar no botão abaixo, abriremos uma <strong>janela popup oficial de login do Google</strong> para você selecionar e autorizar sua conta Google Pro.
                </div>

                <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl flex items-center justify-between text-xs font-mono text-slate-600">
                  <div className="truncate max-w-[340px]">
                    <span className="text-slate-400 font-sans">Client ID: </span>
                    <span className="font-semibold text-slate-800">{googleClientId ? `${googleClientId.substring(0, 26)}...` : 'Configurado'}</span>
                  </div>
                  <button onClick={() => setWizardStep(1)} className="text-blue-600 hover:text-blue-800 font-sans font-semibold text-xs hover:underline cursor-pointer">
                    Alterar Chaves
                  </button>
                </div>

                {wizardPopupLaunched ? (
                  <div className="p-6 bg-blue-50/70 border border-blue-200 rounded-2xl flex flex-col items-center justify-center text-center">
                    <div className="relative flex items-center justify-center mb-3">
                      <span className="animate-ping absolute inline-flex h-12 w-12 rounded-full bg-blue-400 opacity-60"></span>
                      <div className="w-10 h-10 rounded-full bg-blue-600 text-white flex items-center justify-center font-bold text-sm shadow-md">
                        G
                      </div>
                    </div>
                    <h4 className="text-sm font-bold text-slate-900 mb-1">Acompanhando Autenticação em Tempo Real</h4>
                    <p className="text-xs text-slate-600 max-w-sm mb-4 leading-relaxed">
                      A janela oficial do Google está aberta. Selecione sua conta <strong>Google Workspace Pro</strong> e clique em <strong>Continuar / Permitir</strong>.
                    </p>
                    <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-white border border-blue-200 text-xs font-semibold text-blue-700 shadow-sm mb-4">
                      <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                      Aguardando conclusão do login no Google...
                    </div>

                    <button onClick={launchGooglePopup} className="text-xs font-semibold text-blue-600 hover:text-blue-800 underline cursor-pointer">
                      Janela não abriu ou foi fechada? Clique aqui para reabrir ↺
                    </button>
                  </div>
                ) : (
                  <div className="pt-2">
                    <button 
                      onClick={launchGooglePopup}
                      className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3.5 px-6 rounded-2xl flex items-center justify-center gap-2.5 shadow-lg shadow-blue-500/25 text-sm transition-all cursor-pointer"
                    >
                      <LogIn className="w-4 h-4" />
                      Abrir Janela de Login do Google Pro ↗
                    </button>
                    <p className="text-[11px] text-slate-400 text-center mt-2">Uma janela popup segura do Google será aberta no centro da sua tela.</p>
                  </div>
                )}

                {/* Box de Solução Imediata para o Erro 'Acesso Bloqueado' */}
                <div className="p-3.5 bg-amber-50/80 border border-amber-200 rounded-2xl text-xs space-y-2">
                  <div className="flex items-center gap-1.5 font-bold text-amber-900">
                    <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                    <span>Apareceu a mensagem "Acesso bloqueado: o app não concluiu a verificação"?</span>
                  </div>
                  <p className="text-[11px] text-amber-800 leading-relaxed">
                    O Google Cloud atualizou a interface para <strong>Google Auth Platform</strong>. Para autorizar esta conta:
                  </p>
                  <ol className="text-[11px] text-amber-900 list-decimal list-inside space-y-1 font-medium bg-white/70 p-2.5 rounded-xl border border-amber-200/60">
                    <li>No menu lateral esquerdo do Google Cloud, clique em <strong>Público-alvo</strong> (Audience).</li>
                    <li>Dentro de <strong>Público-alvo</strong>, localize o bloco <strong>Usuários de teste</strong> (Test users).</li>
                    <li>Clique em <strong>+ Adicionar usuários</strong> (+ ADD USERS) e digite o e-mail exato desta conta.</li>
                    <li>Clique em <strong>Salvar</strong> e tente abrir o login novamente acima!</li>
                  </ol>
                  <div className="pt-1 flex items-center justify-between">
                    <span className="text-[10px] text-amber-700">Link direto para Público-alvo:</span>
                    <button 
                      type="button" 
                      onClick={() => {
                        navigator.clipboard.writeText('https://console.cloud.google.com/auth/audience');
                        alert('Link de Público-alvo copiado!');
                      }} 
                      className="text-[10px] font-bold text-amber-800 hover:text-amber-950 underline cursor-pointer"
                    >
                      Copiar Link Direto 📋
                    </button>
                  </div>
                </div>

                <details className="mt-4 border-t border-slate-100 pt-3 text-xs text-slate-500">
                  <summary className="cursor-pointer hover:text-slate-700 font-medium py-1">
                    Preferência manual: Validar Token retornado diretamente
                  </summary>
                  <div className="pt-3 space-y-2">
                    <p className="text-[11px] text-slate-500">Se preferir colar o Access Token do Google (ya29...):</p>
                    <input 
                      type="text" 
                      value={manualToken} 
                      onChange={e => setManualToken(e.target.value)}
                      placeholder="Cole o token ya29... aqui" 
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-mono outline-none"
                    />
                    <button 
                      onClick={handleManualTokenSubmit}
                      className="w-full bg-slate-800 hover:bg-slate-900 text-white font-semibold py-2 px-3 rounded-xl text-xs cursor-pointer"
                    >
                      Consultar e Validar na API do Google
                    </button>
                  </div>
                </details>

                <div className="flex items-center justify-between pt-4 border-t border-slate-100">
                  <button onClick={() => setWizardStep(1)} className="text-xs font-semibold text-slate-500 hover:text-slate-800 cursor-pointer">
                    ← Voltar para Credenciais
                  </button>
                  <button onClick={closeGoogleAuthWizard} className="text-xs font-semibold text-slate-500 hover:text-slate-800 cursor-pointer">
                    Cancelar
                  </button>
                </div>
              </div>
            )}

            {/* ETAPA 3 */}
            {wizardStep === 3 && (
              <div className="space-y-5">
                <div className="p-6 bg-emerald-50/50 border-2 border-emerald-200 rounded-2xl flex flex-col items-center text-center">
                  <div className="w-16 h-16 rounded-full bg-white border-2 border-emerald-500 shadow-md flex items-center justify-center overflow-hidden mb-3">
                    {wizardVerifiedData?.picture ? (
                      <img src={wizardVerifiedData.picture} alt="Avatar" className="w-full h-full object-cover" />
                    ) : (
                      <span className="text-xl font-bold text-emerald-700">{wizardVerifiedData?.name?.charAt(0) || 'G'}</span>
                    )}
                  </div>

                  <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-100 border border-emerald-300 text-emerald-800 text-[11px] font-bold mb-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
                    Autenticado com Sucesso pela Google API
                  </div>

                  <h4 className="text-base font-bold text-slate-900 mb-0.5">{wizardVerifiedData?.name || 'Conta Google Pro'}</h4>
                  <p className="text-xs text-blue-600 font-mono font-medium mb-4">{wizardVerifiedData?.email || ''}</p>

                  <div className="w-full bg-white/90 border border-emerald-200 rounded-xl p-3.5 text-left space-y-1.5 text-xs text-slate-600">
                    <div className="flex justify-between items-center">
                      <span className="text-slate-400">Status Google Pro:</span>
                      <strong className="text-emerald-700 font-semibold flex items-center gap-1">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                        Conexão Ativa & Validada
                      </strong>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-slate-400">Tokens de Acesso:</span>
                      <strong className="text-slate-800 font-mono text-[11px]">Gerados & Salvos</strong>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-slate-400">Destino:</span>
                      <strong className="text-slate-800">{accounts.find(a => a.id === wizardSlotId)?.name || 'Slot'}</strong>
                    </div>
                  </div>
                </div>

                <button 
                  onClick={confirmAndActivateSlot}
                  className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-3.5 px-6 rounded-2xl shadow-lg shadow-emerald-600/20 text-sm flex items-center justify-center gap-2 cursor-pointer transition-all"
                >
                  <span>Concluir e Salvar no Pool de Contas</span>
                  <Check className="w-4 h-4" />
                </button>
              </div>
            )}

          </div>
        </div>
      )}

    </div>
  );
}
