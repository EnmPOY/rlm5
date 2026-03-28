module.exports = async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
    res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Content-Type');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Sadece POST istekleri kabul edilir.' });
    }

    const { message, history = [], autoThink = true } = req.body;
    const hfToken = process.env.HF_TOKEN;

    if (!hfToken) {
        return res.status(500).json({ error: 'Sunucu Hatası: HF_TOKEN tanımlanmamış.' });
    }
    if (!message || message.trim() === '') {
        return res.status(400).json({ error: 'Mesaj boş olamaz.' });
    }

    const AI_NAME = 'RLM 5';
    const modelUrl = 'https://api-inference.huggingface.co/models/THUDM/glm-4-9b-chat';
    const systemPrompt = `Senin adın ${AI_NAME}. Sen gelişmiş, bağımsız ve Türkçe konuşan bir yapay zeka asistanısın. Seni G63 geliştirdi. Sadece yardımsever ve zeki bir asistan olarak cevap ver.`;

    let fullPrompt = `${systemPrompt}\n\n`;
    
    if (history.length > 0) {
        history.forEach(msg => {
            const role = msg.role === 'user' ? 'Kullanıcı' : AI_NAME;
            fullPrompt += `${role}: ${msg.content}\n`;
        });
    }
    
    fullPrompt += `Kullanıcı: ${message}\n${AI_NAME}:`;

    try {
        const response = await fetch(modelUrl, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${hfToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                inputs: fullPrompt,
                parameters: {
                    max_new_tokens: 1024,
                    temperature: 0.7,
                    top_p: 0.9,
                    repetition_penalty: 1.1,
                    return_full_text: false
                },
                options: {
                    wait_for_model: true
                }
            })
        });

        if (!response.ok) {
            const errorData = await response.json();
            if (response.status === 503) {
                return res.status(503).json({ 
                    error: `Model uyanıyor, ${Math.round(errorData.estimated_time || 30)} saniye sonra tekrar deneyin.` 
                });
            }
            throw new Error(errorData.error || 'API hatası.');
        }

        const data = await response.json();
        let aiReply = data[0]?.generated_text?.trim() || '';
        
        if (aiReply.startsWith(`${AI_NAME}:`)) {
            aiReply = aiReply.replace(`${AI_NAME}:`, '').trim();
        }

        res.status(200).json({ reply: aiReply });

    } catch (error) {
        console.error('API Error:', error);
        res.status(500).json({ error: 'Sunucu hatası. Bağlantınızı kontrol edin.' });
    }
};
