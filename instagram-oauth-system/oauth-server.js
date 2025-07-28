// oauth-server.js - Sistema Completo OAuth + Webhook + Polling
const express = require('express');
const axios = require('axios');
const crypto = require('crypto');
const path = require('path');

const app = express();
app.use(express.json());
app.use(express.static('public'));

// ==========================================
// CONFIGURAÇÕES
// ==========================================
const CONFIG = {
    facebookAppId: process.env.FACEBOOK_APP_ID || '1064079752566164',
    facebookAppSecret: process.env.FACEBOOK_APP_SECRET || 'fefb66f99adad1d1c98af7',
    webhookSecret: process.env.WEBHOOK_SECRET || 'webhook_secret_123',
    multioneToken: process.env.MULTIONE_TOKEN || '68eff5505a3989e99dadbc7243c9411efba9a80ef1f59e4680c89678bf63f515',
    multioneApiUrl: process.env.MULTIONE_API_URL || 'https://sock.multi360.digital/api/messages/send',
    baseUrl: process.env.BASE_URL || 'https://instagram-oauth-multione-production.up.railway.app',
    // Token da página unificado (Instagram + Messenger) - ATUALIZADO
    pageAccessToken: process.env.PAGE_ACCESS_TOKEN || 'EAAPHxlZBqFZAQBPCmVZCMSpjMGwK9JrBgP13LGiCkdgPDltCtToQAuPhZAabwpLDHT8uaZBZBRMoMwxrUZCQddXU5WV0lEsWHfarQ8d67gNQ29snLZAJc3nXk0xZCSedzugPaZA7uHtXGPaQJZAw3BBM8gt0eAoDDFNELP0aR4wlbt6ZBZBX3PLGW5sWuo1eSZAibtSo39DaGA8lcJZBwZDZD',
    // Alias para compatibilidade
    instagramPageToken: process.env.FACEBOOK_PAGE_ACCESS_TOKEN || process.env.PAGE_ACCESS_TOKEN || 'EAAPHxlZBqFZAQBPCmVZCMSpjMGwK9JrBgP13LGiCkdgPDltCtToQAuPhZAabwpLDHT8uaZBZBRMoMwxrUZCQddXU5WV0lEsWHfarQ8d67gNQ29snLZAJc3nXk0xZCSedzugPaZA7uHtXGPaQJZAw3BBM8gt0eAoDDFNELP0aR4wlbt6ZBZBX3PLGW5sWuo1eSZAibtSo39DaGA8lcJZBwZDZD',
    // Configurações do Polling
    pollingEnabled: process.env.POLLING_ENABLED !== 'false', // true por padrão
    pollingInterval: parseInt(process.env.POLLING_INTERVAL) || 120000, // 2 minutos
    instagramBusinessAccountId: process.env.INSTAGRAM_BUSINESS_ACCOUNT_ID || '17841464566186399' // ID correto da conta business
};

// Base de dados em memória
const connectedAccounts = new Map();
const webhookSubscriptions = new Map();

// ==========================================
// WEBHOOK UNIFICADO (INSTAGRAM + MESSENGER)
// ==========================================

// Webhook GET para verificação (Instagram + Messenger)
app.get('/webhook', (req, res) => {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];
    
    console.log('🔍 =======================================');
    console.log('🔍 VERIFICAÇÃO WEBHOOK UNIFICADO');
    console.log('🔍 =======================================');
    console.log('📊 Mode:', mode);
    console.log('🔑 Token recebido:', token);
    console.log('🎯 Challenge:', challenge);
    console.log('🔧 Token esperado:', CONFIG.webhookSecret);
    console.log('✅ Match?', token === CONFIG.webhookSecret);
    console.log('🔍 =======================================');
    
    // Aceitar múltiplos tokens para compatibilidade
    const validTokens = [
        CONFIG.webhookSecret,
        'webhook_secret_123',
        'meu_webhook_secret_123'
    ];
    
    if (mode === 'subscribe' && validTokens.includes(token)) {
        console.log('✅ WEBHOOK VERIFICADO COM SUCESSO!');
        console.log('📤 Retornando challenge:', challenge);
        res.status(200).send(challenge);
    } else {
        console.log('❌ VERIFICAÇÃO FALHOU');
        console.log('📋 Tokens aceitos:', validTokens);
        console.log('📥 Token recebido:', token);
        res.status(403).send('Forbidden');
    }
});

