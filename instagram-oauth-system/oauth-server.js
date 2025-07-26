// oauth-server.js - Sistema Completo OAuth + Webhook
const express = require('express');
const axios = require('axios');
const crypto = require('crypto');
const path = require('path');

const app = express();
app.use(express.json());
app.use(express.static('public'));

// Configurações
const CONFIG = {
    facebookAppId: process.env.FACEBOOK_APP_ID || '1064079752566164',
    facebookAppSecret: process.env.FACEBOOK_APP_SECRET || 'fefb66f99adad1d1c98af7',
    webhookSecret: process.env.WEBHOOK_SECRET || 'webhook_secret_123',
    multioneToken: process.env.MULTIONE_TOKEN || '68eff5505a3989e99dadbc7243c9411efba9a80ef1f59e4680c89678bf63f515',
    multioneApiUrl: process.env.MULTIONE_API_URL || 'https://sock.multi360.digital/api/messages/send',
    baseUrl: process.env.BASE_URL || 'http://localhost:3000'
};

// Base de dados em memória (em produção, usar banco real)
const connectedAccounts = new Map();
const webhookSubscriptions = new Map();

console.log('🚀 Inicializando Sistema OAuth + Webhook...');

// ==========================================
// ENDPOINTS OAUTH E CONFIGURAÇÃO
// ==========================================

// Página principal
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Callback OAuth do Facebook
app.get('/oauth/callback', async (req, res) => {
    const { code, state, error } = req.query;
    
    if (error) {
        console.log('❌ OAuth Error:', error);
        return res.redirect('/?error=' + error);
    }
    
    try {
        console.log('🔑 Processando callback OAuth...');
        
        // Trocar code por access token
        const tokenResponse = await axios.get('https://graph.facebook.com/v18.0/oauth/access_token', {
            params: {
                client_id: CONFIG.facebookAppId,
                client_secret: CONFIG.facebookAppSecret,
                redirect_uri: `${CONFIG.baseUrl}/oauth/callback`,
                code: code
            }
        });
        
        const accessToken = tokenResponse.data.access_token;
        console.log('✅ Access token obtido');
        
        // Obter informações do usuário
        const userResponse = await axios.get('https://graph.facebook.com/v18.0/me', {
            params: {
                access_token: accessToken,
                fields: 'id,name,email'
            }
        });
        
        const userId = userResponse.data.id;
        
        // Salvar token do usuário
        connectedAccounts.set(userId, {
            userId,
            name: userResponse.data.name,
            email: userResponse.data.email,
            accessToken,
            connectedAt: new Date().toISOString()
        });
        
        console.log(`✅ Usuário ${userResponse.data.name} conectado`);
        
        res.redirect('/?success=true&user=' + encodeURIComponent(userResponse.data.name));
        
    } catch (error) {
        console.error('❌ Erro OAuth:', error.message);
        res.redirect('/?error=oauth_failed');
    }
});

// Listar páginas do usuário
app.get('/api/user/pages', async (req, res) => {
    const { userId, accessToken } = req.query;
    
    if (!accessToken) {
        return res.status(401).json({ error: 'Access token required' });
    }
    
    try {
        console.log('📄 Carregando páginas do usuário...');
        
        const pagesResponse = await axios.get('https://graph.facebook.com/v18.0/me/accounts', {
            params: { access_token: accessToken }
        });
        
        const pages = pagesResponse.data.data;
        
        // Para cada página, verificar se tem Instagram conectado
        const pagesWithInstagram = await Promise.all(pages.map(async (page) => {
            try {
                const igResponse = await axios.get(`https://graph.facebook.com/v18.0/${page.id}`, {
                    params: {
                        access_token: page.access_token,
                        fields: 'instagram_business_account'
                    }
                });
                
                return {
                    ...page,
                    instagram_account: igResponse.data.instagram_business_account || null
                };
            } catch (error) {
                return { ...page, instagram_account: null };
            }
        }));
        
        console.log(`✅ ${pages.length} páginas carregadas`);
        res.json({ pages: pagesWithInstagram });
        
    } catch (error) {
        console.error('❌ Erro ao carregar páginas:', error.message);
        res.status(500).json({ error: error.message });
    }
});

