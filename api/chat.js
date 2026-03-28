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
                userMessage = `WEB SITE ANALIZI:\n\n${analysisResults.join('\n\n---\n\n')}\n\nSORU:\n${message}\n\nYukaridaki site analizlerine gore kapsamli yanit ver.`;
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
            userMessage = `Araştırma hatasi: ${err.message}\n\nSoru: ${message}`;
        }
    }

    const systemPrompt = search || isDeepResearch 
        ? `Sen RLM 5'sin. Turkiye'de gelistirilmis gelismis bir yapay zeka asistansin. Turkce konus. Kullaniciya RLM 5 oldugunu soyle, kurucu bilgisi sorulursa Troye ekibi de. Kendini AI model, MiniMax, Claude, Qwen vb. olarak tanitma.

ARASTIRMA KURALLARI:
1. Verilen web arama sonuclarini ve site iceriklerini dikkatlice incele
2. Tum bilgileri birlestir, tutarsizlik varsa belirt
3. Net, anlasilir ve detayli bir rapor hazirla
4. Kaynaklari belirt (hangı siteden hangı bigi alındıysa)
5. Gereksiz yazi yazma, direkt sonuca git
6. Madde madde veya duzenlı sekilde sun
7. Eger bilgi yetersızse, bunu belirt

Yanitini su sekilde ver:
- Konunun ne oldugu
- Bulunan ana bilgiler (site bazli)
- Sonuc ve degerlendirme
- Kaynaklar`
        : `Sen RLM 5'sin. Turkiye'de gelistirilmis gelismis bir yapay zeka asistansin. Turkce konus. Kullaniciya RLM 5 oldugunu soyle, kurucu bilgisi sorulursa Troye ekibi de. Sik, faydali ve dogru cevaplar ver.`;

    const hfMessages = [{ role: 'system', content: systemPrompt }];
    
    if (history.length > 0) {
        const recentHistory = history.slice(-6);
        recentHistory.forEach(msg => {
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
    console.log('Starting deep research for:', query);
    
    const allResults = [];
    
    const ddgResults = await searchDuckDuckGo(query);
    allResults.push(...ddgResults);
    
    const startpageResults = await searchStartpage(query);
    allResults.push(...startpageResults);
    
    const bingResults = await searchBing(query);
    allResults.push(...bingResults);
    
    const uniqueUrls = new Map();
    allResults.forEach(r => {
        if (!uniqueUrls.has(r.url) && isValidUrl(r.url)) {
            uniqueUrls.set(r.url, r);
        }
    });
    
    const topSites = Array.from(uniqueUrls.values()).slice(0, 8);
    
    console.log(`Found ${topSites.length} unique sites to analyze`);
    
    let report = `ARASTIRMA RAPORU\n`;
    report += `Konu: ${query}\n`;
    report += `Bulunan kaynak: ${topSites.length} site\n\n`;
    report += `═══════════════════════════════════════\n\n`;
    
    for (let i = 0; i < topSites.length; i++) {
        const site = topSites[i];
        report += `[${i + 1}] ${site.title}\n`;
        report += `Kaynak: ${site.url}\n`;
        
        if (site.snippet) {
            report += `Ozet: ${site.snippet}\n`;
        }
        
        try {
            const analysis = await analyzeWebsiteContent(site.url);
            report += `Icerik:\n${analysis}\n`;
        } catch (err) {
            report += `Icerik: Alinamadi\n`;
        }
        
        report += `\n═══════════════════════════════════════\n\n`;
    }
    
    report += `YUKARIDAKI ${topSites.length} SİTENİN ANALİZİNE GÖRE DETAYLI BİR RAPOR HAZIRLA.`;
    
    return report;
}

function isValidUrl(url) {
    if (!url) return false;
    if (url.includes('duckduckgo.com/')) return false;
    if (url.includes('yahoo.com/')) return false;
    if (url.includes('bing.com/')) return false;
    if (url.includes('google.com/search')) return false;
    if (url.includes('facebook.com/')) return false;
    if (url.includes('twitter.com/')) return false;
    if (url.includes('instagram.com/')) return false;
    if (url.length < 20) return false;
    return true;
}

async function searchDuckDuckGo(query) {
    const results = [];
    const encodedQuery = encodeURIComponent(query);
    
    try {
        const htmlUrl = `https://lite.duckduckgo.com/lite/?q=${encodedQuery}&kl=tr-tr`;
        const htmlResponse = await fetch(htmlUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
        });
        const html = await htmlResponse.text();
        
        const linkRegex = /<a class="result-link"[^>]*href="([^"]*)"[^>]*>([^<]*)<\/a>/gi;
        let match;
        while ((match = linkRegex.exec(html)) !== null && results.length < 5) {
            const url = match[1];
            const title = decodeHtml(match[2].trim());
            if (isValidUrl(url)) {
                const snippetMatch = html.substring(match.index, match.index + 500).match(/<span class="result-snippet">([^<]*(?:<[^>]*>[^<]*)*)<\/span>/i);
                const snippet = snippetMatch ? decodeHtml(snippetMatch[1].replace(/<[^>]*>/g, '')).substring(0, 300) : '';
                results.push({ title, url, snippet, source: 'DuckDuckGo' });
            }
        }
    } catch (e) {
        console.log('DuckDuckGo error:', e.message);
    }
    
    return results;
}