// Webhook POST para receber mensagens (Instagram + Messenger)
app.post('/webhook', express.raw({type: 'application/json'}), async (req, res) => {
    try {
        console.log('📨 [WEBHOOK-UNIFICADO] Dados recebidos');
        
        if (!req.body || req.body.length === 0) {
            console.log('⚠️ [WEBHOOK-UNIFICADO] Body vazio recebido');
            return res.status(200).send('OK');
        }

        let body;
        try {
            body = JSON.parse(req.body.toString());
        } catch (parseError) {
            console.error('❌ [WEBHOOK-UNIFICADO] Erro ao fazer parse do JSON:', parseError.message);
            return res.status(400).send('INVALID_JSON');
        }

        console.log('📱 [WEBHOOK-UNIFICADO] Webhook recebido:', JSON.stringify(body, null, 2));
        
        // Processar cada entrada
        if (body.entry && Array.isArray(body.entry)) {
            for (const entry of body.entry) {
                await processUnifiedWebhookEntry(entry);
            }
        } else {
            console.log('⚠️ [WEBHOOK-UNIFICADO] Nenhuma entrada encontrada');
        }
        
        res.status(200).send('EVENT_RECEIVED');
    } catch (error) {
        console.error('❌ [WEBHOOK-UNIFICADO] Erro:', error);
        res.status(500).send('ERROR');
    }
});

// Processar entrada do webhook unificado (Instagram + Messenger)
async function processUnifiedWebhookEntry(entry) {
    try {
        const pageId = entry.id;
        console.log(`🔍 [WEBHOOK-UNIFICADO] Processando página ${pageId}...`);
        
        // Usar token da configuração
        const subscription = {
            pageId: pageId,
            userId: 'webhook_user',
            accessToken: CONFIG.pageAccessToken,
            subscribedAt: new Date().toISOString(),
            active: true
        };
        
        console.log(`✅ [WEBHOOK-UNIFICADO] Subscription ativa para página ${pageId}`);
        
        // Processar mensagens (funciona para Instagram E Messenger)
        if (entry.messaging) {
            console.log(`💬 [WEBHOOK-UNIFICADO] ${entry.messaging.length} mensagens recebidas`);
            
            for (const messaging of entry.messaging) {
                await processUnifiedMessage(messaging, subscription);
            }
        }
        
        // Processar mudanças de status (se houver)
        if (entry.changes) {
            console.log(`🔄 [WEBHOOK-UNIFICADO] ${entry.changes.length} mudanças recebidas`);
            // Processar mudanças se necessário
        }
        
    } catch (error) {
        console.error('❌ [WEBHOOK-UNIFICADO] Erro ao processar entrada:', error.message);
    }
}

// Processar mensagem unificada (Instagram + Messenger)
async function processUnifiedMessage(messaging, subscription) {
    try {
        if (messaging.message && messaging.message.text) {
            console.log(`💬 [WEBHOOK-UNIFICADO] Mensagem recebida: "${messaging.message.text}"`);
            
            // Marcar como processada para evitar duplicatas
            if (messaging.message.mid) {
                processedMessages.add(messaging.message.mid);
            }
            
            // Detectar plataforma baseada no sender ID
            const platform = detectMessagePlatform(messaging.sender.id);
            
            // Obter informações do remetente
            const senderInfo = await getUserInfo(messaging.sender.id, subscription.accessToken);
            
            const messageData = {
                number: messaging.sender.id,
                message: messaging.message.text,
                sender_id: messaging.sender.id,
                sender_name: senderInfo.name || senderInfo.first_name || `Usuario ${platform}`,
                platform: platform,
                timestamp: messaging.timestamp ? new Date(messaging.timestamp).toISOString() : new Date().toISOString(),
                type: 'inbound',
                external_id: messaging.sender.id,
                external_message_id: messaging.message.mid,
                metadata: {
                    page_id: subscription.pageId,
                    received_at: new Date().toISOString(),
                    from_webhook_unificado: true,
                    platform: platform
                }
            };
            
            console.log('📦 [WEBHOOK-UNIFICADO] Dados preparados para MultiOne:', {
                sender: messageData.sender_name,
                message: messageData.message,
                platform: messageData.platform,
                method: 'webhook_unificado'
            });
            
            // Enviar para MultiOne
            await sendToMultiOne(messageData);
            
            console.log(`✅ [WEBHOOK-UNIFICADO] Mensagem ${platform} enviada para MultiOne com sucesso`);
        }
        
        // Processar postbacks (botões clicados)
        if (messaging.postback) {
            console.log(`🎯 [WEBHOOK-UNIFICADO] Postback recebido:`, messaging.postback);
            // Processar postback se necessário
        }
        
        // Processar delivery confirmations
        if (messaging.delivery) {
            console.log(`📬 [WEBHOOK-UNIFICADO] Delivery confirmation:`, messaging.delivery);
        }
        
    } catch (error) {
        console.error('❌ [WEBHOOK-UNIFICADO] Erro ao processar mensagem:', error.message);
    }
}

