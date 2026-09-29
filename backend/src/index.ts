import express from 'express';
import { AccessToken } from 'livekit-server-sdk';
import cors from 'cors';
import path from 'path';
import { botManager } from './botManager';
import { calendarService } from './calendar';
import { accountManager } from './accountManager';
import { sessionManager } from './sessionManager';

const app = express();
app.use(express.json());
app.use(cors());

// Serve os arquivos do Frontend compilado
app.use(express.static(path.join(__dirname, '../../frontend/dist')));

// Painel de Controle (Redireciona para o painel React premium)
app.get('/admin', (req: any, res: any) => {
    res.redirect('/?admin=true');
});

// Variáveis de ambiente ou fallback para desenvolvimento
const LIVEKIT_API_KEY = process.env.LIVEKIT_API_KEY || 'devkey';
const LIVEKIT_API_SECRET = process.env.LIVEKIT_API_SECRET || 'secret';

const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'BrainAdmin@2026';

// Sessões de administradores autenticados em memória (token -> expiresAt)
const activeAdminTokens = new Map<string, number>();

// ========================================================
// 0. AUTENTICAÇÃO DO ADMINISTRADOR
// ========================================================

app.post('/api/admin/login', (req: any, res: any) => {
    const { username, password } = req.body;

    if (!username || !password) {
        return res.status(400).json({ error: 'Usuário e senha são obrigatórios.' });
    }

    if (username.trim() === ADMIN_USERNAME && password === ADMIN_PASSWORD) {
        // Gera token de sessão válido por 24 horas
        const token = 'bat_' + Buffer.from(`${username}-${Date.now()}-${Math.random()}`).toString('hex');
        const expiresAt = Date.now() + 24 * 60 * 60 * 1000;
        activeAdminTokens.set(token, expiresAt);

        return res.json({ 
            success: true, 
            token, 
            username,
            expiresAt 
        });
    }

    return res.status(401).json({ error: 'Credenciais de administrador incorretas.' });
});

app.get('/api/admin/verify', (req: any, res: any) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ authenticated: false });
    }

    const token = authHeader.split(' ')[1];
    const expiresAt = activeAdminTokens.get(token);

    if (expiresAt && expiresAt > Date.now()) {
        return res.json({ authenticated: true, username: ADMIN_USERNAME });
    }

    activeAdminTokens.delete(token);
    return res.status(401).json({ authenticated: false, error: 'Sessão expirada.' });
});

app.post('/api/admin/logout', (req: any, res: any) => {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
        const token = authHeader.split(' ')[1];
        activeAdminTokens.delete(token);
    }
    res.json({ success: true });
});

// Checar e salvar credenciais do Google OAuth
app.get('/api/admin/google-status', (req: any, res: any) => {
    res.json({ hasCredentials: accountManager.hasGoogleCredentials() });
});

app.post('/api/admin/google-credentials', (req: any, res: any) => {
    const { clientId, clientSecret, redirectUri } = req.body;
    if (!clientId || !clientSecret) {
        return res.status(400).json({ error: 'Client ID e Client Secret são obrigatórios.' });
    }

    const saved = accountManager.saveGoogleCredentials(clientId, clientSecret, redirectUri);
    if (saved) {
        res.json({ success: true, message: 'Credenciais do Google salvas com sucesso!' });
    } else {
        res.status(500).json({ error: 'Falha ao salvar credentials.json no servidor.' });
    }
});

// ========================================================
// 1. ROTAS DE GERENCIAMENTO DE CONTAS GOOGLE PRO
// ========================================================

// Listar todas as contas / slots Google Pro
app.get('/api/accounts', (req: any, res: any) => {
    res.json({ accounts: accountManager.getAccounts() });
});

// Gerar link de login OAuth2 para uma conta/slot específico
app.get('/api/accounts/auth-url', (req: any, res: any) => {
    const slotId = (req.query.slot as string) || 'acc-1';
    try {
        const url = accountManager.getAuthUrlForSlot(slotId);
        res.json({ url });
    } catch (e: any) {
        res.status(500).json({ error: e.message || 'Falha ao gerar link OAuth2.' });
    }
});

