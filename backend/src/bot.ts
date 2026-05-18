import { chromium, Page } from 'playwright';
import { AccessToken } from 'livekit-server-sdk';

// Configurações do LiveKit (usaremos localhost para testes locais se não houver cloud ainda)
// Estas variáveis devem vir do .env em produção
const LIVEKIT_URL = process.env.LIVEKIT_URL || 'ws://localhost:7880';
const LIVEKIT_API_KEY = process.env.LIVEKIT_API_KEY || 'devkey';
const LIVEKIT_API_SECRET = process.env.LIVEKIT_API_SECRET || 'secret';
const LIVEKIT_ROOM = process.env.LIVEKIT_ROOM || 'evento-01';

/**
 * Gera um token de acesso para o robô se conectar ao LiveKit e publicar áudio
 */
function generateLiveKitToken(): string {
    const at = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, {
        identity: 'bot-tradutor',
        name: 'Bot Tradutor',
    });
    at.addGrant({ roomJoin: true, room: LIVEKIT_ROOM, canPublish: true, canSubscribe: false });
    return at.toJwt();
}

/**
 * Inicia o robô headless, entra no Meet e injeta o conector do LiveKit
 */
export async function startBot(meetUrl: string) {
    console.log('Iniciando navegador headless...');
    
    // Inicia o Chromium. Flags importantes para mídia e automação.
    const browser = await chromium.launch({
        headless: false, // DEIXE FALSE PARA TESTE LOCAL. Em produção será true.
        args: [
            '--use-fake-ui-for-media-stream', // Pula os popups de permissão de microfone/câmera
            '--use-fake-device-for-media-stream', // Simula um microfone silencioso
            '--disable-blink-features=AutomationControlled', // Evita que o Google detecte facilmente que é um bot
        ]
    });

    const context = await browser.newContext();
    const page = await context.newPage();

    // 1. Script para interceptar todo o áudio da página ANTES que qualquer elemento toque
    await page.addInitScript(() => {
        window['__botAudioContext'] = new (window.AudioContext || (window as any).webkitAudioContext)();
        window['__botAudioDest'] = window['__botAudioContext'].createMediaStreamDestination();
        
        const originalPlay = HTMLMediaElement.prototype.play;
        HTMLMediaElement.prototype.play = function() {
            try {
                // Conecta a fonte de áudio do elemento ao nosso destino misturador
                const source = window['__botAudioContext'].createMediaElementSource(this);
                source.connect(window['__botAudioDest']);
                // Também conecta ao destino original para não quebrar o fluxo interno
                source.connect(window['__botAudioContext'].destination);
            } catch(e) {
                // Ignora erros caso a fonte já tenha sido conectada
            }
            return originalPlay.apply(this, arguments);
        };
    });

    console.log(`Navegando para o Google Meet: ${meetUrl}`);
    await page.goto(meetUrl);

    // 2. Fluxo de entrada como convidado
    try {
        console.log('Tentando fechar popups e inserir nome...');
        
        // Espera o campo de nome carregar
        const nameInputSelector = 'input[type="text"], input[placeholder*="nome"]';
        await page.waitForSelector(nameInputSelector, { timeout: 15000 }).catch(() => {});
        
        // Se achou o campo, digita o nome e pede para entrar
        if (await page.$(nameInputSelector)) {
            await page.fill(nameInputSelector, 'Tradutor (Áudio)');
            
            // Clica no botão "Pedir para participar" ou "Participar"
            // O seletor exato depende do idioma do Google, usamos um XPath genérico
            const joinButton = await page.$('xpath=//span[contains(text(), "Pedir")]/.. | //span[contains(text(), "Participar")]/.. | //span[contains(text(), "Join")]/..');
            if (joinButton) {
                await joinButton.click();
                console.log('Pedido para entrar enviado. Aguardando o anfitrião aceitar...');
            }
        }
        
        // Aguarda até que os controles da reunião apareçam (sinal de que fomos aceitos)
        await page.waitForSelector('button[aria-label*="Sair"], button[aria-label*="Leave"]', { timeout: 60000 });
        console.log('✅ Bot entrou na reunião com sucesso!');

    } catch (err) {
        console.error('Erro durante o fluxo de login no Meet:', err);
    }

    // 3. Injeção do LiveKit para capturar e transmitir o áudio interceptado
    console.log('Injetando LiveKit Client no navegador...');
    const livekitToken = generateLiveKitToken();
    
    // Adiciona o script do LiveKit via CDN na página
    await page.addScriptTag({ url: 'https://cdn.jsdelivr.net/npm/livekit-client/dist/livekit-client.umd.min.js' });

    // Roda o script dentro do contexto do navegador
    await page.evaluate(async ({ url, token }) => {
        try {
            const LivekitClient = (window as any).LivekitClient;
            const room = new LivekitClient.Room();
            
            await room.connect(url, token);
            console.log('Conectado ao LiveKit a partir do navegador!');

            // Pega a stream mista que interceptamos no InitScript
            const mixedStream = window['__botAudioDest'].stream;
            const audioTrack = mixedStream.getAudioTracks()[0];

            if (audioTrack) {
                // Publica a faixa de áudio na sala do LiveKit
                const localAudioTrack = new LivekitClient.LocalAudioTrack(audioTrack);
                await room.localParticipant.publishTrack(localAudioTrack);
                console.log('Faixa de áudio do Google Meet publicada no LiveKit!');
            } else {
                console.error('Nenhuma faixa de áudio encontrada na stream interceptada.');
            }
        } catch (e) {
            console.error('Erro na injeção do LiveKit:', e);
        }
    }, { url: LIVEKIT_URL, token: livekitToken });

    console.log('Bot rodando de forma silenciosa e transmitindo áudio. Pressione Ctrl+C para encerrar.');
    // Mantém o bot rodando
}

// Para testar rapidamente rodando o arquivo
if (require.main === module) {
    const meetLink = process.argv[2] || 'https://meet.google.com/abc-defg-hij';
    startBot(meetLink);
}