// Detectar plataforma baseada no ID do remetente
function detectMessagePlatform(senderId) {
    try {
        // IDs do Instagram são geralmente maiores (17+ dígitos)
        // IDs do Messenger são menores (15- dígitos)
        if (senderId && senderId.length >= 17) {
            return 'instagram';
        } else {
            return 'messenger';
        }
    } catch (error) {
        return 'unknown';
    }
}

// Debug endpoint
app.get('/webhook/debug', (req, res) => {
    res.json({
        status: 'WEBHOOK DEBUG',
        timestamp: new Date().toISOString(),
        config: {
            webhookSecret: CONFIG.webhookSecret,
            baseUrl: CONFIG.baseUrl,
            instagramToken: CONFIG.instagramPageToken ? 'configurado' : 'faltando',
            pageId: '752860274568592',
            instagramBusinessId: CONFIG.instagramBusinessAccountId
        },
        endpoints: {
            webhook_unificado: `${CONFIG.baseUrl}/webhook`,
            webhook_instagram_original: `${CONFIG.baseUrl}/webhook/instagram`,
            health: `${CONFIG.baseUrl}/health`,
            debug: `${CONFIG.baseUrl}/webhook/debug`
        },
        test_verification: `${CONFIG.baseUrl}/webhook?hub.mode=subscribe&hub.verify_token=webhook_secret_123&hub.challenge=test123`,
        meta_config: {
            callback_url: `${CONFIG.baseUrl}/webhook`,
            verify_token: 'webhook_secret_123',
            subscription_fields: [
                'messages',
                'messaging_postbacks', 
                'messaging_optins',
                'messaging_deliveries',
                'messaging_referrals',
                'message_reactions'
            ]
        },
        instructions: [
            '1. Vá para Meta for Developers',
            '2. Configure Webhook do Messenger com:',
            `   • Callback URL: ${CONFIG.baseUrl}/webhook`,
            '   • Verify Token: webhook_secret_123',
            '3. Configure Webhook do Instagram com a mesma URL',
            '4. Subscribe sua página aos webhooks',
            '5. Teste enviando mensagem no Instagram ou Messenger'
        ]
    });
});

console.log('🔧 Webhook unificado configurado em /webhook');
console.log('🔍 Debug disponível em /webhook/debug');

// ==========================================
// SISTEMA DE POLLING INSTAGRAM
// ==========================================

// Controle do polling
let pollingInterval = null;
let lastPollingCheck = new Date(Date.now() - 24 * 60 * 60 * 1000); // 24h atrás inicialmente
const processedMessages = new Set(); // Cache de mensagens já processadas

// Iniciar sistema de polling
function startPolling() {
    if (!CONFIG.pollingEnabled) {
        console.log('⚠️ Polling desabilitado via configuração');
        return;
    }

    if (!CONFIG.pageAccessToken) {
        console.log('⚠️ Token da página não configurado - polling não iniciado');
        return;
    }

    console.log('🔄 Iniciando sistema de polling Instagram...');
    console.log(`⏰ Intervalo: ${CONFIG.pollingInterval / 1000}s`);
    console.log(`📊 Instagram Account ID: ${CONFIG.instagramBusinessAccountId}`);

    // Parar polling anterior se existir
    if (pollingInterval) {
        clearInterval(pollingInterval);
        pollingInterval = null;
    }

    // Reset do último check para agora
    lastPollingCheck = new Date();
    console.log(`🕐 Último check resetado para: ${lastPollingCheck.toISOString()}`);

    // Polling inicial após 10 segundos
    setTimeout(() => {
        console.log('🚀 Executando primeiro polling...');
        pollInstagramMessages();
    }, 10000);

    // Configurar intervalo
    pollingInterval = setInterval(() => {
        console.log('⏰ Executando polling periódico...');
        pollInstagramMessages();
    }, CONFIG.pollingInterval);

    console.log('✅ Sistema de polling ativo!');
}

// Parar sistema de polling
function stopPolling() {
    if (pollingInterval) {
        clearInterval(pollingInterval);
        pollingInterval = null;
        console.log('🛑 Sistema de polling parado');
    }
}

