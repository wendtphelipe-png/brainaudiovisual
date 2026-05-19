import express from 'express';
import { startBot } from './bot';
import { AccessToken } from 'livekit-server-sdk';
import cors from 'cors';
import path from 'path';

const app = express();
app.use(express.json());
app.use(cors());

// Serve os arquivos do Frontend para o aluno acessar diretamente pela VPS
app.use(express.static(path.join(__dirname, '../../frontend/dist')));

// Painel de Controle Fácil (Admin)
app.get('/admin', (req: any, res: any) => {
    res.send(`
    <html>
        <head>
            <title>Painel do Tradutor</title>
            <style>
                body { font-family: Arial, sans-serif; background: #0f172a; color: white; padding: 50px; text-align: center; }
                input { padding: 15px; width: 300px; border-radius: 8px; border: none; outline: none; }
                button { padding: 15px 25px; background: #3b82f6; color: white; border: none; border-radius: 8px; cursor: pointer; font-weight: bold; }
                button:hover { background: #2563eb; }
                .card { background: #1e293b; padding: 30px; border-radius: 12px; display: inline-block; box-shadow: 0 4px 6px rgba(0,0,0,0.1); }
            </style>
        </head>
        <body>
            <div class="card">
                <h2>Ligar Robô no Google Meet</h2>
                <p>Cole o link da reunião (ex: https://meet.google.com/abc-defg-hij)</p>
                <input type="text" id="meetUrl" placeholder="Link do Meet..." />
                <button onclick="startBot()">🤖 Enviar Robô</button>
            </div>
            
            <script>
                function startBot() {
                    const btn = document.querySelector('button');
                    const url = document.getElementById('meetUrl').value;
                    btn.innerText = 'Conectando...';
                    
                    fetch('/api/start-bot', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ meetUrl: url })
                    })
                    .then(r => r.json())
                    .then(data => { alert(data.message || data.error); btn.innerText = '🤖 Enviar Robô'; })
                    .catch(err => { alert('Erro de conexão'); btn.innerText = '🤖 Enviar Robô'; });
                }
            </script>
        </body>
    </html>
    `);
});

// Variáveis de ambiente ou fallback para desenvolvimento
const LIVEKIT_API_KEY = process.env.LIVEKIT_API_KEY || 'devkey';
const LIVEKIT_API_SECRET = process.env.LIVEKIT_API_SECRET || 'secret';

// Rota para iniciar o robô numa reunião específica
app.post('/api/start-bot', async (req: any, res: any) => {
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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`LiveTranslate Backend rodando na porta ${PORT}`);
    console.log(`- POST /api/start-bot { "meetUrl": "..." }`);
    console.log(`- POST /api/get-student-token { "roomName": "..." }`);
});
