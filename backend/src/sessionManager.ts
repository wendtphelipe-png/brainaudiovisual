import { accountManager } from './accountManager';

export interface MeetingTranscription {
    id: string;
    speaker: string;
    originalText: string;
    translatedText: string;
    timestamp: string;
    language: string;
}

export interface MeetingTelemetry {
    latencyMs: number;
    jitterMs: number;
    packetLossPct: number;
    bitrateKbps: number;
    networkQuality: 'excellent' | 'good' | 'poor';
    audioLevelPct: number;
    activeBotInstance: string;
    transitionBotInstance?: string | null;
}

export interface MeetingSession {
    id: string;
    title: string;
    currentMeetUrl: string;
    scheduledNextMeetUrl: string;
    meetingQueue?: string[];
    currentQueueIndex?: number;
    accountIds: [string, string]; // [transmissor, receptor]
    status: 'active' | 'transitioning' | 'scheduled' | 'ended';
    createdAt: string;
    startedAt: string;
    nextSwapInSeconds: number;
    totalDurationSeconds: number;
    audioRoomName: string;
    sourceLanguage?: string;
    targetLanguage?: string;
    transmitterInputDevice?: string;
    receiverOutputDevice?: string;
    telemetry: MeetingTelemetry;
    transcriptions: MeetingTranscription[];
}

class SessionManager {
    private sessions: Map<string, MeetingSession> = new Map();
    private timerInterval: NodeJS.Timeout | null = null;

    constructor() {
        this.createInitialDemoSession();
        this.startBackgroundMonitoring();
    }

    private createInitialDemoSession() {
        const id = 'reuniao-01';
        const session: MeetingSession = {
            id,
            title: 'Keynote Executivo Global — Tradução Simultânea',
            currentMeetUrl: 'https://meet.google.com/abc-defg-hij',
            scheduledNextMeetUrl: 'https://meet.google.com/klm-nopq-rst',
            accountIds: ['acc-1', 'acc-2'],
            status: 'active',
            createdAt: new Date().toISOString(),
            startedAt: new Date().toISOString(),
            nextSwapInSeconds: 3120, // ~52 minutos restantes para a troca de 1h
            totalDurationSeconds: 480,
            audioRoomName: 'evento-01',
            telemetry: {
                latencyMs: 142,
                jitterMs: 3.2,
                packetLossPct: 0.0,
                bitrateKbps: 128,
                networkQuality: 'excellent',
                audioLevelPct: 82,
                activeBotInstance: 'bot-pro-01',
                transitionBotInstance: null
            },
            transcriptions: [
                {
                    id: 'tr-1',
                    speaker: 'Palestrante (CEO)',
                    originalText: 'Welcome everyone to our global summit today.',
                    translatedText: 'Bem-vindos a todos ao nosso summit global hoje.',
                    timestamp: '22:30:15',
                    language: 'EN ➔ PT'
                },
                {
                    id: 'tr-2',
                    speaker: 'Palestrante (CEO)',
                    originalText: 'We are demonstrating real-time ultra-low latency audio translation.',
                    translatedText: 'Estamos demonstrando tradução de áudio em tempo real com ultra-baixa latência.',
                    timestamp: '22:30:28',
                    language: 'EN ➔ PT'
                },
                {
                    id: 'tr-3',
                    speaker: 'Palestrante (CEO)',
                    originalText: 'Our listeners are connecting seamlessly via WebRTC with sub-second delay.',
                    translatedText: 'Nossos ouvintes conectam-se de forma transparente via WebRTC com delay sub-segundo.',
                    timestamp: '22:30:42',
                    language: 'EN ➔ PT'
                }
            ]
        };
        this.sessions.set(id, session);
    }

    private startBackgroundMonitoring() {
        this.timerInterval = setInterval(() => {
            for (const session of this.sessions.values()) {
                if (session.status === 'active') {
                    session.totalDurationSeconds += 1;
                    if (session.nextSwapInSeconds > 0) {
                        session.nextSwapInSeconds -= 1;
                    }

                    // Flutuações realistas de telemetria WebRTC
                    session.telemetry.latencyMs = Math.round(135 + Math.random() * 25);
                    session.telemetry.jitterMs = parseFloat((2.5 + Math.random() * 2).toFixed(1));
                    session.telemetry.audioLevelPct = Math.round(65 + Math.random() * 30);
                }
            }
        }, 1000);
    }

    public getSessions(): MeetingSession[] {
        return Array.from(this.sessions.values());
    }

    public getSession(id: string): MeetingSession | undefined {
        return this.sessions.get(id);
    }

