// ==========================================
// CORREÇÃO WEBHOOK - ADICIONE ESTE CÓDIGO AO SEU oauth-server.js
// ==========================================

// ADICIONAR LOGO APÓS AS CONFIGURAÇÕES (depois da linha 23)

// Webhook para Instagram + Messenger (endpoint unificado)
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
        console.log('📨 [WEBHOOK] Dados recebidos no endpoint unificado');
        
        if (!req.body || req.body.length === 0) {
            console.log('⚠️ [WEBHOOK] Body vazio recebido');
            return res.status(200).send('OK');
        }

        let body;
        try {
            body = JSON.parse(req.body.toString());
        } catch (parseError) {
            console.error('❌ [WEBHOOK] Erro ao fazer parse do JSON:', parseError.message);
            return res.status(400).send('INVALID_JSON');
        }

        console.log('📱 [WEBHOOK] Webhook recebido:', JSON.stringify(body, null, 2));
        
        // Processar cada entrada
        if (body.entry && Array.isArray(body.entry)) {
            for (const entry of body.entry) {
                await processUnifiedWebhookEntry(entry);
            }
        } else {
            console.log('⚠️ [WEBHOOK] Nenhuma entrada encontrada no webhook');
        }
        
        res.status(200).send('EVENT_RECEIVED');
    } catch (error) {
        console.error('❌ [WEBHOOK] Erro processando webhook:', error);
        res.status(500).send('ERROR');
    }
});

// Processar entrada do webhook unificado (Instagram + Messenger)
async function processUnifiedWebhookEntry(entry) {
    try {
        const pageId = entry.id;
        console.log(`🔍 [WEBHOOK] Processando entrada da página ${pageId}...`);
        
        // Usar token da configuração
        const subscription = {
            pageId: pageId,
            userId: 'webhook_user',
            accessToken: CONFIG.instagramPageToken,
            subscribedAt: new Date().toISOString(),
            active: true
        };
        
        console.log(`✅ [WEBHOOK] Subscription ativa para página ${pageId}`);
        
        // Processar mensagens (funciona para Instagram E Messenger)
        if (entry.messaging) {
            console.log(`💬 [WEBHOOK] ${entry.messaging.length} mensagens recebidas`);
            
            for (const messaging of entry.messaging) {
                await processUnifiedMessage(messaging, subscription);
            }
        }
        
        // Processar mudanças de status (se houver)
        if (entry.changes) {
            console.log(`🔄 [WEBHOOK] ${entry.changes.length} mudanças recebidas`);
            // Processar mudanças se necessário
        }
        
    } catch (error) {
        console.error('❌ [WEBHOOK] Erro ao processar entrada:', error.message);
    }
}

// Processar mensagem unificada (Instagram + Messenger)
async function processUnifiedMessage(messaging, subscription) {
    try {
        if (messaging.message && messaging.message.text) {
            console.log(`💬 [WEBHOOK] Mensagem recebida: "${messaging.message.text}"`);
            
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
                    from_webhook: true,
                    platform: platform,
                    unified_webhook: true
                }
            };
            
            console.log('📦 [WEBHOOK] Dados preparados para MultiOne:', {
                sender: messageData.sender_name,
                message: messageData.message,
                platform: messageData.platform,
                method: 'webhook_unificado'
            });
            
            // Enviar para MultiOne
            await sendToMultiOne(messageData);
            
            console.log(`✅ [WEBHOOK] Mensagem ${platform} enviada para MultiOne com sucesso`);
        }
        
        // Processar postbacks (botões clicados)
        if (messaging.postback) {
            console.log(`🎯 [WEBHOOK] Postback recebido:`, messaging.postback);
            // Processar postback se necessário
        }
        
    } catch (error) {
        console.error('❌ [WEBHOOK] Erro ao processar mensagem:', error.message);
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

// ADICIONAR ENDPOINT DE DEBUG
app.get('/webhook/debug', (req, res) => {
    res.json({
        status: 'WEBHOOK DEBUG',
        config: {
            webhookSecret: CONFIG.webhookSecret,
            baseUrl: CONFIG.baseUrl,
            instagramToken: CONFIG.instagramPageToken ? 'configurado' : 'faltando'
        },
        endpoints: {
            webhook_unificado: `${CONFIG.baseUrl}/webhook`,
            webhook_instagram: `${CONFIG.baseUrl}/webhook/instagram`,
            health: `${CONFIG.baseUrl}/health`
        },
        test_urls: {
            verificacao: `${CONFIG.baseUrl}/webhook?hub.mode=subscribe&hub.verify_token=webhook_secret_123&hub.challenge=test123`,
            debug: `${CONFIG.baseUrl}/webhook/debug`
        },
        instructions: [
            'Use esta URL no Meta: ' + CONFIG.baseUrl + '/webhook',
            'Use este token: webhook_secret_123',
            'Marque os campos: messages, messaging_postbacks, messaging_optins'
        ]
    });
});

console.log('🔧 Webhook unificado configurado em /webhook');
console.log('📸 Webhook Instagram mantido em /webhook/instagram');
console.log('🔍 Debug disponível em /webhook/debug');