// Função principal de polling
async function pollInstagramMessages() {
    try {
        const now = new Date();
        console.log(`🔍 [POLLING] Verificando novas mensagens Instagram... ${now.toISOString()}`);
        console.log(`📊 [POLLING] Token: ${CONFIG.pageAccessToken ? 'Configurado' : 'Faltando'}`);
        console.log(`🆔 [POLLING] Account ID: ${CONFIG.instagramBusinessAccountId}`);
        
        // 1. Buscar conversas da conta business
        const conversations = await getInstagramConversations();
        
        if (!conversations || conversations.length === 0) {
            console.log('📭 [POLLING] Nenhuma conversa encontrada');
            console.log('💡 [POLLING] Possíveis causas: ID incorreto, token sem permissões, ou sem mensagens');
            // Atualizar timestamp mesmo sem conversas
            lastPollingCheck = now;
            return;
        }

        console.log(`💬 [POLLING] ${conversations.length} conversas encontradas`);

        let newMessagesCount = 0;

        // 2. Para cada conversa, buscar mensagens novas
        for (const conversation of conversations) {
            try {
                const newMessages = await getNewMessagesFromConversation(conversation.id);
                
                if (newMessages && newMessages.length > 0) {
                    console.log(`📨 [POLLING] ${newMessages.length} mensagens novas na conversa ${conversation.id}`);
                    
                    // 3. Processar cada mensagem nova
                    for (const message of newMessages) {
                        await processPolledMessage(message, conversation);
                        newMessagesCount++;
                    }
                }
            } catch (error) {
                console.error(`❌ [POLLING] Erro ao processar conversa ${conversation.id}:`, error.message);
            }
        }

        // 4. Atualizar timestamp da última verificação
        lastPollingCheck = now;
        console.log(`🕐 [POLLING] Último check atualizado para: ${lastPollingCheck.toISOString()}`);

        if (newMessagesCount > 0) {
            console.log(`✅ [POLLING] ${newMessagesCount} mensagens processadas e enviadas para MultiOne`);
        } else {
            console.log('📭 [POLLING] Nenhuma mensagem nova encontrada');
        }

    } catch (error) {
        console.error('❌ [POLLING] Erro no sistema de polling:', error.message);
        console.error('📋 [POLLING] Detalhes do erro:', error);
        // Atualizar timestamp mesmo com erro
        lastPollingCheck = new Date();
    }
}

// Buscar conversas do Instagram
async function getInstagramConversations() {
    try {
        console.log(`🔍 [POLLING] Tentando buscar conversas...`);
        console.log(`📊 [POLLING] Instagram Business ID: ${CONFIG.instagramBusinessAccountId}`);
        console.log(`📄 [POLLING] Página ID: 752860274568592`);
        
        // Tentar diferentes métodos
        let response;
        
        // Método 1: Conversas da página (Facebook Messenger/Instagram unificado)
        try {
            console.log(`🔄 [POLLING] Tentando API de conversas da página...`);
            response = await axios.get(
                `https://graph.facebook.com/v18.0/752860274568592/conversations`,
                {
                    params: {
                        access_token: CONFIG.pageAccessToken,
                        fields: 'id,updated_time,participants,message_count',
                        platform: 'instagram', // Filtrar apenas Instagram
                        limit: 25
                    }
                }
            );
            console.log(`✅ [POLLING] Sucesso com conversas da página`);
        } catch (error) {
            console.log(`❌ [POLLING] Erro conversas da página: ${error.response?.data?.error?.message || error.message}`);
            
            // Método 2: Tentar sem filtro de plataforma
            try {
                console.log(`🔄 [POLLING] Tentando sem filtro de plataforma...`);
                response = await axios.get(
                    `https://graph.facebook.com/v18.0/752860274568592/conversations`,
                    {
                        params: {
                            access_token: CONFIG.pageAccessToken,
                            fields: 'id,updated_time,participants',
                            limit: 25
                        }
                    }
                );
                console.log(`✅ [POLLING] Sucesso sem filtro de plataforma`);
            } catch (error2) {
                console.log(`❌ [POLLING] Erro sem filtro: ${error2.response?.data?.error?.message || error2.message}`);
                
                // Método 3: Usar endpoint diferente
                try {
                    console.log(`🔄 [POLLING] Tentando endpoint de mensagens da página...`);
                    response = await axios.get(
                        `https://graph.facebook.com/v18.0/752860274568592/messages`,
                        {
                            params: {
                                access_token: CONFIG.pageAccessToken,
                                fields: 'id,created_time,from,to,message',
                                limit: 25
                            }
                        }
                    );
                    console.log(`✅ [POLLING] Sucesso com mensagens da página`);
                    
                    // Converter mensagens em formato de conversas
                    const messages = response.data.data || [];
                    const conversations = new Map();
                    
                    messages.forEach(msg => {
                        const conversationId = `conversation_${msg.from?.id || 'unknown'}`;
                        if (!conversations.has(conversationId)) {
                            conversations.set(conversationId, {
                                id: conversationId,
                                updated_time: msg.created_time,
                                participants: { data: [{ id: msg.from?.id }] }
                            });
                        }
                    });
                    
                    return Array.from(conversations.values());
                } catch (error3) {
                    console.log(`❌ [POLLING] Erro mensagens da página: ${error3.response?.data?.error?.message || error3.message}`);
                    throw error3;
                }
            }
        }

        return response.data.data || [];
    } catch (error) {
        console.error('❌ [POLLING] Todos os métodos falharam:', error.response?.data || error.message);
        return [];
    }
}

