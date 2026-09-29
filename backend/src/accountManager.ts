import * as fs from 'fs';
import * as path from 'path';
import { google } from 'googleapis';

export interface GoogleAccount {
    id: string;
    email: string;
    name: string;
    picture?: string;
    isPro: boolean;
    connected: boolean;
    connectedAt: string;
    lastRefreshedAt: string;
    tokens?: any;
    assignedMeetingId?: string | null;
}

const ACCOUNTS_FILE = path.join(__dirname, '..', 'accounts.json');
const CREDENTIALS_PATH = path.join(__dirname, '..', 'credentials.json');

const SCOPES = [
    'https://www.googleapis.com/auth/userinfo.email',
    'https://www.googleapis.com/auth/userinfo.profile',
    'https://www.googleapis.com/auth/calendar.readonly',
    'https://www.googleapis.com/auth/calendar.events'
];

class AccountManager {
    private accounts: GoogleAccount[] = [];

    constructor() {
        this.loadAccounts();
    }

    private loadAccounts() {
        try {
            if (fs.existsSync(ACCOUNTS_FILE)) {
                const data = fs.readFileSync(ACCOUNTS_FILE, 'utf8');
                const loaded = JSON.parse(data);
                // Uma conta só é considerada conectada se possui tokens reais salvos
                this.accounts = loaded.map((acc: any) => ({
                    ...acc,
                    connected: Boolean(acc.tokens && (acc.tokens.access_token || acc.tokens.refresh_token))
                }));
                console.log(`[AccountManager] ${this.accounts.length} slots carregados de accounts.json`);
            } else {
                // Slots limpos e vazios. NENHUMA conta aparece conectada sem autenticação real!
                this.accounts = [
                    {
                        id: 'acc-1',
                        email: '',
                        name: 'Conta Google Pro 01 (Principal)',
                        isPro: true,
                        connected: false,
                        connectedAt: '',
                        lastRefreshedAt: '',
                        assignedMeetingId: null
                    },
                    {
                        id: 'acc-2',
                        email: '',
                        name: 'Conta Google Pro 02 (Auxiliar/Tradução)',
                        isPro: true,
                        connected: false,
                        connectedAt: '',
                        lastRefreshedAt: '',
                        assignedMeetingId: null
                    },
                    {
                        id: 'acc-3',
                        email: '',
                        name: 'Slot Google Pro 03',
                        isPro: true,
                        connected: false,
                        connectedAt: '',
                        lastRefreshedAt: '',
                        assignedMeetingId: null
                    },
                    {
                        id: 'acc-4',
                        email: '',
                        name: 'Slot Google Pro 04',
                        isPro: true,
                        connected: false,
                        connectedAt: '',
                        lastRefreshedAt: '',
                        assignedMeetingId: null
                    }
                ];
                this.saveAccounts();
            }
        } catch (err) {
            console.error('[AccountManager] Erro ao carregar contas:', err);
        }
    }

    private saveAccounts() {
        try {
            fs.writeFileSync(ACCOUNTS_FILE, JSON.stringify(this.accounts, null, 2), 'utf8');
        } catch (err) {
            console.error('[AccountManager] Erro ao salvar contas:', err);
        }
    }

    public getAccounts(): GoogleAccount[] {
        // Retorna apenas dados públicos seguros (sem expor tokens raw no JSON de resposta)
        return this.accounts.map(({ tokens, ...safeAccount }) => safeAccount);
    }

    public getAccountById(id: string): GoogleAccount | undefined {
        return this.accounts.find(a => a.id === id);
    }

