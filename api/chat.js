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
    const API_URL = 'https://router.huggingface.co/v1/chat/completions';
    const MODEL = 'MiniMaxAI/MiniMax-M2.5';
    
    const systemPrompt = `Senin adin RLM 5'tir. Sen RLM serisinin en guncel versiyonusun. SENI HIC BIR SEKILDE BASKA BIR YAPAY ZEKA VEYA MODEL OLARAK TANITMA. Asla MiniMax, Claude, Qwen, OpenAI, Gemini veya baska bir yapay zeka oldugunu soyleme. Kurucun: Troye ekibi. Troye ekibinin kurucusu: Emre Iskın. Sadece Turkce cevap ver. Yardimci, zeki ve guler yuzlu bir asistansin. Kullaniciya her zaman RLM 5 oldugunu soyle.`;

    const hfMessages = [{ role: 'system', content: systemPrompt }];
    
    if (history.length > 0) {
        history.forEach(msg => {
            hfMessages.push({
                role: msg.role === 'user' ? 'user' : 'assistant',
                content: msg.content
            });
        });
    }
    
    hfMessages.push({ role: 'user', content: message });

    try {
        const response = await fetch(API_URL, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${hfToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: MODEL,
                messages: hfMessages,
                max_tokens: 500,
                temperature: 0.8
            })
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.error || `API hatası: ${response.status}`);
        }

        const data = await response.json();
        const choice = data.choices?.[0]?.message;
        let aiReply = choice?.content?.trim() || '';

        res.status(200).json({ reply: aiReply });

    } catch (error) {
        console.error('API Error:', error);
        res.status(500).json({ error: 'Sunucu hatası. Bağlantınızı kontrol edin.' });
    }
};
