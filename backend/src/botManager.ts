import { startBot, BotInstance } from './bot';

export interface BotStatus {
    id: string;
    meetUrl: string;
    status: 'connecting' | 'active' | 'closing' | 'error';
    startedAt: string;
}

export interface ManagerStatus {
    activeBot: BotStatus | null;
    transitionBot: BotStatus | null;
    logs: string[];
}

class BotManager {
    private activeBot: BotInstance | null = null;
    private transitionBot: BotInstance | null = null;
    
    private activeStatus: BotStatus | null = null;
    private transitionStatus: BotStatus | null = null;

    private systemLogs: string[] = [];
    private maxLogs = 50;

    constructor() {
        this.addLog('Gerenciador de Bots Inicializado.');
    }

    public addLog(msg: string) {
        const timestamp = new Date().toLocaleTimeString('pt-BR');
        const logLine = `[${timestamp}] ${msg}`;
        console.log(logLine);
        this.systemLogs.unshift(logLine);
        if (this.systemLogs.length > this.maxLogs) {
            this.systemLogs.pop();
        }
    }

    public getLogs(): string[] {
        return this.systemLogs;
    }

    public getStatus(): ManagerStatus {
        return {
            activeBot: this.activeStatus,
            transitionBot: this.transitionStatus,
            logs: this.systemLogs
        };
    }

    public async stopAll() {
        this.addLog('Comando de parada total recebido.');
        
        if (this.activeBot) {
            this.addLog(`Encerrando bot ativo: ${this.activeBot.id}`);
            await this.activeBot.close().catch(console.error);
            this.activeBot = null;
            this.activeStatus = null;
        }

        if (this.transitionBot) {
            this.addLog(`Encerrando bot de transição: ${this.transitionBot.id}`);
            await this.transitionBot.close().catch(console.error);
            this.transitionBot = null;
            this.transitionStatus = null;
        }

        this.addLog('Todos os bots foram encerrados.');
    }

    public async swapTo(newMeetUrl: string): Promise<void> {
        // Normaliza a URL do Google Meet
        const cleanUrl = newMeetUrl.trim();
        
        // Evita reiniciar se já for a URL ativa e estiver funcionando
        if (this.activeStatus && this.activeStatus.meetUrl === cleanUrl && this.activeStatus.status === 'active') {
            this.addLog(`Solicitação ignorada: Bot ativo já está conectado a ${cleanUrl}`);
            return;
        }

        // Se houver uma transição em andamento, aborta ela antes de começar outra
        if (this.transitionBot) {
            this.addLog(`Interrompendo transição anterior para iniciar nova...`);
            await this.transitionBot.close().catch(console.error);
            this.transitionBot = null;
            this.transitionStatus = null;
        }

        const instanceId = Date.now().toString();
        this.addLog(`Iniciando hot-swap. Nova reunião: ${cleanUrl} (Instância: ${instanceId})`);

        const newStatus: BotStatus = {
            id: instanceId,
            meetUrl: cleanUrl,
            status: 'connecting',
            startedAt: new Date().toISOString()
        };

        // Se não há bot ativo, iniciamos como o bot principal diretamente
        if (!this.activeBot) {
            this.activeStatus = newStatus;
            this.addLog(`Nenhum bot ativo rodando. Iniciando ${instanceId} como ativo.`);
            
            try {
                const bot = await startBot(cleanUrl, instanceId);
                this.activeBot = bot;
                this.activeStatus.status = 'active';
                this.addLog(`Bot ${instanceId} está ativo e transmitindo.`);
            } catch (err: any) {
                this.addLog(`Falha ao iniciar bot ativo inicial: ${err.message || err}`);
                this.activeStatus = null;
                this.activeBot = null;
            }
            return;
        }

        // Se já temos um bot ativo, colocamos o novo bot em transição
        this.transitionStatus = newStatus;
        this.addLog(`Bot ${this.activeBot.id} continuará transmitindo em background durante o swap.`);

        try {
            // Inicia o bot de transição e aguarda ele estar 100% pronto (conectado e publicando no LiveKit)
            const bot = await startBot(cleanUrl, instanceId);
            this.transitionBot = bot;
            this.transitionStatus.status = 'active';
            
            this.addLog(`✅ Novo bot ${instanceId} está online e transmitindo!`);
            this.addLog(`Iniciando período de sobreposição (overlap) de 5 segundos para transição suave...`);
            
            // Período de overlap de 5 segundos para que a transição de áudio seja imperceptível
            await new Promise(resolve => setTimeout(resolve, 5000));
            
            this.addLog(`Encerrando bot antigo ${this.activeBot.id}...`);
            this.activeStatus.status = 'closing';
            
            await this.activeBot.close().catch(console.error);
            this.addLog(`Bot antigo ${this.activeBot.id} fechado com sucesso.`);

            // Promove o bot de transição a ativo
            this.activeBot = this.transitionBot;
            this.activeStatus = {
                ...this.transitionStatus,
                status: 'active'
            };
            
            this.transitionBot = null;
            this.transitionStatus = null;
            this.addLog(`🚀 Transição completa! Bot ${instanceId} agora é o bot ativo principal.`);

        } catch (err: any) {
            this.addLog(`❌ Falha na transição para o novo bot: ${err.message || err}`);
            if (this.transitionBot) {
                await this.transitionBot.close().catch(console.error);
            }
            this.transitionBot = null;
            this.transitionStatus = null;
            this.addLog(`Mantendo bot antigo ${this.activeBot.id} ativo.`);
        }
    }
}

export const botManager = new BotManager();
