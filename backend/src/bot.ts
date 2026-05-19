import { firefox } from 'playwright';
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
async function generateLiveKitToken(): Promise<string> {
    const at = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, {
        identity: 'bot-tradutor',
        name: 'Bot Tradutor',
    });
    at.addGrant({ roomJoin: true, room: LIVEKIT_ROOM, canPublish: true, canSubscribe: false });
    return await at.toJwt();
}

/**
 * Inicia o robô headless, entra no Meet e injeta o conector do LiveKit
 */
export async function startBot(meetUrl: string) {
    console.log('Iniciando navegador headless...');
    
    // Inicia o Firefox.
    const browser = await firefox.launch({
        headless: true, // DEVE SER TRUE NA VPS POIS NÃO TEM MONITOR
        firefoxUserPrefs: {
            'media.navigator.permission.disabled': true,
            'media.navigator.streams.fake': true
        }
    });

    const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:124.0) Gecko/20100101 Firefox/124.0',
        viewport: { width: 1280, height: 720 },
        locale: 'pt-BR',
        timezoneId: 'America/Sao_Paulo'
    });
    const page = await context.newPage();

    // 1. Script para interceptar todo o áudio da página ANTES que qualquer elemento toque
    await page.addInitScript(() => {
        const win = window as any;
        win.__botAudioContext = new (win.AudioContext || win.webkitAudioContext)();
        win.__botAudioDest = win.__botAudioContext.createMediaStreamDestination();
        
        const originalPlay = HTMLMediaElement.prototype.play;
        HTMLMediaElement.prototype.play = function() {
            try {
                // Conecta a fonte de áudio do elemento ao nosso destino misturador
                const source = win.__botAudioContext.createMediaElementSource(this);
                source.connect(win.__botAudioDest);
                // Também conecta ao destino original para não quebrar o fluxo interno
                source.connect(win.__botAudioContext.destination);
            } catch(e) {
                // Ignora erros caso a fonte já tenha sido conectada
            }
            return originalPlay.apply(this, arguments as any);
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
        try {
            // Tira uma foto da tela para sabermos exatamente o que o Google está mostrando
            const path = require('path');
            const screenshotPath = path.join(__dirname, '../../frontend/dist/debug.png');
            await page.screenshot({ path: screenshotPath, fullPage: true });
            console.log(`Screenshot salva em: ${screenshotPath}`);
        } catch (e) {
            console.error('Falha ao salvar screenshot', e);
        }
        await browser.close();
        return; // Aborta se falhou ao entrar
    }

    // 3. Injeção do LiveKit para capturar e transmitir o áudio interceptado
    console.log('Injetando LiveKit Client no navegador...');
    const livekitToken = await generateLiveKitToken();
    
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
            const win = window as any;
            const mixedStream = win.__botAudioDest.stream;
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