// Buscar mensagens novas de uma conversa
async function getNewMessagesFromConversation(conversationId) {
    try {
        // Buscar mensagens desde a última verificação
        const since = Math.floor(lastPollingCheck.getTime() / 1000);
        
        const response = await axios.get(
            `https://graph.facebook.com/v18.0/${conversationId}/messages`,
            {
                params: {
                    access_token: CONFIG.pageAccessToken,
                    fields: 'id,created_time,from,to,message',
                    since: since,
                    limit: 50
                }
            }
        );

        const allMessages = response.data.data || [];
        
        // Filtrar apenas mensagens que não processamos ainda
        const newMessages = allMessages.filter(msg => {
            // Verificar se já processamos esta mensagem
            if (processedMessages.has(msg.id)) {
                return false;
            }
            
            // Verificar se a mensagem é posterior à última verificação
            const messageTime = new Date(msg.created_time);
            return messageTime > lastPollingCheck;
        });

        // Marcar mensagens como processadas
        newMessages.forEach(msg => processedMessages.add(msg.id));

        return newMessages;
    } catch (error) {
        console.error(`❌ [POLLING] Erro ao buscar mensagens da conversa ${conversationId}:`, error.response?.data || error.message);
        return [];
    }
}

// Processar mensagem obtida via polling
async function processPolledMessage(message, conversation) {
    try {
        // Verificar se a mensagem tem texto
        if (!message.message || !message.message.text) {
            console.log(`⚠️ [POLLING] Mensagem ${message.id} sem texto - ignorando`);
            return;
        }

        console.log(`💬 [POLLING] Processando mensagem: "${message.message.text}"`);

        // Obter informações do remetente
        const senderInfo = await getUserInfo(message.from.id, CONFIG.pageAccessToken);

        // Preparar dados para MultiOne (mesmo formato do webhook)
        const messageData = {
            number: message.from.id,
            message: message.message.text,
            sender_id: message.from.id,
            sender_name: senderInfo.name || senderInfo.username || `Usuario Instagram`,
            platform: 'instagram',
            timestamp: message.created_time,
            type: 'inbound',
            external_id: message.from.id,
            external_message_id: message.id,
            metadata: {
                conversation_id: conversation.id,
                polling_method: true,
                received_at: new Date().toISOString(),
                from_polling: true,
                token_used: CONFIG.pageAccessToken.substring(0, 20) + '...'
            }
        };

        console.log('📦 [POLLING] Dados preparados para MultiOne:', {
            sender: messageData.sender_name,
            message: messageData.message,
            platform: messageData.platform,
            method: 'polling'
        });

        // Enviar para MultiOne
        await sendToMultiOne(messageData);
        
        console.log(`✅ [POLLING] Mensagem ${message.id} enviada para MultiOne com sucesso`);

    } catch (error) {
        console.error(`❌ [POLLING] Erro ao processar mensagem ${message.id}:`, error.message);
    }
}

// ==========================================
// FUNÇÕES UTILITÁRIAS
// ==========================================

// Obter informações do usuário
async function getUserInfo(userId, accessToken) {
    try {
        console.log(`👤 Buscando informações do usuário ${userId}...`);
        
        const response = await axios.get(`https://graph.facebook.com/v18.0/${userId}`, {
            params: {
                access_token: accessToken,
                fields: 'name,first_name,profile_pic,username'
            }
        });
        
        console.log(`✅ Info do usuário obtida: ${response.data.name || response.data.username || 'Nome não disponível'}`);
        return response.data;
    } catch (error) {
        console.log(`⚠️ Não foi possível obter info do usuário ${userId}:`, error.message);
        return { name: 'Usuario Instagram' };
    }
}