// Adicionar um novo slot de conta Google Pro
app.post('/api/accounts/add-slot', (req: any, res: any) => {
    const { name } = req.body;
    const newSlot = accountManager.addSlot(name);
    res.json({ account: newSlot });
});

// Desconectar uma conta Google Pro
app.post('/api/accounts/disconnect', (req: any, res: any) => {
    const { id } = req.body;
    const success = accountManager.disconnectAccount(id);
    res.json({ success });
});

// Salvar conta verificada (via popup OAuth ou Google Identity Services)
app.post('/api/accounts/save-verified', (req: any, res: any) => {
    const { slotId, email, name, tokens, picture } = req.body;
    if (!slotId || !email) {
        return res.status(400).json({ error: 'slotId e email são obrigatórios.' });
    }
    const acc = accountManager.saveVerifiedAccount(slotId, email, name, tokens, picture);
    res.json({ success: true, account: acc });
});

// ========================================================
// 2. ROTAS DE SESSÕES & REUNIÕES MULTI-MEET
// ========================================================

// Listar todas as reuniões ativas e agendadas
app.get('/api/meetings', (req: any, res: any) => {
    res.json({ meetings: sessionManager.getSessions() });
});

// Buscar detalhes e telemetria de uma reunião específica
app.get('/api/meetings/:id', (req: any, res: any) => {
    const meeting = sessionManager.getSession(req.params.id);
    if (!meeting) {
        return res.status(404).json({ error: 'Reunião não encontrada.' });
    }
    res.json({ meeting });
});

// Iniciar uma nova reunião vinculando 2 contas Google Pro
app.post('/api/meetings/start', async (req: any, res: any) => {
    const { 
        title, 
        currentMeetUrl, 
        scheduledNextMeetUrl, 
        meetingQueue, 
        accountIds, 
        audioRoomName,
        sourceLanguage,
        targetLanguage,
        transmitterInputDevice,
        receiverOutputDevice
    } = req.body;

    const initialUrl = (meetingQueue && meetingQueue.length > 0) ? meetingQueue[0] : currentMeetUrl;
    if (!initialUrl || !initialUrl.includes('meet.google.com')) {
        return res.status(400).json({ error: 'Forneça uma URL válida do Google Meet.' });
    }

    if (!accountIds || !Array.isArray(accountIds) || accountIds.length < 2) {
        return res.status(400).json({ error: 'É necessário selecionar pelo menos 2 contas Google Pro para operar a tradução.' });
    }

    try {
        const session = sessionManager.createSession({
            title,
            currentMeetUrl: initialUrl,
            scheduledNextMeetUrl,
            meetingQueue: meetingQueue || [initialUrl],
            accountIds: [accountIds[0], accountIds[1]],
            audioRoomName,
            sourceLanguage,
            targetLanguage,
            transmitterInputDevice,
            receiverOutputDevice
        });

        // Dispara o robô de captura para este Meet
        botManager.swapTo(initialUrl).catch(console.error);

        res.json({ success: true, meeting: session });
    } catch (err: any) {
        res.status(500).json({ error: err.message || 'Falha ao iniciar reunião.' });
    }
});

// Enfileirar mais uma reunião do Meet durante a sessão
app.post('/api/meetings/:id/queue', (req: any, res: any) => {
    const { meetUrl } = req.body;
    if (!meetUrl || !meetUrl.includes('meet.google.com')) {
        return res.status(400).json({ error: 'Informe uma URL válida do Google Meet para enfileirar.' });
    }
    const session = sessionManager.addMeetingToQueue(req.params.id, meetUrl);
    if (!session) {
        return res.status(404).json({ error: 'Reunião não encontrada.' });
    }
    res.json({ success: true, meeting: session });
});

// Forçar hot-swap manual para a próxima reunião agendada
app.post('/api/meetings/:id/swap', (req: any, res: any) => {
    const success = sessionManager.triggerHotSwap(req.params.id);
    if (!success) {
        return res.status(404).json({ error: 'Reunião não encontrada para swap.' });
    }
    const meeting = sessionManager.getSession(req.params.id);
    if (meeting?.currentMeetUrl) {
        botManager.swapTo(meeting.currentMeetUrl).catch(console.error);
    }
    res.json({ success: true, meeting });
});

