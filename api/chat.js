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
                const result = await analyzeWebsiteFull(url);
                analysisResults.push(result);
            }
            if (analysisResults.length > 0) {
                userMessage = `SITE ANALIZI:\n\n${analysisResults.join('\n\n========================================\n\n')}\n\nSORU: ${message}\n\nYukaridaki site analizlerine gore detayli yanit ver.`;
            }
        } catch (err) {
            console.error('Website analysis error:', err);
        }
    } else if (search) {
        isDeepResearch = true;
        try {
            const researchReport = await doDeepResearch(query);
            userMessage = researchReport;
        } catch (err) {
            console.error('Research Error:', err);
            userMessage = `Araştırma hatasi: ${err.message}\n\nSoru: ${message}`;
        }
    }

    const systemPrompt = isDeepResearch
        ? `Sen RLM 5'sin. Turkiye'de gelistirilmis gelismis bir yapay zeka asistansin. Turkce konus. Kullaniciya RLM 5 oldugunu soyle, kurucu bilgisi sorulursa Troye ekibi de.

ARASTIRMA YAP:
1. Asagida web'den toplanan arama sonuclari ve site analizleri var
2. Her siteyi dikkatlice oku
3. Tum bilgileri birlestir
4. Karsilastir ve degerlendir
5. Net, anlasilir, detayli bir rapor yaz
6. Kaynaklari belirt

Yanitini su sekilde ver:
- Konu Ozeti
- Bulunan Bilgiler (site bazli)
- Detayli Analiz
- Sonuc
- Kaynaklar (linkler)`
        : `Sen RLM 5'sin. Turkiye'de gelistirilmis gelismis bir yapay zeka asistansin. Turkce konus. Kullaniciya RLM 5 oldugunu soyle, kurucu bilgisi sorulursa Troye ekibi de. Sik, faydali ve dogru cevaplar ver.`;

    const hfMessages = [{ role: 'system', content: systemPrompt }];
    
    if (history.length > 0) {
        history.slice(-6).forEach(msg => {
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
    console.log('ARASTIRMA BASLADI:', query);
    
    const searchResults = await searchWeb(query);
    console.log('Bulunan sonuc sayisi:', searchResults.length);
    
    if (searchResults.length === 0) {
        return `Arama sonucu bulunamadi. Tekrar deneyin.\n\nSoru: ${query}`;
    }
    
    let report = `ARASTIRMA SONUCLARI\n`;
    report += `Konu: ${query}\n`;
    report += `Bulunan kaynak: ${searchResults.length} adet\n\n`;
    
    for (let i = 0; i < searchResults.length; i++) {
        const site = searchResults[i];
        report += `\n========================================\n`;
        report += `KAYNAK ${i + 1}: ${site.title}\n`;
        report += `URL: ${site.url}\n`;
        report += `========================================\n`;
        
        const analysis = await analyzeWebsiteFull(site.url);
        report += analysis;
        
        report += `\n`;
    }
    
    report += `\n========================================\n`;
    report += `YUKARIDAKI ${searchResults.length} KAYNAGIN HEPSINI INCELE VE DETAYLI BIR RAPOR HAZIRLA.\n`;
    report += `========================================\n`;
    
    return report;
}

async function searchWeb(query) {
    const results = [];
    const encodedQuery = encodeURIComponent(query);
    
    try {
        const response = await fetch(`https://lite.duckduckgo.com/lite/?q=${encodedQuery}&kl=tr-tr`, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
                'Accept': 'text/html',
                'Accept-Language': 'tr-TR,tr;q=0.9'
            }
        });
        
        const html = await response.text();
        
        const linkRegex = /<a\s+class="result-link"\s+href="([^"]+)"[^>]*>([^<]+)<\/a>/gi;
        const snippetRegex = /<span class="result-snippet">([\s\S]*?)<\/span>/gi;
        
        const links = [...html.matchAll(linkRegex)];
        const snippets = [...html.matchAll(snippetRegex)];
        
        for (let i = 0; i < Math.min(links.length, 10); i++) {
            const url = links[i][1];
            const title = cleanText(links[i][2]);
            
            if (isGoodUrl(url)) {
                let snippet = '';
                if (snippets[i]) {
                    snippet = cleanText(snippets[i][1]).substring(0, 400);
                }
                
                results.push({ title, url, snippet });
            }
        }
    } catch (e) {
        console.error('Search error:', e.message);
    }
    
    return results;
}