// Configurar webhook automaticamente para uma página
app.post('/api/setup-webhook', async (req, res) => {
    const { pageId, pageAccessToken, userId } = req.body;
    
    try {
        console.log(`🔗 Configurando webhook para página ${pageId}...`);
        
        // 1. Subscrever webhook na página
        const subscribeResponse = await axios.post(
            `https://graph.facebook.com/v18.0/${pageId}/subscribed_apps`,
            {
                subscribed_fields: 'messages,messaging_postbacks,messaging_optins,message_deliveries,messaging_referrals'
            },
            {
                params: { access_token: pageAccessToken }
            }
        );
        
        if (subscribeResponse.data.success) {
            // Salvar configuração
            webhookSubscriptions.set(pageId, {
                pageId,
                userId,
                accessToken: pageAccessToken,
                subscribedAt: new Date().toISOString(),
                active: true
            });
            
            console.log(`✅ Webhook configurado para página ${pageId}`);
            
            res.json({
                success: true,
                message: 'Webhook configurado com sucesso',
                pageId,
                webhookUrl: `${CONFIG.baseUrl}/webhook/instagram`
            });
        } else {
            throw new Error('Falha ao configurar webhook');
        }
        
    } catch (error) {
        console.error('❌ Erro ao configurar webhook:', error.message);
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
});

// Listar contas conectadas
app.get('/api/connected-accounts', (req, res) => {
    const accounts = Array.from(connectedAccounts.values()).map(account => ({
        userId: account.userId,
        name: account.name,
        email: account.email,
        connectedAt: account.connectedAt,
        webhooksActive: Array.from(webhookSubscriptions.values())
            .filter(sub => sub.userId === account.userId && sub.active).length
    }));
    
    res.json({ accounts });
});

// Desconectar conta
app.delete('/api/disconnect/:userId', (req, res) => {
    const { userId } = req.params;
    
    // Remover webhooks da conta
    for (const [pageId, subscription] of webhookSubscriptions.entries()) {
        if (subscription.userId === userId) {
            webhookSubscriptions.delete(pageId);
        }
    }
    
    // Remover conta
    connectedAccounts.delete(userId);
    
    console.log(`🗑️ Conta ${userId} desconectada`);
    res.json({ success: true });
});

// ==========================================
// WEBHOOK INSTAGRAM/FACEBOOK
// ==========================================

// Verificação do webhook (GET)
app.get('/webhook/instagram', (req, res) => {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];
    
    console.log('🔍 Verificação webhook:', { mode, token, challenge });
    
    if (mode === 'subscribe' && token === CONFIG.webhookSecret) {
        console.log('✅ Webhook Instagram verificado');
        res.status(200).send(challenge);
    } else {
        console.log('❌ Verificação falhou');
        res.sendStatus(403);
    }
});

// Receber mensagens do webhook (POST)
app.post('/webhook/instagram', express.raw({type: 'application/json'}), async (req, res) => {
    const signature = req.get('X-Hub-Signature-256');
    
    // Verificar assinatura (em produção)
    if (process.env.NODE_ENV === 'production' && CONFIG.facebookAppSecret) {
        const expectedSignature = crypto
            .createHmac('sha256', CONFIG.facebookAppSecret)
            .update(req.body, 'utf8')
            .digest('hex');
            
        if (signature !== `sha256=${expectedSignature}`) {
            console.log('❌ Assinatura inválida');
            return res.sendStatus(403);
        }
    }
    
    const body = JSON.parse(req.body.toString());
    console.log('📸 Webhook Instagram recebido:', JSON.stringify(body, null, 2));
    
    try {
        // Processar cada entrada
        for (const entry of body.entry || []) {
            await processWebhookEntry(entry);
        }
        
        res.status(200).send('EVENT_RECEIVED');
    } catch (error) {
        console.error('❌ Erro processando webhook:', error);
        res.status(500).send('ERROR');
    }
});