// Encerrar reunião
app.post('/api/meetings/:id/stop', (req: any, res: any) => {
    const success = sessionManager.stopSession(req.params.id);
    res.json({ success });
});

// ========================================================
// 3. CALLBACK UNIFICADO DO GOOGLE OAUTH2
// ========================================================
app.get('/oauth2callback', async (req: any, res: any) => {
    const code = req.query.code as string;
    const slotId = (req.query.state as string) || 'acc-1';
    
    if (!code) {
        return res.status(400).send('Erro: Código de autenticação ausente.');
    }

    try {
        const account = await accountManager.handleOAuthCallback(code, slotId);
        
        res.send(`
            <html>
                <head>
                    <title>Conta Conectada - Brain Audiovisual</title>
                    <style>
                        body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #030712; color: white; display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; margin: 0; text-align: center; }
                        h1 { color: #10b981; margin-bottom: 8px; }
                        .card { background: #111827; border: 1px solid rgba(255,255,255,0.1); padding: 40px; border-radius: 20px; box-shadow: 0 20px 40px rgba(0,0,0,0.5); max-width: 440px; }
                        .email { color: #60a5fa; font-weight: bold; margin: 12px 0; font-size: 15px; }
                        .loader { border: 3px solid #1f2937; border-top: 3px solid #10b981; border-radius: 50%; width: 36px; height: 36px; animation: spin 1s linear infinite; margin: 24px auto 12px; }
                        @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
                    </style>
                </head>
                <body>
                    <div class="card">
                        <h1>Conta Google Pro Conectada!</h1>
                        <p style="color: #94a3b8; font-size: 14px;">A conta abaixo foi autenticada e vinculada ao painel:</p>
                        <div class="email">${account.email}</div>
                        <div class="loader"></div>
                        <p style="color: #64748b; font-size: 13px;">Redirecionando de volta ao painel de administração...</p>
                    </div>
                    <script>
                        if (window.opener) {
                            try {
                                window.opener.postMessage({
                                    type: 'GOOGLE_AUTH_SUCCESS',
                                    slotId: '${slotId}',
                                    email: '${account.email}',
                                    name: '${account.name}'
                                }, '*');
                            } catch (e) {}
                            setTimeout(() => { window.close(); }, 1200);
                        } else {
                            setTimeout(() => {
                                window.location.href = '/?admin=true';
                            }, 2000);
                        }
                    </script>
                </body>
            </html>
        `);
    } catch (error: any) {
        console.error('Erro no callback OAuth:', error);
        res.status(500).send(`Falha na autorização: ${error.message}`);
    }
});

// ========================================================
// 4. TOKENS DE ÁUDIO (LIVEKIT) PARA MONITOR & ALUNOS
// ========================================================

// Rota para o frontend gerar o token para o ouvinte ou operador do Hub de Áudio
app.post('/api/get-audio-token', async (req: any, res: any) => {
    const { roomName, identity } = req.body;
    
    if (!roomName) {
        return res.status(400).json({ error: 'Falta o roomName.' });
    }

    const at = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, {
        identity: identity || `monitor-${Math.floor(Math.random() * 10000)}`,
        name: 'Operador de Áudio Traduzido'
    });
    
    at.addGrant({ roomJoin: true, room: roomName, canPublish: false, canSubscribe: true });
    
    res.json({ token: await at.toJwt() });
});

// Rota legada para o aluno
app.post('/api/get-student-token', async (req: any, res: any) => {
    const { roomName, studentId } = req.body;
    const room = roomName || 'evento-01';
    
    const at = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, {
        identity: studentId || `aluno-${Math.floor(Math.random() * 10000)}`,
    });
    at.addGrant({ roomJoin: true, room, canPublish: false, canSubscribe: true });
    
    res.json({ token: await at.toJwt() });
});

// Logs do sistema
app.get('/api/logs', (req: any, res: any) => {
    res.json({ logs: botManager.getLogs() });
});

// Calendar status
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

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
    console.log(`\n========================================================`);
    console.log(`🚀 Brain Audiovisual Backend rodando em http://localhost:${PORT}`);
    console.log(`========================================================\n`);
});
