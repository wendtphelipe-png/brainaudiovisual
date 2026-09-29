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
                this.accounts = JSON.parse(data);
                console.log(`[AccountManager] ${this.accounts.length} contas carregadas de accounts.json`);
            } else {
                // Contas iniciais de demonstração (slots prontos para autenticação)
                this.accounts = [
                    {
                        id: 'acc-1',
                        email: 'workspace.meet01@empresa.com',
                        name: 'Google Meet Pro 01 (Principal)',
                        isPro: true,
                        connected: false,
                        connectedAt: '',
                        lastRefreshedAt: '',
                        assignedMeetingId: null
                    },
                    {
                        id: 'acc-2',
                        email: 'workspace.meet02@empresa.com',
                        name: 'Google Meet Pro 02 (Tradução/Auxiliar)',
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
        // Retorna as contas sem expor os tokens raw para o frontend
        return this.accounts.map(({ tokens, ...safeAccount }) => safeAccount);
    }

    public getAccountById(id: string): GoogleAccount | undefined {
        return this.accounts.find(a => a.id === id);
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

        return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
    }

    public getAuthUrlForSlot(slotId: string): string {
        const client = this.getOAuth2Client();
        return client.generateAuthUrl({
            access_type: 'offline',
            scope: SCOPES,
            prompt: 'select_account consent',
            state: slotId // Passa o ID do slot para saber qual conta associar no callback
        });
    }

    public async handleOAuthCallback(code: string, slotId: string): Promise<GoogleAccount> {
        const client = this.getOAuth2Client();
        const { tokens } = await client.getToken(code);
        client.setCredentials(tokens);

        // Busca o perfil da conta para obter nome e email real
        const oauth2 = google.oauth2({ version: 'v2', auth: client });
        const userInfo = await oauth2.userinfo.get();

        const email = userInfo.data.email || `google-user-${Date.now()}@gmail.com`;
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

        this.saveAccounts();
        return account;
    }

    public disconnectAccount(id: string): boolean {
        const account = this.accounts.find(a => a.id === id);
        if (account) {
            account.connected = false;
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
            name: name || `Novo Slot Google Pro ${this.accounts.length + 1}`,
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
}

export const accountManager = new AccountManager();