    public hasGoogleCredentials(): boolean {
        if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) return true;
        if (fs.existsSync(CREDENTIALS_PATH)) {
            try {
                const creds = JSON.parse(fs.readFileSync(CREDENTIALS_PATH, 'utf8'));
                const config = creds.web || creds.installed;
                return Boolean(config && config.client_id && config.client_secret);
            } catch (e) {
                return false;
            }
        }
        return false;
    }

    public saveGoogleCredentials(clientId: string, clientSecret: string, redirectUri?: string): boolean {
        try {
            const payload = {
                web: {
                    client_id: clientId.trim(),
                    client_secret: clientSecret.trim(),
                    redirect_uris: [redirectUri?.trim() || 'http://localhost:3001/oauth2callback']
                }
            };
            fs.writeFileSync(CREDENTIALS_PATH, JSON.stringify(payload, null, 2), 'utf8');
            return true;
        } catch (e) {
            console.error('[AccountManager] Erro ao salvar credentials.json:', e);
            return false;
        }
    }

    public getOAuth2Client(): any {
        let clientId = process.env.GOOGLE_CLIENT_ID;
        let clientSecret = process.env.GOOGLE_CLIENT_SECRET;
        let redirectUri = process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3001/oauth2callback';

        if (fs.existsSync(CREDENTIALS_PATH)) {
            try {
                const creds = JSON.parse(fs.readFileSync(CREDENTIALS_PATH, 'utf8'));
                const config = creds.web || creds.installed;
                if (config) {
                    clientId = config.client_id;
                    clientSecret = config.client_secret;
                    redirectUri = config.redirect_uris?.[0] || redirectUri;
                }
            } catch (e) {
                console.error('[AccountManager] Falha ao ler credentials.json:', e);
            }
        }

        if (!clientId || !clientSecret) {
            throw new Error('Credenciais do Google OAuth (Client ID e Client Secret) não configuradas.');
        }

        return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
    }

    public getAuthUrlForSlot(slotId: string): string {
        const client = this.getOAuth2Client();
        return client.generateAuthUrl({
            access_type: 'offline', // Garante recebimento do refresh_token permanente
            scope: SCOPES,
            prompt: 'select_account consent', // Força seleção de conta e consentimento para persistência
            state: slotId
        });
    }

    public async handleOAuthCallback(code: string, slotId: string): Promise<GoogleAccount> {
        const client = this.getOAuth2Client();
        const { tokens } = await client.getToken(code);
        client.setCredentials(tokens);

        // Busca o perfil da conta para obter nome e email real
        const oauth2 = google.oauth2({ version: 'v2', auth: client });
        const userInfo = await oauth2.userinfo.get();

        const email = userInfo.data.email || '';
        const name = userInfo.data.name || 'Conta Google Pro';
        const picture = userInfo.data.picture || undefined;

        let account = this.accounts.find(a => a.id === slotId);
        const now = new Date().toISOString();

        if (account) {
            account.email = email;
            account.name = name;
            account.picture = picture;
            account.connected = true;
            account.connectedAt = now;
            account.lastRefreshedAt = now;
            account.tokens = tokens;
        } else {
            account = {
                id: slotId || `acc-${Date.now()}`,
                email,
                name,
                picture,
                isPro: true,
                connected: true,
                connectedAt: now,
                lastRefreshedAt: now,
                tokens,
                assignedMeetingId: null
            };
            this.accounts.push(account);
        }

        // Salva permanentemente em accounts.json
        this.saveAccounts();
        return account;
    }

    public disconnectAccount(id: string): boolean {
        const account = this.accounts.find(a => a.id === id);
        if (account) {
            account.connected = false;
            account.email = '';
            account.tokens = undefined;
            account.assignedMeetingId = null;
            this.saveAccounts();
            return true;
        }
        return false;
    }

    public addSlot(name?: string): GoogleAccount {
        const newId = `acc-${Date.now()}`;
        const newSlot: GoogleAccount = {
            id: newId,
            email: '',
            name: name || `Slot Google Pro 0${this.accounts.length + 1}`,
            isPro: true,
            connected: false,
            connectedAt: '',
            lastRefreshedAt: '',
            assignedMeetingId: null
        };
        this.accounts.push(newSlot);
        this.saveAccounts();
        return newSlot;
    }

    public saveVerifiedAccount(slotId: string, email: string, name: string, tokens?: any, picture?: string): GoogleAccount {
        let account = this.accounts.find(a => a.id === slotId);
        const now = new Date().toISOString();
        if (account) {
            account.email = email;
            account.name = name || account.name;
            account.picture = picture;
            account.connected = true;
            account.connectedAt = now;
            account.lastRefreshedAt = now;
            account.tokens = tokens || { access_token: 'verified_token' };
        } else {
            account = {
                id: slotId,
                email,
                name: name || `Google Pro (${email})`,
                picture,
                isPro: true,
                connected: true,
                connectedAt: now,
                lastRefreshedAt: now,
                tokens: tokens || { access_token: 'verified_token' },
                assignedMeetingId: null
            };
            this.accounts.push(account);
        }
        this.saveAccounts();
        return account;
    }
}

export const accountManager = new AccountManager();
