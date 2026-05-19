import { google } from 'googleapis';
import * as fs from 'fs';
import * as path from 'path';
import express from 'express';
import { Server } from 'http';

// Caminhos dos arquivos
const CREDENTIALS_PATH = path.join(__dirname, '..', 'credentials.json');
const TOKEN_PATH = path.join(__dirname, '..', 'token.json');

// Scopos necessários para o Meet/Calendar
// Usamos o escopo de calendário para caso precisemos criar/ler eventos com link do Meet
const SCOPES = [
    'https://www.googleapis.com/auth/calendar.readonly',
    'https://www.googleapis.com/auth/calendar.events'
];

async function authorize() {
    // 1. Carregar as credenciais do credentials.json
    let credentialsData;
    try {
        credentialsData = fs.readFileSync(CREDENTIALS_PATH, 'utf8');
    } catch (err) {
        console.error('Erro ao ler credentials.json. Certifique-se de que o arquivo está na raiz do backend.');
        process.exit(1);
    }

    const credentials = JSON.parse(credentialsData);
    const { client_secret, client_id } = credentials.web;
    
    // Configura o cliente OAuth2 com a rota de callback local
    const redirectUri = 'http://localhost:3000/oauth2callback';
    const oAuth2Client = new google.auth.OAuth2(
        client_id,
        client_secret,
        redirectUri
    );

    // 2. Verificar se já temos o token
    try {
        const tokenData = fs.readFileSync(TOKEN_PATH, 'utf8');
        const token = JSON.parse(tokenData);
        oAuth2Client.setCredentials(token);
        console.log('Token de acesso já existente. Autenticação ok!');
        return oAuth2Client;
    } catch (err) {
        // Se o token não existir, precisamos gerar um novo via Consent Screen
        return await getNewToken(oAuth2Client);
    }
}

async function getNewToken(oAuth2Client: any) {
    return new Promise((resolve, reject) => {
        const app = express();
        let server: Server;

        // Gera a URL para o usuário clicar
        const authUrl = oAuth2Client.generateAuthUrl({
            access_type: 'offline', // Isso é CRUCIAL para recebermos o refresh_token
            scope: SCOPES,
            prompt: 'consent' // Força a tela de consentimento para garantir o refresh_token
        });

        console.log('\n======================================================');
        console.log('AÇÃO NECESSÁRIA: Autorize o app clicando no link abaixo:');
        console.log(authUrl);
        console.log('======================================================\n');

        // Cria a rota para receber o código do Google
        app.get('/oauth2callback', async (req: any, res: any) => {
            const code = req.query.code as string;
            
            if (!code) {
                res.send('Erro: Código não recebido.');
                server.close();
                return reject('Código não recebido no callback.');
            }

            try {
                // Troca o código pelo token
                const { tokens } = await oAuth2Client.getToken(code);
                oAuth2Client.setCredentials(tokens);
                
                // Salva o token localmente
                fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens));
                
                console.log('Token salvo com sucesso em token.json!');
                res.send('Autenticação concluída! O arquivo token.json foi gerado. Você pode fechar esta janela e voltar ao terminal.');
                server.close();
                resolve(oAuth2Client);
            } catch (error) {
                console.error('Erro ao obter token:', error);
                res.send('Erro ao obter token. Veja o terminal.');
                server.close();
                reject(error);
            }
        });

        // Inicia o servidor local para aguardar o callback
        server = app.listen(3000, () => {
            console.log('Servidor local aguardando callback do Google em http://localhost:3000...');
        });
    });
}

// Executa a autorização
authorize().then(() => {
    console.log('Processo de autenticação finalizado.');
}).catch(console.error);