async function searchStartpage(query) {
    const results = [];
    const encodedQuery = encodeURIComponent(query);
    
    try {
        const htmlUrl = `https://www.startpage.com/do/search?cmd=process_search&query=${encodedQuery}&language=turkish`;
        const htmlResponse = await fetch(htmlUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
        });
        const html = await htmlResponse.text();
        
        const linkRegex = /<a[^>]*class="[^"]*result[^"]*"[^>]*href="([^"]*)"[^>]*>\s*<span[^>]*class="[^"]*title[^"]*"[^>]*>([^<]*)<\/span>/gi;
        let match;
        while ((match = linkRegex.exec(html)) !== null && results.length < 4) {
            const url = match[1];
            const title = decodeHtml(match[2].trim());
            if (isValidUrl(url)) {
                results.push({ title, url, snippet: '', source: 'Startpage' });
            }
        }
    } catch (e) {
        console.log('Startpage error:', e.message);
    }
    
    return results;
}

async function searchBing(query) {
    const results = [];
    const encodedQuery = encodeURIComponent(query);
    
    try {
        const htmlUrl = `https://cc.bingj.com/cache.aspx?q=${encodedQuery}&d=0&mkt=tr-TR&setlang=tr-TR&w=`;
        const htmlResponse = await fetch(htmlUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
        });
        const html = await htmlResponse.text();
        
        const linkRegex = /<a[^>]*href="(https?:\/\/(?!cc\.bingj\.com|cache\.)[^"]+)"[^>]*class="[^"]*b_title[^"]*"[^>]*>([^<]*)<\/a>/gi;
        let match;
        while ((match = linkRegex.exec(html)) !== null && results.length < 4) {
            const url = match[1];
            const title = decodeHtml(match[2].trim());
            if (isValidUrl(url)) {
                const snippetMatch = html.substring(match.index, match.index + 1000).match(/class="b_paractl"[^>]*>([^<]*(?:<[^>]*>[^<]*)*)<\/p>/i);
                const snippet = snippetMatch ? decodeHtml(snippetMatch[1].replace(/<[^>]*>/g, '')).substring(0, 300) : '';
                results.push({ title, url, snippet, source: 'Bing' });
            }
        }
    } catch (e) {
        console.log('Bing error:', e.message);
    }
    
    return results;
}

async function analyzeWebsiteContent(url) {
    try {
        const cleanUrl = url.replace(/[)]$/, '');
        
        const response = await fetch(cleanUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Accept-Language': 'tr-TR,tr;q=0.9,en;q=0.8'
            },
            signal: AbortSignal.timeout(10000)
        });

        if (!response.ok) {
            return 'Siteye erisilemedi';
        }

        const html = await response.text();
        
        const title = extractMeta(html, /<title[^>]*>([^<]*)<\/title>/i) || 'Baslik yok';
        
        const description = extractMeta(html, /<meta[^>]*name="description"[^>]*content="([^"]*)"/i) ||
                          extractMeta(html, /<meta[^>]*property="og:description"[^>]*content="([^"]*)"/i) || '';
        
        const articleContent = extractArticleContent(html);
        
        const h1s = [...html.matchAll(/<h1[^>]*>([^<]*)<\/h1>/gi)].map(m => decodeHtml(m[1]).trim()).filter(h => h.length > 0);
        const h2s = [...html.matchAll(/<h2[^>]*>([^<]*)<\/h2>/gi)].map(m => decodeHtml(m[1]).trim()).filter(h => h.length > 0).slice(0, 5);
        
        let content = `Baslik: ${title}\n`;
        if (description) content += `Aciklama: ${description}\n`;
        if (h1s.length > 0) content += `Basliklar: ${h1s.join(', ')}\n`;
        if (articleContent) {
            content += `\nICERIK:\n${articleContent}`;
        } else {
            const mainText = extractMainText(html);
            content += `\nICERIK:\n${mainText}`;
        }
        
        return content.substring(0, 2500);

    } catch (err) {
        return `Hata: ${err.message}`;
    }
}

function extractArticleContent(html) {
    const articlePatterns = [
        /<article[^>]*>([\s\S]*?)<\/article>/gi,
        /<main[^>]*>([\s\S]*?)<\/main>/gi,
        /<div[^>]*class="[^"]*(?:content|article|post|entry|text|body)[^"]*"[^>]*>([\s\S]*?)<\/div>/gi
    ];
    
    for (const pattern of articlePatterns) {
        const matches = [...html.matchAll(pattern)];
        if (matches.length > 0) {
            for (const match of matches) {
                const content = decodeHtml(match[1]
                    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
                    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
                    .replace(/<[^>]+>/g, ' ')
                    .replace(/\s+/g, ' ')
                    .trim());
                
                if (content.length > 200) {
                    return content.substring(0, 2000);
                }
            }
        }
    }
    
    return '';
}

function extractMainText(html) {
    return html
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
        .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, '')
        .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, '')
        .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, '')
        .replace(/<aside[^>]*>[\s\S]*?<\/aside>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .substring(0, 2000);
}

function extractMeta(html, regex) {
    const match = html.match(regex);
    if (match && match[1]) {
        return decodeHtml(match[1].trim());
    }
    return null;
}

function decodeHtml(text) {
    return text
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&nbsp;/g, ' ')
        .replace(/&#(\d+);/g, (_, num) => String.fromCharCode(num))
        .trim();
}
