import { chromium } from 'playwright-extra';
import stealth from 'puppeteer-extra-plugin-stealth';
import { AccessToken } from 'livekit-server-sdk';

// Adiciona o plugin Stealth para burlar o firewall do Google
chromium.use(stealth());



// Configurações do LiveKit (usaremos localhost para testes locais se não houver cloud ainda)
// Estas variáveis devem vir do .env em produção
const LIVEKIT_URL = process.env.LIVEKIT_URL || 'ws://localhost:7880';
const LIVEKIT_API_KEY = process.env.LIVEKIT_API_KEY || 'devkey';
const LIVEKIT_API_SECRET = process.env.LIVEKIT_API_SECRET || 'secret';
const LIVEKIT_ROOM = process.env.LIVEKIT_ROOM || 'evento-01';

/**
 * Gera um token de acesso para o robô se conectar ao LiveKit e publicar áudio
 */
async function generateLiveKitToken(instanceId: string, roomName: string): Promise<string> {
    const at = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, {
        identity: `bot-tradutor-${instanceId}`,
        name: `Bot Tradutor (${instanceId})`,
    });
    at.addGrant({ roomJoin: true, room: roomName, canPublish: true, canSubscribe: false });
    return await at.toJwt();
}

export interface BotInstance {
    id: string;
    meetUrl: string;
    close: () => Promise<void>;
}

/**
 * Inicia o robô headless, entra no Meet e injeta o conector do LiveKit
 */
export async function startBot(meetUrl: string, instanceId: string, roomName: string = LIVEKIT_ROOM): Promise<BotInstance> {
    console.log(`[Bot ${instanceId}] Iniciando navegador headless...`);
    
    // Inicia o Chromium com stealth máximo
    const browser = await chromium.launch({
        headless: true, // Alterado para true em produção/background por padrão
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--use-fake-ui-for-media-stream',
            '--use-fake-device-for-media-stream',
            '--disable-blink-features=AutomationControlled'
        ],
        ignoreDefaultArgs: ['--enable-automation']
    });

    const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        viewport: { width: 1280, height: 720 },
        locale: 'pt-BR',
        timezoneId: 'America/Sao_Paulo',
        permissions: ['camera', 'microphone'],
        colorScheme: 'dark'
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

    return new Promise<BotInstance>(async (resolve, reject) => {
        let isResolved = false;

        const cleanup = async () => {
            console.log(`[Bot ${instanceId}] Encerrando recursos e fechando navegador...`);
            try {
                await context.close();
                await browser.close();
            } catch (e) {
                console.error(`[Bot ${instanceId}] Erro ao fechar navegador:`, e);
            }
        };

        // Expor funções para que a página notifique o Node.js
        await page.exposeFunction('onBotReady', () => {
            console.log(`[Bot ${instanceId}] Conectado ao LiveKit e publicando áudio com sucesso!`);
            isResolved = true;
            resolve({
                id: instanceId,
                meetUrl,
                close: cleanup
            });
        });

        await page.exposeFunction('onBotError', (errMsg: string) => {
            console.error(`[Bot ${instanceId}] Erro no contexto do navegador:`, errMsg);
            if (!isResolved) {
                isResolved = true;
                cleanup().catch(console.error);
                reject(new Error(errMsg));
            }
        });

        try {
            console.log(`[Bot ${instanceId}] Navegando para o Google Meet: ${meetUrl}`);
            await page.goto(meetUrl);

            // 2. Fluxo de entrada como convidado
            console.log(`[Bot ${instanceId}] Tentando fechar popups e inserir nome...`);
            
            // Espera o campo de nome carregar
            const nameInputSelector = 'input[type="text"], input[placeholder*="nome"]';
            await page.waitForSelector(nameInputSelector, { timeout: 20000 }).catch(() => {});
            
            // Se achou o campo, digita o nome e pede para entrar
            if (await page.$(nameInputSelector)) {
                await page.fill(nameInputSelector, 'Tradutor (Áudio)');
                
                // Clica no botão "Pedir para participar" ou "Participar"
                const joinButton = await page.$('xpath=//span[contains(text(), "Pedir")]/.. | //span[contains(text(), "Participar")]/.. | //span[contains(text(), "Join")]/..');
                if (joinButton) {
                    await joinButton.click();
                    console.log(`[Bot ${instanceId}] Pedido para entrar enviado. Aguardando aceitação...`);
                }
            }
            
            // Aguarda até que os controles da reunião apareçam (sinal de que fomos aceitos)
            await page.waitForSelector('button[aria-label*="Sair"], button[aria-label*="Leave"]', { timeout: 60000 });
            console.log(`[Bot ${instanceId}] ✅ Entrou na reunião com sucesso!`);

            // 3. Injeção do LiveKit para capturar e transmitir o áudio interceptado
            console.log(`[Bot ${instanceId}] Injetando LiveKit Client no navegador...`);
            const livekitToken = await generateLiveKitToken(instanceId, roomName);
            
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
                        (window as any).onBotReady();
                    } else {
                        throw new Error('Nenhuma faixa de áudio encontrada na stream interceptada.');
                    }
                } catch (e: any) {
                    console.error('Erro na injeção do LiveKit:', e);
                    (window as any).onBotError(e.message || String(e));
                }
            }, { url: LIVEKIT_URL, token: livekitToken });

        } catch (err: any) {
            console.error(`[Bot ${instanceId}] Falha durante inicialização:`, err);
            try {
                const path = require('path');
                const screenshotPath = path.join(__dirname, '../../frontend/dist/debug.png');
                await page.screenshot({ path: screenshotPath, fullPage: true });
                console.log(`Screenshot de depuração salva em: ${screenshotPath}`);
            } catch (e) {
                // ignorar
            }
            if (!isResolved) {
                isResolved = true;
                await cleanup();
                reject(err);
            }
        }
    });
}