// Enviar para MultiOne
async function sendToMultiOne(messageData) {
    try {
        console.log('🚀 Enviando para MultiOne:', {
            sender: messageData.sender_name,
            message: messageData.message,
            platform: messageData.platform,
            method: messageData.metadata?.from_webhook_unificado ? 'webhook_unificado' : 
                    messageData.metadata?.from_webhook ? 'webhook' : 'polling',
            timestamp: messageData.timestamp
        });
        
        const response = await axios.post(CONFIG.multioneApiUrl, messageData, {
            headers: {
                'Authorization': `Bearer ${CONFIG.multioneToken}`,
                'Content-Type': 'application/json'
            },
            timeout: 15000
        });
        
        console.log('✅ Mensagem enviada para MultiOne com sucesso!');
        console.log('📊 Resposta MultiOne status:', response.status);
        
        return response.data;
        
    } catch (error) {
        console.error('❌ ERRO ao enviar para MultiOne:');
        console.error('📍 URL:', CONFIG.multioneApiUrl);
        console.error('📊 Status:', error.response?.status);
        console.error('📋 Dados:', error.response?.data);
        console.error('⚠️ Message:', error.message);
        throw error;
    }
}

console.log('🚀 Inicializando Sistema OAuth + Webhook + Polling...');
console.log(`🔑 Token Instagram: ${CONFIG.instagramPageToken ? 'Configurado' : 'Faltando'}`);
console.log(`🔄 Polling: ${CONFIG.pollingEnabled ? 'Habilitado' : 'Desabilitado'}`);

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
                webhookUrl: `${CONFIG.baseUrl}/webhook`,
                pollingActive: CONFIG.pollingEnabled
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

// ==========================================
// ENDPOINTS DE CONTROLE DO POLLING
// ==========================================

// Status do polling
app.get('/api/polling/status', (req, res) => {
    res.json({
        enabled: CONFIG.pollingEnabled,
        active: pollingInterval !== null,
        interval: CONFIG.pollingInterval,
        lastCheck: lastPollingCheck.toISOString(),
        processedMessages: processedMessages.size,
        instagramAccountId: CONFIG.instagramBusinessAccountId,
        tokenConfigured: CONFIG.instagramPageToken ? true : false
    });
});