function isGoodUrl(url) {
    if (!url || url.length < 15) return false;
    if (url.includes('duckduckgo.com')) return false;
    if (url.includes('yahoo.com')) return false;
    if (url.includes('bing.com')) return false;
    if (url.includes('google.com')) return false;
    if (url.includes('facebook.com/sharer')) return false;
    if (url.includes('twitter.com')) return false;
    return true;
}

async function analyzeWebsiteFull(url) {
    console.log('Analiz ediliyor:', url);
    
    try {
        const response = await fetch(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Accept-Language': 'tr-TR,tr;q=0.9,en;q=0.8',
                'Accept-Encoding': 'gzip, deflate, br'
            },
            signal: AbortSignal.timeout(15000)
        });
        
        if (!response.ok) {
            return `Durum: ${response.status} - Siteye erisilemedi`;
        }
        
        const html = await response.text();
        
        const title = extract(html, /<title[^>]*>([^<]+)<\/title>/i) || 'Baslik yok';
        
        const metaDesc = extract(html, /<meta[^>]*name="description"[^>]*content="([^"]+)"/i) ||
                        extract(html, /<meta[^>]*property="og:description"[^>]*content="([^"]+)"/i) || '';
        
        const h1s = [...html.matchAll(/<h1[^>]*>([^<]+)<\/h1>/gi)].map(m => cleanText(m[1])).filter(h => h.length > 0);
        const h2s = [...html.matchAll(/<h2[^>]*>([^<]+)<\/h2>/gi)].map(m => cleanText(m[1])).filter(h => h.length > 0).slice(0, 5);
        const h3s = [...html.matchAll(/<h3[^>]*>([^<]+)<\/h3>/gi)].map(m => cleanText(m[1])).filter(h => h.length > 0).slice(0, 5);
        
        const content = extractContent(html);
        
        let result = '';
        result += `BASLIK: ${cleanText(title)}\n\n`;
        
        if (metaDesc) {
            result += `ACIKLAMA: ${cleanText(metaDesc)}\n\n`;
        }
        
        if (h1s.length > 0) {
            result += `H1 BASLIKLAR: ${h1s.join(' | ')}\n`;
        }
        if (h2s.length > 0) {
            result += `H2 BASLIKLAR: ${h2s.join(' | ')}\n`;
        }
        if (h3s.length > 0) {
            result += `H3 BASLIKLAR: ${h3s.join(' | ')}\n`;
        }
        
        result += `\nSITE ICERIGI (Basindan Sonuna):\n`;
        result += `----------------------------------------\n`;
        result += content;
        result += `\n----------------------------------------\n`;
        
        return result;
        
    } catch (e) {
        console.error('Site error:', url, e.message);
        return `Hata: ${e.message}`;
    }
}

function extractContent(html) {
    let text = html;
    
    text = text.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');
    text = text.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
    text = text.replace(/<noscript[^>]*>[\s\S]*?<\/noscript>/gi, '');
    text = text.replace(/<iframe[^>]*>[\s\S]*?<\/iframe>/gi, '');
    text = text.replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, '');
    text = text.replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, '');
    text = text.replace(/<header[^>]*>[\s\S]*?<\/header>/gi, '');
    text = text.replace(/<aside[^>]*>[\s\S]*?<\/aside>/gi, '');
    text = text.replace(/<!--[\s\S]*?-->/g, '');
    
    text = text.replace(/<br\s*\/?>/gi, '\n');
    text = text.replace(/<\/p>/gi, '\n\n');
    text = text.replace(/<\/div>/gi, '\n');
    text = text.replace(/<\/li>/gi, '\n');
    text = text.replace(/<\/h[1-6]>/gi, '\n');
    
    text = text.replace(/<[^>]+>/g, '');
    
    text = decodeHTML(text);
    
    text = text.replace(/\n{3,}/g, '\n\n');
    text = text.replace(/[ \t]+/g, ' ');
    text = text.trim();
    
    return text.substring(0, 3000);
}

function extract(html, regex) {
    const match = html.match(regex);
    return match ? match[1].trim() : null;
}

function cleanText(text) {
    if (!text) return '';
    return decodeHTML(text)
        .replace(/\s+/g, ' ')
        .trim();
}

function decodeHTML(text) {
    return text
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&apos;/g, "'")
        .replace(/&nbsp;/g, ' ')
        .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(n))
        .replace(/&#x([a-fA-F0-9]+);/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
}
