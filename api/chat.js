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

    const { message, history = [], search = false } = req.body;
    const apiKey = process.env.OPENROUTER_API_KEY;

    if (!apiKey) {
        return res.status(500).json({ error: 'Sunucu Hatası: API key tanımlanmamış.' });
    }
    if (!message || message.trim() === '') {
        return res.status(400).json({ error: 'Mesaj boş olamaz.' });
    }

    const API_URL = 'https://openrouter.ai/api/v1/chat/completions';
    const MODEL = 'minimax/minimax-m2.5';

    const systemPrompt = `Sen RLM 5'sin. Turkiye'de gelistirilmis gelismis bir yapay zeka asistansin. Turkce konus. Kullaniciya RLM 5 oldugunu soyle, kurucu bilgisi sorulursa Troye ekibi de. Kendini AI model, MiniMax, Claude, Qwen vb. olarak tanitma. Sik, faydali ve dogru cevaplar ver. Araştırma yaparken, verilen web arama sonuçlarını kullanarak kapsamlı ve detaylı cevaplar ver.`;

    const hfMessages = [{ role: 'system', content: systemPrompt }];
    
    if (history.length > 0) {
        history.forEach(msg => {
            hfMessages.push({
                role: msg.role === 'user' ? 'user' : 'assistant',
                content: msg.content
            });
        });
    }

    let userMessage = message;

    if (search) {
        try {
            const searchResults = await searchDuckDuckGo(message);
            const researchContext = buildResearchContext(searchResults);
            userMessage = `📊 WEB ARAŞTIRMASI:\n${researchContext}\n\n❓ KULLANICI SORUSU:\n${message}\n\nYukarıdaki web araştırma sonuçlarına dayanarak kapsamlı ve detaylı bir cevap ver. Kaynakları belirt.`;
        } catch (err) {
            console.error('Search Error:', err);
        }
    }
    
    hfMessages.push({ role: 'user', content: userMessage });

    try {
        const response = await fetch(API_URL, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
                'HTTP-Referer': 'https://rlm5.vercel.app',
                'X-Title': 'RLM 5'
            },
            body: JSON.stringify({
                model: MODEL,
                messages: hfMessages,
                max_tokens: search ? 2000 : 500,
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

        if (search && aiReply) {
            aiReply += '\n\n_🌐 Bu cevap web araştırmasıyla desteklenmiştir._';
        }

        res.status(200).json({ reply: aiReply });

    } catch (error) {
        console.error('API Error:', error);
        res.status(500).json({ error: 'Sunucu hatası. Bağlantınızı kontrol edin.' });
    }
};

async function searchDuckDuckGo(query) {
    const encodedQuery = encodeURIComponent(query);
    const url = `https://api.duckduckgo.com/?q=${encodedQuery}&format=json&pretty=1&no_redirect=1&t=h_&df=all`;
    
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error('DuckDuckGo search failed');
    }
    
    const data = await response.json();
    
    const results = {
        answer: data.AbstractText || '',
        answerSource: data.AbstractURL || '',
        definition: data.Definition || '',
        definitionSource: data.DefinitionURL || '',
        relatedTopics: [],
        results: []
    };

    if (data.RelatedTopics && data.RelatedTopics.length > 0) {
        results.relatedTopics = data.RelatedTopics
            .filter(t => t.Text && t.Text.length > 20)
            .slice(0, 10)
            .map(t => ({
                title: t.Text?.substring(0, 100) || '',
                url: t.FirstURL || ''
            }));
    }

    try {
        const htmlResponse = await fetch(`https://lite.duckduckgo.com/lite/?q=${encodedQuery}&kl=tr-tr`);
        const html = await htmlResponse.text();
        const linkMatches = html.match(/<a class="result-link"[^>]*href="([^"]*)"[^>]*>([^<]*)<\/a>/gi) || [];
        const snippetMatches = html.match(/<a class="result-link"[^>]*>.*?<\/a>\s*([^<]*<span class="result-snippet">[^<]*<\/span>)?/gi) || [];
        
        let links = [];
        linkMatches.forEach(match => {
            const urlMatch = match.match(/href="([^"]*)"/);
            const titleMatch = match.match(/>([^<]*)<\/a>/);
            if (urlMatch && titleMatch) {
                const url = urlMatch[1];
                if (!url.includes('duckduckgo') && !url.includes('yahoo.com') && !url.includes('bing.com')) {
                    links.push({
                        url: url,
                        title: titleMatch[1].trim()
                    });
                }
            }
        });

        const snippetRegex = /<span class="result-snippet">([^<]*(?:<[^>]*>[^<]*)*)<\/span>/gi;
        let snippets = [];
        let snippetMatch;
        while ((snippetMatch = snippetRegex.exec(html)) !== null && snippets.length < 5) {
            const clean = snippetMatch[1].replace(/<[^>]*>/g, '').trim();
            if (clean.length > 30) {
                snippets.push(clean);
            }
        }

        for (let i = 0; i < Math.min(links.length, snippets.length); i++) {
            results.results.push({
                title: links[i].title,
                url: links[i].url,
                snippet: snippets[i] || ''
            });
        }
    } catch (e) {
        console.log('HTML search skipped:', e.message);
    }

    return results;
}

function buildResearchContext(results) {
    let context = '';

    if (results.answer) {
        context += `📝 GENEL BİLGİ:\n${results.answer}\n`;
        if (results.answerSource) {
            context += `Kaynak: ${results.answerSource}\n`;
        }
        context += '\n';
    }

    if (results.definition) {
        context += `📖 TANIM:\n${results.definition}\n`;
        if (results.definitionSource) {
            context += `Kaynak: ${results.definitionSource}\n`;
        }
        context += '\n';
    }

    if (results.results && results.results.length > 0) {
        context += `🔍 WEB ARAŞTIRMA SONUÇLARI:\n\n`;
        results.results.forEach((r, i) => {
            context += `${i + 1}. ${r.title}\n   ${r.snippet}\n   🔗 ${r.url}\n\n`;
        });
    }

    if (results.relatedTopics && results.relatedTopics.length > 0) {
        context += `📌 İLGİLİ KONULAR:\n`;
        results.relatedTopics.slice(0, 5).forEach((t, i) => {
            context += `- ${t.title}\n`;
            if (t.url) context += `  ${t.url}\n`;
        });
    }

    return context || 'Web araştırması sonuçları alınamadı.';
}
