import { google } from 'googleapis';
import * as fs from 'fs';
import * as path from 'path';
import { botManager } from './botManager';

const CREDENTIALS_PATH = path.join(__dirname, '..', 'credentials.json');
const TOKEN_PATH = path.join(__dirname, '..', 'token.json');

const SCOPES = [
    'https://www.googleapis.com/auth/calendar.readonly'
];

export interface CalendarEventInfo {
    id: string;
    summary: string;
    description: string;
    start: string;
    end: string;
    meetLink: string | null;
    isActive: boolean;
}

class CalendarService {
    private oAuth2Client: any = null;
    private autoSync = false;
    private pollingInterval: NodeJS.Timeout | null = null;
    private lastMeetLink: string | null = null;

    constructor() {
        this.initializeOAuthClient();
    }

    private initializeOAuthClient() {
        try {
            if (fs.existsSync(CREDENTIALS_PATH)) {
                const credentials = JSON.parse(fs.readFileSync(CREDENTIALS_PATH, 'utf8'));
                const { client_secret, client_id } = credentials.web;
                
                // Em produção, o redirectUri aponta para a própria porta do index.ts
                const redirectUri = process.env.REDIRECT_URI || 'http://localhost:3001/oauth2callback';
                
                this.oAuth2Client = new google.auth.OAuth2(
                    client_id,
                    client_secret,
                    redirectUri
                );

                this.loadToken();
            } else {
                console.warn('Google Calendar: credentials.json não encontrado na raiz do backend.');
            }
        } catch (e) {
            console.error('Google Calendar: Erro ao inicializar o cliente OAuth2:', e);
        }
    }

    private loadToken() {
        try {
            if (fs.existsSync(TOKEN_PATH)) {
                const token = JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf8'));
                this.oAuth2Client.setCredentials(token);
                console.log('Google Calendar: Token carregado com sucesso!');
                
                // Se autoSync já estava ativo, reinicia o polling
                if (this.autoSync) {
                    this.startPolling();
                }
            }
        } catch (e) {
            console.error('Google Calendar: Erro ao carregar token.json:', e);
        }
    }

    public getOAuth2Client() {
        if (!this.oAuth2Client) {
            this.initializeOAuthClient();
        }
        return this.oAuth2Client;
    }

    public saveToken(tokens: any) {
        try {
            fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens));
            if (this.oAuth2Client) {
                this.oAuth2Client.setCredentials(tokens);
            }
            botManager.addLog('Google Calendar: Token de autenticação salvo com sucesso!');
            
            if (this.autoSync) {
                this.startPolling();
            }
        } catch (e: any) {
            botManager.addLog(`Google Calendar: Erro ao salvar token: ${e.message}`);
        }
    }

    public isConnected(): boolean {
        return this.oAuth2Client && this.oAuth2Client.credentials && !!this.oAuth2Client.credentials.access_token;
    }

    public getAuthUrl(): string {
        const client = this.getOAuth2Client();
        if (!client) {
            throw new Error('OAuth2 Client não está configurado. Verifique credentials.json');
        }
        return client.generateAuthUrl({
            access_type: 'offline',
            scope: SCOPES,
            prompt: 'consent'
        });
    }

    public toggleAutoSync(enable: boolean) {
        this.autoSync = enable;
        botManager.addLog(`Sincronização automática com calendário: ${enable ? 'LIGADA' : 'DESLIGADA'}`);
        
        if (enable) {
            this.startPolling();
        } else {
            this.stopPolling();
        }
    }

    public isAutoSyncEnabled(): boolean {
        return this.autoSync;
    }

    private startPolling() {
        this.stopPolling();
        
        if (!this.isConnected()) {
            botManager.addLog('Aviso: Sincronização automática ligada, mas o calendário não está autenticado.');
            return;
        }

        // Roda a primeira verificação imediatamente
        this.checkCalendarNow().catch(console.error);

        // Define o intervalo de 30 segundos
        this.pollingInterval = setInterval(() => {
            this.checkCalendarNow().catch(console.error);
        }, 30000);
        
        botManager.addLog('Polling do Google Calendar ativado (a cada 30s).');
    }

    private stopPolling() {
        if (this.pollingInterval) {
            clearInterval(this.pollingInterval);
            this.pollingInterval = null;
            botManager.addLog('Polling do Google Calendar desativado.');
        }
    }

    public async checkCalendarNow(): Promise<string | null> {
        if (!this.isConnected()) return null;

        try {
            const calendar = google.calendar({ version: 'v3', auth: this.oAuth2Client });
            const now = new Date();
            
            // Busca eventos do dia de hoje
            const timeMin = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
            const timeMax = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).toISOString();

            const res = await calendar.events.list({
                calendarId: 'primary',
                timeMin,
                timeMax,
                singleEvents: true,
                orderBy: 'startTime',
            });

            const events = res.data.items || [];
            const activeEvent = events.find(event => {
                if (!event.start?.dateTime || !event.end?.dateTime) return false;
                const start = new Date(event.start.dateTime);
                const end = new Date(event.end.dateTime);
                return now >= start && now <= end && !!event.hangoutLink;
            });

            if (activeEvent && activeEvent.hangoutLink) {
                const meetUrl = activeEvent.hangoutLink;
                
                // Se a URL mudou em relação à última detectada, dispara o hot-swap
                if (meetUrl !== this.lastMeetLink) {
                    botManager.addLog(`Calendário: Nova reunião ativa detectada: "${activeEvent.summary}" (${meetUrl})`);
                    this.lastMeetLink = meetUrl;
                    
                    // Executa a troca em background
                    botManager.swapTo(meetUrl).catch(err => {
                        botManager.addLog(`Erro ao efetuar swap pelo calendário: ${err.message || err}`);
                    });
                }
                return meetUrl;
            } else {
                if (this.lastMeetLink !== null) {
                    botManager.addLog('Calendário: Nenhuma reunião ativa detectada no momento.');
                    this.lastMeetLink = null;
                }
            }
        } catch (e: any) {
            botManager.addLog(`Calendário (Erro de Polling): ${e.message || e}`);
            // Se o token estiver vencido ou inválido, desativa para evitar loops de erro
            if (e.code === 401) {
                botManager.addLog('Erro 401: Token expirado ou inválido. Desativando sincronização automática.');
                this.toggleAutoSync(false);
            }
        }
        return null;
    }

    public async getUpcomingEvents(): Promise<CalendarEventInfo[]> {
        if (!this.isConnected()) return [];

        try {
            const calendar = google.calendar({ version: 'v3', auth: this.oAuth2Client });
            const now = new Date();
            
            const res = await calendar.events.list({
                calendarId: 'primary',
                timeMin: now.toISOString(),
                maxResults: 5,
                singleEvents: true,
                orderBy: 'startTime',
            });

            const events = res.data.items || [];
            return events.map(event => {
                const start = event.start?.dateTime || event.start?.date || '';
                const end = event.end?.dateTime || event.end?.date || '';
                const startTime = new Date(start);
                const endTime = new Date(end);
                
                return {
                    id: event.id || '',
                    summary: event.summary || 'Reunião sem título',
                    description: event.description || '',
                    start,
                    end,
                    meetLink: event.hangoutLink || null,
                    isActive: now >= startTime && now <= endTime && !!event.hangoutLink
                };
            });
        } catch (e: any) {
            console.error('Google Calendar: Erro ao carregar eventos:', e);
            return [];
        }
    }
}

export const calendarService = new CalendarService();
