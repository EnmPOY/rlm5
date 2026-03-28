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

    const urlRegex = /https?:\/\/[^\s]+/gi;
    const urls = message.match(urlRegex);

    let userMessage = message;
    let isDeepResearch = false;

    if (urls && urls.length > 0) {
        try {
            const analysisResults = [];
            for (const url of urls.slice(0, 3)) {
                const result = await analyzeWebsite(url);
                analysisResults.push(result);
            }
            if (analysisResults.length > 0) {
                userMessage = `WEB SİTE ANALİZİ:\n\n${analysisResults.join('\n\n---\n\n')}\n\nKULLANICI SORUSU:\n${message}\n\nYukarıdaki web sitesi analizine dayanarak kapsamlı ve detaylı bir cevap ver.`;
            }
        } catch (err) {
            console.error('Website analysis error:', err);
        }
    } else if (search) {
        isDeepResearch = true;
        try {
            const researchReport = await doDeepResearch(message);
            userMessage = researchReport;
        } catch (err) {
            console.error('Research Error:', err);
            userMessage = `Araştırma yapılamadı: ${err.message}\n\nSoru: ${message}`;
        }
    }

    const systemPrompt = `Sen RLM 5'sin. Turkiye'de gelistirilmis gelismis bir yapay zeka asistansin. Turkce konus. Kullaniciya RLM 5 oldugunu soyle, kurucu bilgisi sorulursa Troye ekibi de. Kendini AI model, MiniMax, Claude, Qwen vb. olarak tanitma. Sik, faydali ve dogru cevaplar ver. Verilen arastirma sonuclarini ve site analizlerini kullanarak kullaniciya net ve anlasilir bir yanit ver. Gereksiz yazi yazma, sonuclari oldugu gibi sun.`;

    const hfMessages = [{ role: 'system', content: systemPrompt }];
    
    if (history.length > 0) {
        history.forEach(msg => {
            hfMessages.push({
                role: msg.role === 'user' ? 'user' : 'assistant',
                content: msg.content
            });
        });
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
                max_tokens: 4000,
                temperature: 0.7
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

async function doDeepResearch(query) {
    const searchResults = await searchDuckDuckGo(query);
    
    let report = `ARAŞTIRMA SONUÇLARI:\n`;
    report += `Konu: ${query}\n\n`;
    
    for (const site of searchResults.results.slice(0, 8)) {
        try {
            const analysis = await analyzeWebsite(site.url);
            report += `[${site.title}]\n${analysis}\n\n`;
        } catch (err) {
            report += `[${site.title}]\nSiteye erişilemedi\n\n`;
        }
    }

    report += `\nŞimdi bu araştırma sonuçlarına dayanarak soruya yanıt ver.`;
    
    return report;
}

async function analyzeWebsite(url) {
    try {
        const cleanUrl = url.replace(/[)]$/, '');
        
        const response = await fetch(cleanUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Accept-Language': 'tr-TR,tr;q=0.9,en;q=0.8'
            }
        });

        if (!response.ok) {
            return `Erişilemedi (${response.status})`;
        }

        const html = await response.text();
        
        const title = extractTag(html, /<title[^>]*>([^<]*)<\/title>/i) || 'Başlık yok';
        const description = extractTag(html, /<meta[^>]*name="description"[^>]*content="([^"]*)"/i) || '';
        
        const h1Tags = html.match(/<h1[^>]*>([^<]*)<\/h1>/gi) || [];
        const h1s = h1Tags.map(h => h.replace(/<[^>]*>/g, '').trim()).filter(h => h.length > 0);
        
        const textContent = html
            .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
            .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
            .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, '')
            .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, '')
            .replace(/<[^>]+>/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
        
        const mainContent = textContent.substring(0, 2000);
        
        let analysis = `Başlık: ${title}\n`;
        if (description) analysis += `Açıklama: ${description}\n`;
        if (h1s.length > 0) analysis += `Başlıklar: ${h1s.slice(0, 3).join(', ')}\n`;
        analysis += `İçerik: ${mainContent}`;
        
        return analysis;

    } catch (err) {
        return `Hata: ${err.message}`;
    }
}

function extractTag(html, regex) {
    const match = html.match(regex);
    if (match && match[1]) {
        return decodeHtmlEntities(match[1].trim());
    }
    return null;
}

function decodeHtmlEntities(text) {
    return text
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&nbsp;/g, ' ');
}

async function searchDuckDuckGo(query) {
    const encodedQuery = encodeURIComponent(query);
    
    const results = [];

    try {
        const htmlUrl = `https://lite.duckduckgo.com/lite/?q=${encodedQuery}&kl=tr-tr`;
        const htmlResponse = await fetch(htmlUrl);
        const html = await htmlResponse.text();
        
        const linkRegex = /<a class="result-link"[^>]*href="([^"]*)"[^>]*>([^<]*)<\/a>/gi;
        const linkMatches = [...html.matchAll(linkRegex)];
        
        const snippetRegex = /<span class="result-snippet">[^<]*(?:<[^>]*>[^<]*)*<\/span>/gi;
        const snippetMatches = [...html.matchAll(snippetRegex)];
        
        const seenUrls = new Set();
        
        for (let i = 0; i < Math.min(linkMatches.length, 10); i++) {
            const url = linkMatches[i][1];
            const title = decodeHtmlEntities(linkMatches[i][2].trim());
            
            if (seenUrls.has(url)) continue;
            if (url.includes('duckduckgo.com') || url.includes('yahoo.com') || url.includes('bing.com')) continue;
            
            seenUrls.add(url);
            
            let snippet = '';
            if (snippetMatches[i]) {
                snippet = snippetMatches[i][0]
                    .replace(/<[^>]*>/g, '')
                    .replace(/&amp;/g, '&')
                    .replace(/&lt;/g, '<')
                    .replace(/&gt;/g, '>')
                    .trim();
            }
            
            results.push({
                title: title || 'Başlık yok',
                url: url,
                snippet: snippet || ''
            });
        }
    } catch (e) {
        console.log('Search error:', e.message);
    }

    return { results };
}