// Processar entrada do webhook
async function processWebhookEntry(entry) {
    const pageId = entry.id;
    
    // Verificar se temos essa página registrada
    const subscription = webhookSubscriptions.get(pageId);
    if (!subscription || !subscription.active) {
        console.log(`⚠️ Página ${pageId} não está registrada`);
        return;
    }
    
    // Processar mensagens
    if (entry.messaging) {
        for (const messaging of entry.messaging) {
            await processInstagramMessage(messaging, subscription);
        }
    }
    
    // Processar mudanças (Instagram)
    if (entry.changes) {
        for (const change of entry.changes) {
            if (change.field === 'messages') {
                await processInstagramDM(change.value, subscription);
            }
        }
    }
}

// Processar mensagem do Instagram
async function processInstagramMessage(messaging, subscription) {
    try {
        if (messaging.message && messaging.message.text) {
            console.log(`💬 Mensagem Instagram recebida: "${messaging.message.text}"`);
            
            // Obter informações do remetente
            const senderInfo = await getUserInfo(messaging.sender.id, subscription.accessToken);
            
            const messageData = {
                number: messaging.sender.id,
                message: messaging.message.text,
                sender_id: messaging.sender.id,
                sender_name: senderInfo.name || `Usuario Instagram`,
                platform: 'instagram',
                timestamp: new Date().toISOString(),
                type: 'inbound',
                external_id: messaging.sender.id,
                external_message_id: messaging.message.mid,
                metadata: {
                    page_id: subscription.pageId,
                    instagram_account: senderInfo.instagram_id,
                    received_at: new Date().toISOString()
                }
            };
            
            // Enviar para MultiOne
            await sendToMultiOne(messageData);
        }
    } catch (error) {
        console.error('❌ Erro processando mensagem Instagram:', error.message);
    }
}

// Processar DM do Instagram (Instagram Graph API)
async function processInstagramDM(messageData, subscription) {
    try {
        console.log('📱 DM Instagram recebido:', messageData);
        
        // Estrutura específica do Instagram Graph API
        if (messageData.message && messageData.message.text) {
            const multioneData = {
                number: messageData.from.id,
                message: messageData.message.text,
                sender_id: messageData.from.id,
                sender_name: messageData.from.username || 'Usuario Instagram',
                platform: 'instagram',
                timestamp: new Date().toISOString(),
                type: 'inbound',
                external_id: messageData.from.id,
                external_message_id: messageData.message.mid
            };
            
            await sendToMultiOne(multioneData);
        }
    } catch (error) {
        console.error('❌ Erro processando DM Instagram:', error.message);
    }
}

// Obter informações do usuário
async function getUserInfo(userId, accessToken) {
    try {
        const response = await axios.get(`https://graph.facebook.com/v18.0/${userId}`, {
            params: {
                access_token: accessToken,
                fields: 'name,first_name,profile_pic'
            }
        });
        
        return response.data;
    } catch (error) {
        console.log(`⚠️ Não foi possível obter info do usuário ${userId}`);
        return { name: 'Usuario Instagram' };
    }
}

// Enviar para MultiOne
async function sendToMultiOne(messageData) {
    try {
        console.log('🚀 Enviando para MultiOne:', messageData);
        
        const response = await axios.post(CONFIG.multioneApiUrl, messageData, {
            headers: {
                'Authorization': `Bearer ${CONFIG.multioneToken}`,
                'Content-Type': 'application/json'
            },
            timeout: 15000
        });
        
        console.log('✅ Mensagem enviada para MultiOne:', response.data);
        return response.data;
        
    } catch (error) {
        console.error('❌ Erro ao enviar para MultiOne:', error.response?.data || error.message);
        throw error;
    }
}

// ==========================================
// ENDPOINTS DE MONITORAMENTO
// ==========================================