// Controlar polling manualmente
app.post('/api/polling/control', (req, res) => {
    const { action } = req.body;
    
    try {
        switch (action) {
            case 'start':
                startPolling();
                res.json({ success: true, message: 'Polling iniciado', active: true });
                break;
                
            case 'stop':
                stopPolling();
                res.json({ success: true, message: 'Polling parado', active: false });
                break;
                
            case 'restart':
                stopPolling();
                setTimeout(() => startPolling(), 1000);
                res.json({ success: true, message: 'Polling reiniciado', active: true });
                break;
                
            case 'poll_now':
                pollInstagramMessages();
                res.json({ success: true, message: 'Polling manual executado' });
                break;
                
            default:
                res.status(400).json({ error: 'Ação inválida. Use: start, stop, restart, poll_now' });
        }
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ==========================================
// WEBHOOK INSTAGRAM ORIGINAL (MANTIDO PARA COMPATIBILIDADE)
// ==========================================

// Verificação do webhook Instagram original (GET)
app.get('/webhook/instagram', (req, res) => {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];
    
    console.log('🔍 Verificação webhook Instagram original:', { mode, token, challenge });
    
    if (mode === 'subscribe' && token === CONFIG.webhookSecret) {
        console.log('✅ Webhook Instagram original verificado');
        res.status(200).send(challenge);
    } else {
        console.log('❌ Verificação falhou');
        res.sendStatus(403);
    }
});

// Receber mensagens do webhook Instagram original (POST)
app.post('/webhook/instagram', express.raw({type: 'application/json'}), async (req, res) => {
    try {
        // Verificar se há body
        if (!req.body || req.body.length === 0) {
            console.log('⚠️ [WEBHOOK-INSTAGRAM] Body vazio recebido');
            return res.status(200).send('OK');
        }

        // Tentar fazer parse do JSON
        let body;
        try {
            const bodyString = req.body.toString();
            if (!bodyString || bodyString.trim() === '') {
                console.log('⚠️ [WEBHOOK-INSTAGRAM] Body string vazio');
                return res.status(200).send('OK');
            }
            body = JSON.parse(bodyString);
        } catch (parseError) {
            console.error('❌ [WEBHOOK-INSTAGRAM] Erro ao fazer parse do JSON:', parseError.message);
            console.error('📋 [WEBHOOK-INSTAGRAM] Body recebido:', req.body.toString());
            return res.status(400).send('INVALID_JSON');
        }

        console.log('📸 [WEBHOOK-INSTAGRAM] Instagram webhook recebido:', JSON.stringify(body, null, 2));
        
        // Processar cada entrada
        if (body.entry && Array.isArray(body.entry)) {
            for (const entry of body.entry) {
                await processWebhookEntry(entry);
            }
        } else {
            console.log('⚠️ [WEBHOOK-INSTAGRAM] Nenhuma entrada encontrada no webhook');
        }
        
        res.status(200).send('EVENT_RECEIVED');
    } catch (error) {
        console.error('❌ [WEBHOOK-INSTAGRAM] Erro processando webhook:', error);
        res.status(500).send('ERROR');
    }
});

// Processar entrada do webhook Instagram original
async function processWebhookEntry(entry) {
    const pageId = entry.id;
    
    console.log(`🔍 [WEBHOOK-INSTAGRAM] Processando entrada para página ${pageId}...`);
    
    // Usar token fixo para testers
    const subscription = {
        pageId: pageId,
        userId: 'tester_user',
        accessToken: CONFIG.instagramPageToken,
        subscribedAt: new Date().toISOString(),
        active: true
    };
    
    console.log(`✅ [WEBHOOK-INSTAGRAM] Subscription ativa para página ${pageId}`);
    
    // Processar mensagens
    if (entry.messaging) {
        console.log(`💬 [WEBHOOK-INSTAGRAM] Processando ${entry.messaging.length} mensagens...`);
        for (const messaging of entry.messaging) {
            await processInstagramMessage(messaging, subscription);
        }
    }
}

// Processar mensagem do Instagram original (Webhook)
async function processInstagramMessage(messaging, subscription) {
    try {
        if (messaging.message && messaging.message.text) {
            console.log(`💬 [WEBHOOK-INSTAGRAM] Mensagem Instagram recebida: "${messaging.message.text}"`);
            
            // Marcar como processada para evitar duplicatas com polling
            if (messaging.message.mid) {
                processedMessages.add(messaging.message.mid);
            }
            
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
                    received_at: new Date().toISOString(),
                    from_webhook_instagram: true,
                    token_used: subscription.accessToken.substring(0, 20) + '...'
                }
            };
            
            console.log('📦 [WEBHOOK-INSTAGRAM] Dados preparados para MultiOne:', {
                sender: messageData.sender_name,
                message: messageData.message,
                platform: messageData.platform,
                method: 'webhook_instagram'
            });
            
            // Enviar para MultiOne
            await sendToMultiOne(messageData);
        }
    } catch (error) {
        console.error('❌ [WEBHOOK-INSTAGRAM] Erro processando mensagem Instagram:', error.message);
    }
}

// ==========================================
// ENDPOINTS DE MONITORAMENTO
// ==========================================

// Health check
app.get('/health', (req, res) => {
    res.json({
        status: 'OK',
        service: 'Instagram + Messenger OAuth + Webhook + Polling System',
        timestamp: new Date().toISOString(),
        connections: {
            connectedAccounts: connectedAccounts.size,
            activeWebhooks: webhookSubscriptions.size,
            multioneConnection: CONFIG.multioneToken ? 'configured' : 'missing',
            instagramToken: CONFIG.instagramPageToken ? 'configured' : 'missing'
        },
        polling: {
            enabled: CONFIG.pollingEnabled,
            active: pollingInterval !== null,
            interval: CONFIG.pollingInterval,
            lastCheck: lastPollingCheck.toISOString(),
            processedMessages: processedMessages.size
        },
        webhooks: {
            unified: `${CONFIG.baseUrl}/webhook`,
            instagram_original: `${CONFIG.baseUrl}/webhook/instagram`,
            debug: `${CONFIG.baseUrl}/webhook/debug`
        },
        config: {
            baseUrl: CONFIG.baseUrl,
            facebookAppId: CONFIG.facebookAppId,
            multioneApiUrl: CONFIG.multioneApiUrl,
            instagramBusinessAccountId: CONFIG.instagramBusinessAccountId
        }
    });
});

