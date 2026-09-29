import React, { useState } from 'react';
import { 
  Radio, Zap, Shield, Smartphone, Globe, ArrowRight, 
  Send, Check, Clock, Headphones, Settings, Activity,
  Layers, Volume2, CheckCircle2, ChevronRight, Sparkles
} from 'lucide-react';

interface ConstructionPageProps {
  onJoinRoom: (roomName: string) => void;
  onOpenAdmin: () => void;
}

export default function ConstructionPage({ onJoinRoom, onOpenAdmin }: ConstructionPageProps) {
  const [roomInput, setRoomInput] = useState<string>('evento-01');
  const [emailInput, setEmailInput] = useState<string>('');
  const [emailSubmitted, setEmailSubmitted] = useState<boolean>(false);
  const [isSubmittingEmail, setIsSubmittingEmail] = useState<boolean>(false);

  const handleRoomSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (roomInput.trim()) {
      onJoinRoom(roomInput.trim());
    }
  };

  const handleEmailSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!emailInput.trim() || !emailInput.includes('@')) return;

    setIsSubmittingEmail(true);
    setTimeout(() => {
      setIsSubmittingEmail(false);
      setEmailSubmitted(true);
      setEmailInput('');
    }, 700);
  };

  return (
    <div className="min-h-screen bg-slate-950 text-white font-sans selection:bg-blue-500/30 selection:text-blue-200 relative overflow-x-hidden">
      
      {/* Background Ambient Glows */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full max-w-7xl h-[550px] overflow-hidden pointer-events-none z-0">
        <div className="absolute -top-32 left-1/4 w-[500px] h-[500px] bg-blue-600/20 rounded-full blur-[140px] animate-pulse-glow" />
        <div className="absolute -top-20 right-1/4 w-[450px] h-[450px] bg-indigo-600/15 rounded-full blur-[130px] animate-pulse-glow" style={{ animationDelay: '3s' }} />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 w-[600px] h-[250px] bg-cyan-500/10 rounded-full blur-[120px]" />
      </div>

      {/* Header */}
      <header className="relative z-10 border-b border-slate-800/80 bg-slate-950/70 backdrop-blur-xl sticky top-0 px-6 sm:px-12 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-blue-600 to-cyan-500 flex items-center justify-center shadow-lg shadow-blue-500/20">
            <Radio className="w-5 h-5 text-white animate-pulse" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-extrabold text-lg tracking-tight bg-gradient-to-r from-white via-slate-100 to-slate-400 bg-clip-text text-transparent">
                Brain Audiovisual
              </span>
              <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-400 border border-blue-500/20">
                Em Construção
              </span>
            </div>
            <p className="text-[11px] text-slate-500">Live Audio & Simultaneous Translation</p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => onJoinRoom(roomInput || 'evento-01')}
            className="hidden sm:inline-flex items-center gap-2 text-xs font-semibold text-slate-300 hover:text-white bg-slate-900 hover:bg-slate-800 border border-slate-800 hover:border-slate-700 px-3.5 py-2 rounded-xl transition-all"
          >
            <Headphones className="w-3.5 h-3.5 text-blue-400" />
            Ouvir Demonstração
          </button>
          <button
            onClick={onOpenAdmin}
            className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-400 hover:text-slate-200 bg-slate-900/60 hover:bg-slate-800/80 border border-slate-800/80 px-3 py-2 rounded-xl transition-all"
          >
            <Settings className="w-3.5 h-3.5" />
            <span className="hidden md:inline">Painel Operador</span>
          </button>
        </div>
      </header>

      {/* Hero Section */}
      <main className="relative z-10 max-w-6xl mx-auto px-6 sm:px-12 pt-16 sm:pt-24 pb-20 flex flex-col items-center text-center">
        
        {/* Status Badge */}
        <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-slate-900/90 border border-blue-500/30 text-blue-300 text-xs font-semibold mb-8 shadow-xl shadow-blue-950/40 backdrop-blur-md">
          <Sparkles className="w-3.5 h-3.5 text-blue-400 animate-spin" style={{ animationDuration: '6s' }} />
          <span>ESTAMOS EM CONSTRUÇÃO • LANÇAMENTO OFICIAL EM BREVE</span>
        </div>

        {/* Main Title */}
        <h1 className="text-4xl sm:text-6xl md:text-7xl font-extrabold tracking-tight max-w-4xl leading-[1.1] mb-6">
          O Futuro da Tradução e Streaming Audiovisual{' '}
          <span className="bg-gradient-to-r from-blue-400 via-cyan-300 to-indigo-400 bg-clip-text text-transparent">
            em Tempo Real
          </span>
        </h1>

        {/* Subtitle */}
        <p className="text-slate-400 text-base sm:text-xl max-w-2xl leading-relaxed mb-12">
          Infraestrutura de distribuição de áudio via WebRTC nativo com latência sub-segundo (<span className="text-blue-400 font-semibold">&lt; 800ms</span>). Seu público ouve tudo pelo celular com zero aplicativos e zero fricção.
        </p>

        {/* Live Audio Test Card (Interactive Room Connector) */}
        <div className="w-full max-w-xl bg-slate-900/70 border border-slate-800/90 backdrop-blur-xl rounded-3xl p-6 sm:p-8 shadow-2xl relative overflow-hidden mb-14 text-left">
          <div className="absolute top-0 right-0 w-44 h-44 bg-blue-500/10 rounded-full blur-2xl pointer-events-none" />
          
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-blue-500/10 text-blue-400 flex items-center justify-center border border-blue-500/20">
                <Volume2 className="w-4 h-4" />
              </div>
              <h2 className="text-base font-bold text-slate-100">
                Acessar Sala de Transmissão Ao Vivo
              </h2>
            </div>
            <span className="text-[11px] font-medium text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2.5 py-0.5 rounded-full flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              Rede WebRTC Pronta
            </span>
          </div>

          <p className="text-xs text-slate-400 mb-5 leading-normal">
            Você já pode experimentar o player do ouvinte. Digite o identificador da sala do seu evento ou use a sala de testes:
          </p>

          <form onSubmit={handleRoomSubmit} className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <input
                type="text"
                value={roomInput}
                onChange={(e) => setRoomInput(e.target.value)}
                placeholder="Ex: evento-01"
                className="w-full bg-slate-950/80 border border-slate-800 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 rounded-xl px-4 py-3 text-sm text-slate-100 placeholder-slate-600 outline-none transition-all font-mono"
              />
            </div>
            <button
              type="submit"
              className="inline-flex items-center justify-center gap-2 bg-gradient-to-r from-blue-600 to-blue-500 hover:from-blue-500 hover:to-cyan-500 text-white font-semibold text-sm px-6 py-3 rounded-xl transition-all shadow-lg shadow-blue-600/30 hover:shadow-blue-500/50 hover:scale-[1.02] active:scale-[0.98]"
            >
              <span>Conectar ao Áudio</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </form>
        </div>

        {/* Development Progress & Milestones */}
        <div className="w-full max-w-3xl bg-slate-900/40 border border-slate-800/60 rounded-3xl p-6 sm:p-8 backdrop-blur-md mb-16 text-left">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6">
            <div>
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <Activity className="w-4 h-4 text-blue-400" />
                Status do Projeto & Roadmap
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">Etapas concluídas e preparação do ambiente Hostinger</p>
            </div>
            <div className="flex items-center gap-2 self-start sm:self-auto bg-blue-500/10 border border-blue-500/20 px-3 py-1 rounded-full text-xs font-bold text-blue-400">
              <div className="w-2 h-2 rounded-full bg-blue-400 animate-ping" />
              88% Concluído
            </div>
          </div>

          {/* Progress Bar */}
          <div className="w-full h-2.5 bg-slate-800/80 rounded-full overflow-hidden mb-6">
            <div className="h-full bg-gradient-to-r from-blue-500 via-cyan-400 to-emerald-400 rounded-full w-[88%] transition-all duration-1000" />
          </div>

          {/* Checkpoints Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 text-xs">
            <div className="flex items-center gap-2.5 p-3 rounded-xl bg-slate-950/60 border border-slate-800/60">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
              <span className="text-slate-300 font-medium">Pipeline WebRTC de Ultra-Baixa Latência</span>
            </div>
            <div className="flex items-center gap-2.5 p-3 rounded-xl bg-slate-950/60 border border-slate-800/60">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
              <span className="text-slate-300 font-medium">Robô de Captura Google Meet com Stealth</span>
            </div>
            <div className="flex items-center gap-2.5 p-3 rounded-xl bg-slate-950/60 border border-slate-800/60">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
              <span className="text-slate-300 font-medium">Failover & Hot-Swap de 90 Minutos</span>
            </div>
            <div className="flex items-center gap-2.5 p-3 rounded-xl bg-slate-950/60 border border-slate-800/60">
              <Clock className="w-4 h-4 text-amber-400 shrink-0 animate-spin" style={{ animationDuration: '8s' }} />
              <span className="text-slate-300 font-medium">Lançamento Aberto & Domínio Hostinger</span>
            </div>
          </div>
        </div>

        {/* Feature Pillars Grid */}
        <div className="w-full max-w-5xl text-left mb-16">
          <div className="text-center mb-10">
            <h2 className="text-xs font-semibold uppercase tracking-widest text-blue-400 mb-2">Engenharia de Ponta</h2>
            <h3 className="text-2xl sm:text-3xl font-extrabold text-white">Por que o Brain Audiovisual é Diferente</h3>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            
            {/* Card 1 */}
            <div className="bg-slate-900/50 border border-slate-800/80 hover:border-slate-700/80 p-6 rounded-2xl transition-all duration-300 hover:-translate-y-1">
              <div className="w-10 h-10 rounded-xl bg-blue-500/10 text-blue-400 flex items-center justify-center mb-4 border border-blue-500/20">
                <Zap className="w-5 h-5" />
              </div>
              <h4 className="text-base font-bold text-white mb-2">Latência Sub-segundo (&lt; 800ms)</h4>
              <p className="text-xs text-slate-400 leading-relaxed">
                Esqueça o atraso de 2 a 5 segundos do Zoom ou transmissões HTTP (HLS). Nosso fluxo WebRTC entrega voz no instante em que o tradutor fala.
              </p>
            </div>

            {/* Card 2 */}
            <div className="bg-slate-900/50 border border-slate-800/80 hover:border-slate-700/80 p-6 rounded-2xl transition-all duration-300 hover:-translate-y-1">
              <div className="w-10 h-10 rounded-xl bg-cyan-500/10 text-cyan-400 flex items-center justify-center mb-4 border border-cyan-500/20">
                <Smartphone className="w-5 h-5" />
              </div>
              <h4 className="text-base font-bold text-white mb-2">Zero Instalações (QR Code)</h4>
              <p className="text-xs text-slate-400 leading-relaxed">
                Sua plateia não precisa baixar nenhum aplicativo pesado. Basta apontar a câmera do celular para o QR Code da sala e dar play no navegador.
              </p>
            </div>

            {/* Card 3 */}
            <div className="bg-slate-900/50 border border-slate-800/80 hover:border-slate-700/80 p-6 rounded-2xl transition-all duration-300 hover:-translate-y-1">
              <div className="w-10 h-10 rounded-xl bg-indigo-500/10 text-indigo-400 flex items-center justify-center mb-4 border border-indigo-500/20">
                <Globe className="w-5 h-5" />
              </div>
              <h4 className="text-base font-bold text-white mb-2">Automação Google Meet & Calendar</h4>
              <p className="text-xs text-slate-400 leading-relaxed">
                Robôs inteligentes capturam o canal de tradução do Meet e gerenciam renovação de credenciais e troca invisível de salas com tolerância a falhas.
              </p>
            </div>

            {/* Card 4 */}
            <div className="bg-slate-900/50 border border-slate-800/80 hover:border-slate-700/80 p-6 rounded-2xl transition-all duration-300 hover:-translate-y-1">
              <div className="w-10 h-10 rounded-xl bg-emerald-500/10 text-emerald-400 flex items-center justify-center mb-4 border border-emerald-500/20">
                <Shield className="w-5 h-5" />
              </div>
              <h4 className="text-base font-bold text-white mb-2">Alta Escala e Estabilidade</h4>
              <p className="text-xs text-slate-400 leading-relaxed">
                Projetado para suportar desde pequenas reuniões executivas até auditórios com milhares de ouvintes simultâneos sem sobrecarga.
              </p>
            </div>

          </div>
        </div>

        {/* Lead Capture Newsletter */}
        <div className="w-full max-w-xl bg-gradient-to-b from-slate-900/80 to-slate-950 border border-slate-800/90 rounded-3xl p-6 sm:p-8 backdrop-blur-xl text-center shadow-xl mb-12">
          <h3 className="text-lg font-bold text-white mb-2">Deseja ser avisado no lançamento?</h3>
          <p className="text-xs text-slate-400 mb-6">
            Cadastre seu e-mail para receber acesso antecipado exclusivo e condições para seus próximos eventos.
          </p>

          {emailSubmitted ? (
            <div className="flex items-center justify-center gap-2 p-3.5 rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 text-xs font-semibold animate-fadeIn">
              <Check className="w-4 h-4 text-emerald-400" />
              <span>Obrigado! Seu e-mail foi cadastrado com sucesso.</span>
            </div>
          ) : (
            <form onSubmit={handleEmailSubmit} className="flex flex-col sm:flex-row gap-2.5">
              <input
                type="email"
                required
                value={emailInput}
                onChange={(e) => setEmailInput(e.target.value)}
                placeholder="seu.email@empresa.com"
                className="flex-1 bg-slate-950 border border-slate-800 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 rounded-xl px-4 py-2.5 text-xs text-white placeholder-slate-600 outline-none transition-all"
              />
              <button
                type="submit"
                disabled={isSubmittingEmail}
                className="inline-flex items-center justify-center gap-2 bg-slate-800 hover:bg-slate-700 text-slate-200 hover:text-white font-semibold text-xs px-5 py-2.5 rounded-xl transition-all border border-slate-700 disabled:opacity-60"
              >
                {isSubmittingEmail ? (
                  <div className="animate-spin w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full" />
                ) : (
                  <>
                    <span>Notificar-me</span>
                    <Send className="w-3.5 h-3.5" />
                  </>
                )}
              </button>
            </form>
          )}
        </div>

        {/* Technical Navigation Links (Quick Access to modules) */}
        <div className="flex flex-wrap items-center justify-center gap-4 text-xs text-slate-400">
          <span>Acesso rápido aos módulos:</span>
          <button
            onClick={() => onJoinRoom('evento-01')}
            className="text-blue-400 hover:text-blue-300 hover:underline flex items-center gap-1 font-medium"
          >
            Player do Ouvinte <ChevronRight className="w-3.5 h-3.5" />
          </button>
          <span>•</span>
          <button
            onClick={onOpenAdmin}
            className="text-slate-400 hover:text-slate-200 hover:underline flex items-center gap-1 font-medium"
          >
            Dashboard do Administrador <ChevronRight className="w-3.5 h-3.5" />
          </button>
        </div>

      </main>

      {/* Footer */}
      <footer className="relative z-10 border-t border-slate-900 bg-slate-950 py-8 px-6 text-center text-xs text-slate-600">
        <div className="max-w-6xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <Radio className="w-4 h-4 text-blue-500" />
            <span className="font-semibold text-slate-400">Brain Audiovisual</span>
            <span>— Todos os direitos reservados.</span>
          </div>
          <div className="text-slate-500 text-[11px]">
            Ambiente otimizado para Hostinger • WebRTC Sub-segundo
          </div>
        </div>
      </footer>

    </div>
  );
}