    public createSession(data: {
        title: string;
        currentMeetUrl: string;
        scheduledNextMeetUrl?: string;
        meetingQueue?: string[];
        accountIds: [string, string];
        audioRoomName?: string;
        sourceLanguage?: string;
        targetLanguage?: string;
        transmitterInputDevice?: string;
        receiverOutputDevice?: string;
    }): MeetingSession {
        const id = `meet-${Date.now().toString(36)}`;
        const audioRoom = data.audioRoomName || id;
        const queue = data.meetingQueue && data.meetingQueue.length > 0 ? data.meetingQueue : [data.currentMeetUrl];

        const newSession: MeetingSession = {
            id,
            title: data.title || `Reunião Traduzida ${id}`,
            currentMeetUrl: queue[0] || data.currentMeetUrl,
            scheduledNextMeetUrl: queue[1] || data.scheduledNextMeetUrl || '',
            meetingQueue: queue,
            currentQueueIndex: 0,
            accountIds: data.accountIds,
            status: 'active',
            createdAt: new Date().toISOString(),
            startedAt: new Date().toISOString(),
            nextSwapInSeconds: 120, // 2 minutos para modo de teste acelerado!
            totalDurationSeconds: 0,
            audioRoomName: audioRoom,
            sourceLanguage: data.sourceLanguage || 'en-US',
            targetLanguage: data.targetLanguage || 'pt-BR',
            transmitterInputDevice: data.transmitterInputDevice || 'event-line',
            receiverOutputDevice: data.receiverOutputDevice || 'cable',
            telemetry: {
                latencyMs: 140,
                jitterMs: 3.0,
                packetLossPct: 0.0,
                bitrateKbps: 128,
                networkQuality: 'excellent',
                audioLevelPct: 75,
                activeBotInstance: `bot-${data.accountIds[0]}`,
                transitionBotInstance: null
            },
            transcriptions: [
                {
                    id: `tr-${Date.now()}`,
                    speaker: 'Sistema',
                    originalText: 'Session initiated with dual Google Meet Pro accounts.',
                    translatedText: 'Sessão iniciada com par de contas Google Meet Pro. Transmissão de áudio pronta.',
                    timestamp: new Date().toLocaleTimeString('pt-BR'),
                    language: 'SISTEMA'
                }
            ]
        };

        this.sessions.set(id, newSession);
        return newSession;
    }

    public triggerHotSwap(id: string): boolean {
        const session = this.sessions.get(id);
        if (!session) return false;

        session.status = 'transitioning';
        session.telemetry.transitionBotInstance = `bot-swap-${Date.now()}`;

        // Transição suave de sobreposição
        setTimeout(() => {
            if (session.meetingQueue && session.meetingQueue.length > 0) {
                const nextIdx = (session.currentQueueIndex || 0) + 1;
                if (nextIdx < session.meetingQueue.length) {
                    session.currentQueueIndex = nextIdx;
                    session.currentMeetUrl = session.meetingQueue[nextIdx];
                    session.scheduledNextMeetUrl = session.meetingQueue[nextIdx + 1] || '';
                }
            } else if (session.scheduledNextMeetUrl) {
                session.currentMeetUrl = session.scheduledNextMeetUrl;
                session.scheduledNextMeetUrl = '';
            }

            session.status = 'active';
            session.telemetry.activeBotInstance = session.telemetry.transitionBotInstance || 'bot-pro-swap';
            session.telemetry.transitionBotInstance = null;
            session.nextSwapInSeconds = 120; // Reinicia para mais 2 minutos em modo teste
        }, 5000);

        return true;
    }

    public addMeetingToQueue(id: string, newUrl: string): MeetingSession | null {
        const session = this.sessions.get(id);
        if (!session) return null;

        if (!session.meetingQueue) {
            session.meetingQueue = [session.currentMeetUrl];
        }
        session.meetingQueue.push(newUrl.trim());

        if (!session.scheduledNextMeetUrl) {
            const nextIdx = (session.currentQueueIndex || 0) + 1;
            session.scheduledNextMeetUrl = session.meetingQueue[nextIdx] || '';
        }

        return session;
    }

    public stopSession(id: string): boolean {
        const session = this.sessions.get(id);
        if (session) {
            session.status = 'ended';
            return true;
        }
        return false;
    }

    public addTranscription(id: string, textOriginal: string, textTranslated: string, speaker: string = 'Orador'): boolean {
        const session = this.sessions.get(id);
        if (!session) return false;

        session.transcriptions.push({
            id: `tr-${Date.now()}`,
            speaker,
            originalText: textOriginal,
            translatedText: textTranslated,
            timestamp: new Date().toLocaleTimeString('pt-BR'),
            language: 'EN ➔ PT'
        });

        if (session.transcriptions.length > 100) {
            session.transcriptions.shift();
        }

        return true;
    }
}

export const sessionManager = new SessionManager();