// Logs recentes
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
            number: 'test_user_unified_system',
            message: 'TESTE SISTEMA UNIFICADO - Instagram + Messenger → MultiOne - Funcionando!',
            sender_id: 'unified_test_system',
            sender_name: 'Sistema Unificado Teste',
            platform: 'test',
            timestamp: new Date().toISOString(),
            type: 'inbound',
            test: true
        };
        
        const result = await sendToMultiOne(testMessage);
        
        res.json({ 
            success: true, 
            result,
            message: 'Teste manual enviado para MultiOne com sucesso!'
        });
        
    } catch (error) {
        res.status(500).json({ 
            success: false, 
            error: error.message
        });
    }
});

// Testar polling manualmente
app.post('/api/test/polling', async (req, res) => {
    try {
        if (!CONFIG.instagramPageToken) {
            return res.status(400).json({ 
                success: false, 
                error: 'Token Instagram não configurado' 
            });
        }
        
        // Executar polling manual
        await pollInstagramMessages();
        
        res.json({ 
            success: true, 
            message: 'Polling manual executado com sucesso!',
            status: {
                lastCheck: lastPollingCheck.toISOString(),
                processedMessages: processedMessages.size
            }
        });
        
    } catch (error) {
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
});

// Testar webhook unificado
app.post('/api/test/webhook', async (req, res) => {
    try {
        const testWebhookData = {
            object: 'page',
            entry: [{
                id: '752860274568592',
                time: Date.now(),
                messaging: [{
                    sender: { id: 'test_sender_123' },
                    recipient: { id: '752860274568592' },
                    timestamp: Date.now(),
                    message: {
                        mid: 'test_message_' + Date.now(),
                        text: 'Teste do webhook unificado - mensagem simulada'
                    }
                }]
            }]
        };

        console.log('🧪 [TESTE-WEBHOOK] Simulando entrada de webhook...');
        await processUnifiedWebhookEntry(testWebhookData.entry[0]);

        res.json({
            success: true,
            message: 'Teste de webhook executado com sucesso!',
            data: testWebhookData
        });

    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ==========================================
// INICIALIZAÇÃO DO SERVIDOR
// ==========================================

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log('🎉 =======================================');
    console.log('🚀 SISTEMA UNIFICADO INSTAGRAM + MESSENGER ATIVO!');
    console.log('🎉 =======================================');
    console.log(`🌐 Servidor: ${CONFIG.baseUrl}`);
    console.log(`📱 Interface: ${CONFIG.baseUrl}`);
    console.log(`🔗 OAuth Callback: ${CONFIG.baseUrl}/oauth/callback`);
    console.log(`📨 Webhook Unificado: ${CONFIG.baseUrl}/webhook`);
    console.log(`📸 Webhook Instagram: ${CONFIG.baseUrl}/webhook/instagram`);
    console.log(`🔍 Debug Webhook: ${CONFIG.baseUrl}/webhook/debug`);
    console.log(`💚 Health: ${CONFIG.baseUrl}/health`);
    console.log('🎉 =======================================');
    console.log(`📋 Config: App ID ${CONFIG.facebookAppId}`);
    console.log(`🔑 MultiOne: ${CONFIG.multioneToken ? 'Configurado' : 'Faltando'}`);
    console.log(`📸 Instagram Token: ${CONFIG.instagramPageToken ? 'Configurado' : 'Faltando'}`);
    console.log(`🔄 Polling: ${CONFIG.pollingEnabled ? 'Habilitado' : 'Desabilitado'} (${CONFIG.pollingInterval/1000}s)`);
    console.log('🎉 =======================================');
    console.log('📱 PLATAFORMAS SUPORTADAS:');
    console.log('  ✅ Instagram Direct Messages');
    console.log('  ✅ Facebook Messenger');
    console.log('  ✅ Webhook em tempo real');
    console.log('  ✅ Polling backup');
    console.log('🎉 =======================================');
    
    // Inicializar sistema de polling após 3 segundos
    if (CONFIG.pollingEnabled && CONFIG.instagramPageToken) {
        console.log('🔄 Iniciando sistema de polling em 3 segundos...');
        setTimeout(() => {
            startPolling();
        }, 3000);
    } else {
        console.log('⚠️ Polling não iniciado:');
        if (!CONFIG.pollingEnabled) console.log('   - Polling desabilitado');
        if (!CONFIG.instagramPageToken) console.log('   - Token Instagram não configurado');
    }
});

// Cleanup ao encerrar aplicação
process.on('SIGTERM', () => {
    console.log('🛑 Encerrando aplicação...');
    stopPolling();
    process.exit(0);
});

process.on('SIGINT', () => {
    console.log('🛑 Encerrando aplicação...');
    stopPolling();
    process.exit(0);
});

module.exports = app;
