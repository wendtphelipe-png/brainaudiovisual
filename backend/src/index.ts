import express from 'express';
import { AccessToken } from 'livekit-server-sdk';
import cors from 'cors';
import path from 'path';
import { botManager } from './botManager';
import { calendarService } from './calendar';

const app = express();
app.use(express.json());
app.use(cors());

// Serve os arquivos do Frontend compilado
app.use(express.static(path.join(__dirname, '../../frontend/dist')));

// Painel de Controle (Redireciona para o painel React premium)
app.get('/admin', (req: any, res: any) => {
    res.redirect('/?admin=true');
});

// Rota de Diagnóstico: Logs do sistema (direto do gerenciador na memória)
app.get('/api/logs', (req: any, res: any) => {
    res.json({ logs: botManager.getLogs() });
});

// Variáveis de ambiente ou fallback para desenvolvimento
const LIVEKIT_API_KEY = process.env.LIVEKIT_API_KEY || 'devkey';
const LIVEKIT_API_SECRET = process.env.LIVEKIT_API_SECRET || 'secret';

// Rota para iniciar/trocar o robô em uma reunião específica (Hot-Swap)
app.post('/api/start-bot', async (req: any, res: any) => {
    const { meetUrl } = req.body;
    
    if (!meetUrl || !meetUrl.includes('meet.google.com')) {
        return res.status(400).json({ error: 'Forneça uma URL válida do Google Meet.' });
    }

    try {
        // Dispara o hot-swap em background
        botManager.swapTo(meetUrl).catch(console.error);
        res.json({ message: 'Solicitação de troca enviada para o orquestrador!' });
    } catch (err: any) {
        res.status(500).json({ error: err.message || 'Falha ao iniciar o robô.' });
    }
});

// Rota para parar todos os robôs rodando
app.post('/api/stop-bot', async (req: any, res: any) => {
    try {
        await botManager.stopAll();
        res.json({ message: 'Todos os robôs foram interrompidos com sucesso!' });
    } catch (err: any) {
        res.status(500).json({ error: err.message || 'Falha ao parar robôs.' });
    }
});

// Rota para buscar o status detalhado dos robôs ativos/transição
app.get('/api/bot/status', (req: any, res: any) => {
    res.json(botManager.getStatus());
});

// Rota para buscar o status da sincronização de calendário
app.get('/api/calendar/status', async (req: any, res: any) => {
    try {
        const connected = calendarService.isConnected();
        const autoSync = calendarService.isAutoSyncEnabled();
        const upcoming = connected ? await calendarService.getUpcomingEvents() : [];
        res.json({ connected, autoSync, upcoming });
    } catch (e: any) {
        res.status(500).json({ error: e.message || 'Falha ao buscar status do calendário.' });
    }
});

// Rota para ativar/desativar sincronização automática com o calendário
app.post('/api/calendar/toggle', (req: any, res: any) => {
    const { enable } = req.body;
    calendarService.toggleAutoSync(!!enable);
    res.json({ autoSync: calendarService.isAutoSyncEnabled() });
});

// Rota para forçar sincronização manual imediata do calendário
app.post('/api/calendar/sync-now', async (req: any, res: any) => {
    try {
        const activeMeetUrl = await calendarService.checkCalendarNow();
        res.json({ success: true, activeMeetUrl });
    } catch (e: any) {
        res.status(500).json({ error: e.message || 'Falha ao sincronizar agora.' });
    }
});

// Rota para gerar URL do Consent Screen do Google OAuth2
app.get('/api/oauth/url', (req: any, res: any) => {
    try {
        const url = calendarService.getAuthUrl();
        res.json({ url });
    } catch (e: any) {
        res.status(500).json({ error: e.message || 'Falha ao gerar link OAuth2.' });
    }
});

// Rota de Callback do Google OAuth2 unificada na mesma porta do servidor
app.get('/oauth2callback', async (req: any, res: any) => {
    const code = req.query.code as string;
    
    if (!code) {
        return res.status(400).send('Erro: Código de autenticação ausente.');
    }

    try {
        const client = calendarService.getOAuth2Client();
        const { tokens } = await client.getToken(code);
        calendarService.saveToken(tokens);
        
        res.send(`
            <html>
                <head>
                    <title>Sucesso - BrainLingo</title>
                    <style>
                        body { font-family: Arial, sans-serif; background: #0f172a; color: white; display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; margin: 0; text-align: center; }
                        h1 { color: #10b981; }
                        .card { background: #1e293b; padding: 40px; border-radius: 16px; box-shadow: 0 10px 15px rgba(0,0,0,0.3); max-width: 400px; }
                        .loader { border: 4px solid #f3f3f3; border-top: 4px solid #10b981; border-radius: 50%; width: 40px; height: 40px; animation: spin 1s linear infinite; margin: 20px auto; }
                        @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
                    </style>
                </head>
                <body>
                    <div class="card">
                        <h1>Conexão Estabelecida!</h1>
                        <p>O BrainLingo se conectou com sucesso à sua conta Google Calendar.</p>
                        <div class="loader"></div>
                        <p style="color: #64748b; font-size: 14px;">Redirecionando de volta para o painel admin...</p>
                    </div>
                    <script>
                        setTimeout(() => {
                            window.location.href = '/?admin=true';
                        }, 3000);
                    </script>
                </body>
            </html>
        `);
    } catch (error: any) {
        console.error('Erro no callback OAuth:', error);
        res.status(500).send(`Falha na autorização: ${error.message}`);
    }
});

// Rota para o frontend gerar o token para o aluno que acessou via QR Code
app.post('/api/get-student-token', async (req: any, res: any) => {
    const { roomName, studentId } = req.body;
    
    if (!roomName) {
        return res.status(400).json({ error: 'Falta o roomName.' });
    }

    // Cria o token para o aluno (canSubscribe = true, canPublish = false)
    const at = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, {
        identity: studentId || `aluno-${Math.floor(Math.random() * 10000)}`,
    });
    
    at.addGrant({ roomJoin: true, room: roomName, canPublish: false, canSubscribe: true });
    
    res.json({ token: await at.toJwt() });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
    console.log(`\n========================================================`);
    console.log(`🚀 BrainLingo Backend rodando em http://localhost:${PORT}`);
    console.log(`========================================================\n`);
});
