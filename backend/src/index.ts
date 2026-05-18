import express from 'express';
import { startBot } from './bot';
import { AccessToken } from 'livekit-server-sdk';
import cors from 'cors';

const app = express();
app.use(express.json());
app.use(cors());

// Variáveis de ambiente ou fallback para desenvolvimento
const LIVEKIT_API_KEY = process.env.LIVEKIT_API_KEY || 'devkey';
const LIVEKIT_API_SECRET = process.env.LIVEKIT_API_SECRET || 'secret';

// Rota para iniciar o robô numa reunião específica
app.post('/api/start-bot', async (req, res) => {
    const { meetUrl } = req.body;
    
    if (!meetUrl || !meetUrl.includes('meet.google.com')) {
        return res.status(400).json({ error: 'Forneça uma URL válida do Google Meet.' });
    }

    try {
        // Inicia o bot em background (não aguardamos o término para responder)
        startBot(meetUrl).catch(console.error);
        res.json({ message: 'Robô inicializado e conectando ao Google Meet e LiveKit!' });
    } catch (err) {
        res.status(500).json({ error: 'Falha ao iniciar o robô.' });
    }
});

// Rota para o frontend gerar o token para o aluno que acessou via QR Code
app.post('/api/get-student-token', (req, res) => {
    const { roomName, studentId } = req.body;
    
    if (!roomName) {
        return res.status(400).json({ error: 'Falta o roomName.' });
    }

    // Cria o token para o aluno (canSubscribe = true, canPublish = false)
    const at = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, {
        identity: studentId || `aluno-${Math.floor(Math.random() * 10000)}`,
    });
    
    at.addGrant({ roomJoin: true, room: roomName, canPublish: false, canSubscribe: true });
    
    res.json({ token: at.toJwt() });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`LiveTranslate Backend rodando na porta ${PORT}`);
    console.log(`- POST /api/start-bot { "meetUrl": "..." }`);
    console.log(`- POST /api/get-student-token { "roomName": "..." }`);
});