// Health check
app.get('/health', (req, res) => {
    res.json({
        status: 'OK',
        service: 'Instagram OAuth + Webhook System',
        timestamp: new Date().toISOString(),
        connections: {
            connectedAccounts: connectedAccounts.size,
            activeWebhooks: webhookSubscriptions.size,
            multioneConnection: CONFIG.multioneToken ? 'configured' : 'missing'
        }
    });
});

// Status do sistema
app.get('/api/system/status', (req, res) => {
    const stats = {
        accounts: {
            total: connectedAccounts.size,
            active: Array.from(connectedAccounts.values()).length
        },
        webhooks: {
            total: webhookSubscriptions.size,
            active: Array.from(webhookSubscriptions.values()).filter(sub => sub.active).length
        },
        system: {
            uptime: process.uptime(),
            memory: process.memoryUsage(),
            nodeVersion: process.version
        }
    };
    
    res.json(stats);
});

// Logs recentes (em produção, usar sistema de logs real)
const recentLogs = [];
const originalConsoleLog = console.log;
console.log = (...args) => {
    const logEntry = {
        timestamp: new Date().toISOString(),
        message: args.join(' '),
        level: 'info'
    };
    recentLogs.unshift(logEntry);
    if (recentLogs.length > 100) recentLogs.pop();
    originalConsoleLog(...args);
};

app.get('/api/logs', (req, res) => {
    res.json({ logs: recentLogs.slice(0, 50) });
});

// ==========================================
// UTILITÁRIOS E TESTES
// ==========================================

// Testar conexão MultiOne
app.post('/api/test/multione', async (req, res) => {
    try {
        const testMessage = {
            number: 'test_user_oauth',
            message: 'Teste de conexão OAuth System → MultiOne',
            sender_id: 'oauth_test',
            sender_name: 'OAuth Test System',
            platform: 'instagram',
            timestamp: new Date().toISOString(),
            type: 'inbound',
            test: true
        };
        
        const result = await sendToMultiOne(testMessage);
        res.json({ success: true, result });
        
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Simular mensagem Instagram (para testes)
app.post('/api/test/instagram-message', async (req, res) => {
    const { message, userId = 'test_user', pageId } = req.body;
    
    if (!message) {
        return res.status(400).json({ error: 'Message required' });
    }
    
    try {
        const mockMessaging = {
            sender: { id: userId },
            recipient: { id: pageId || 'test_page' },
            timestamp: Date.now(),
            message: {
                mid: `test_mid_${Date.now()}`,
                text: message
            }
        };
        
        const mockSubscription = {
            pageId: pageId || 'test_page',
            userId: 'test_user',
            accessToken: 'test_token',
            active: true
        };
        
        await processInstagramMessage(mockMessaging, mockSubscription);
        
        res.json({ 
            success: true, 
            message: 'Mensagem de teste processada' 
        });
        
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// ==========================================
// INICIALIZAÇÃO DO SERVIDOR
// ==========================================

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log('🎉 ================================');
    console.log('🚀 INSTAGRAM OAUTH SYSTEM ATIVO!');
    console.log('🎉 ================================');
    console.log(`🌐 Servidor: http://localhost:${PORT}`);
    console.log(`📱 Interface: http://localhost:${PORT}`);
    console.log(`🔗 OAuth Callback: ${CONFIG.baseUrl}/oauth/callback`);
    console.log(`📸 Webhook: ${CONFIG.baseUrl}/webhook/instagram`);
    console.log(`💚 Health: ${CONFIG.baseUrl}/health`);
    console.log('🎉 ================================');
    console.log(`📋 Config: App ID ${CONFIG.facebookAppId}`);
    console.log(`🔑 MultiOne: ${CONFIG.multioneToken ? 'Configurado' : 'Faltando'}`);
    console.log('🎉 ================================');
});

// Tratamento de erros não capturados
process.on('uncaughtException', (error) => {
    console.error('❌ Erro não capturado:', error);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ Promise rejeitada:', reason);
});

module.exports = app;
