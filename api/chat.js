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
        let report = 'SITE ANALIZI:\n\n';
        for (const url of urls.slice(0, 3)) {
            report += await analyzeWebsiteFull(url) + '\n\n';
        }
        userMessage = report + '\nSORU: ' + message;
    } else if (search) {
        isDeepResearch = true;
        userMessage = await doDeepResearch(message);
    }

    const systemPrompt = isDeepResearch
        ? `Sen RLM 5'sin. Turkiye'de gelistirilmis gelismis bir yapay zeka asistansin. Turkce konus. Kullaniciya RLM 5 oldugunu soyle, kurucu bilgisi sorulursa Troye ekibi de.

ASAGIDA WEB'DEN TOPLANAN GERCEK VERILER VAR. BU VERILERI KULLANARAK YANIT VER.

Kurallar:
- Sadece verilen verileri kullan
- Yanitini site bazli ver
- Her kaynaktan alinan bilgiyi belirt
- Eger bilgi yoksa "bilgi yok" de
- Uzun ve detayli yanit ver
- Sonuclari duzenli sekilde goster`
        : `Sen RLM 5'sin. Turkiye'de gelistirilmis gelismis bir yapay zeka asistansin. Turkce konus. Kullaniciya RLM 5 oldugunu soyle, kurucu bilgisi sorulursa Troye ekibi de. Sik, faydali ve dogru cevaplar ver.`;

    const hfMessages = [{ role: 'system', content: systemPrompt }];
    
    if (history.length > 0) {
        history.slice(-4).forEach(msg => {
            hfMessages.push({ role: msg.role === 'user' ? 'user' : 'assistant', content: msg.content });
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
    console.log('DERIN ARASTIRMA:', query);
    
    let report = '';
    let sourceCount = 0;
    
    // 1. HABERLER (RSS)
    const newsResults = await searchNews(query);
    if (newsResults.length > 0) {
        report += '\n=== HABER KAYNAKLARI ===\n\n';
        for (const item of newsResults) {
            report += `[HABER] ${item.title}\nKaynak: ${item.source}\nTarih: ${item.date}\nIcerik: ${item.content}\nLink: ${item.link}\n\n`;
            sourceCount++;
        }
    }
    
    // 2. WEB ARAMASI
    const webResults = await searchWeb(query);
    if (webResults.length > 0) {
        report += '\n=== WEB ARAMA SON UCLARI ===\n\n';
        for (const item of webResults) {
            report += `[WEB] ${item.title}\nLink: ${item.url}\nAciklama: ${item.snippet}\n\n`;
            sourceCount++;
        }
    }
    
    // 3. HER SITEYI ZIYARET ET VE ICERIK AL
    report += '\n=== SITE ANALIZLERI ===\n\n';
    
    const sitesToVisit = [...webResults, ...newsResults.map(n => ({ url: n.link, title: n.title }))].slice(0, 6);
    const seen = new Set();
    
    for (const site of sitesToVisit) {
        if (seen.has(site.url)) continue;
        seen.add(site.url);
        
        if (!isGoodUrl(site.url)) continue;
        
        console.log('ZIYARET:', site.url);
        
        const content = await getPageContent(site.url);
        if (content && content.length > 100) {
            report += `[SITE] ${site.title}\nLink: ${site.url}\nIcerik:\n${content}\n\n`;
            sourceCount++;
        }
    }
    
    if (sourceCount === 0) {
        report += '\nSonuc bulunamadi. Farkli bir terimle aramayi deneyin.\n';
    }
    
    report += `\n=== ARASTIRMA TAMAMLANDI ===\n`;
    report += `Toplam kaynak: ${sourceCount}\n`;
    report += `Konu: ${query}\n`;
    report += `\nYukaridaki ${sourceCount} kaynaktan toplanan bilgilere dayanarak detayli bir rapor hazirla.\n`;
    
    return report;
}

async function searchNews(query) {
    const results = [];
    const encodedQuery = encodeURIComponent(query);
    
    // Google News RSS (en guvenilir)
    const rssUrls = [
        `https://news.google.com/rss/search?q=${encodedQuery}&hl=tr-TR&gl=TR&ceid=TR:tr`,
        `https://news.google.com/rss/search?q=${encodedQuery}&hl=tr&gl=TR&ceid=TR:tr`
    ];
    
    for (const rssUrl of rssUrls) {
        try {
            const response = await fetch(rssUrl, {
                headers: { 'User-Agent': 'Mozilla/5.0' },
                signal: AbortSignal.timeout(8000)
            });
            
            const text = await response.text();
            
            const items = text.match(/<item>([\s\S]*?)<\/item>/gi) || [];
            
            for (const item of items.slice(0, 5)) {
                const title = item.match(/<title><!\[CDATA\[([^\]]+)\]\]><\/title>/i)?.[1] || 
                             item.match(/<title>([^<]+)<\/title>/i)?.[1] || '';
                const link = item.match(/<link>([^<]+)<\/link>/i)?.[1] || '';
                const date = item.match(/<pubDate>([^<]+)<\/pubDate>/i)?.[1] || '';
                const desc = item.match(/<description><!\[CDATA\[([^\]]+)\]\]><\/description>/i)?.[1] || 
                            item.match(/<description>([^<]+)<\/description>/i)?.[1] || '';
                
                if (title && link) {
                    const cleanTitle = cleanHtml(title);
                    const cleanDesc = cleanHtml(desc).substring(0, 500);
                    const cleanDate = formatDate(date);
                    
                    results.push({
                        title: cleanTitle,
                        link: link,
                        source: 'Google News',
                        date: cleanDate,
                        content: cleanDesc
                    });
                }
            }
        } catch (e) {
            console.log('News RSS error:', e.message);
        }
        
        if (results.length >= 5) break;
    }
    
    // NTV RSS
    try {
        const response = await fetch(`https://www.ntv.com.tr/rss/${encodedQuery}`, {
            headers: { 'User-Agent': 'Mozilla/5.0' },
            signal: AbortSignal.timeout(5000)
        });
        // NTV doesn't support search param in URL, skip
    } catch (e) {}
    
    return results;
}

async function searchWeb(query) {
    const results = [];
    const encodedQuery = encodeURIComponent(query);
    
    try {
        const response = await fetch(`https://lite.duckduckgo.com/lite/?q=${encodedQuery}&kl=tr-tr`, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml',
                'Accept-Language': 'tr-TR,tr;q=0.9'
            },
            signal: AbortSignal.timeout(10000)
        });
        
        const html = await response.text();
        
        // Parse results
        const linkRegex = /<a\s+class="result-link"\s+href="([^"]+)"[^>]*>([^<]+)<\/a>/gi;
        const snippetRegex = /<span[^>]*class="result-snippet"[^>]*>([\s\S]*?)<\/span>/gi;
        
        let linkMatch;
        let snippetMatch;
        let snippetIndex = 0;
        
        while ((linkMatch = linkRegex.exec(html)) !== null && results.length < 8) {
            const url = linkMatch[1];
            const title = cleanHtml(linkMatch[2]);
            
            if (isGoodUrl(url)) {
                // Find corresponding snippet
                let snippet = '';
                const allSnippets = [...html.matchAll(snippetRegex)];
                if (allSnippets[snippetIndex]) {
                    snippet = cleanHtml(allSnippets[snippetIndex][1]).substring(0, 400);
                }
                snippetIndex++;
                
                results.push({
                    title: title,
                    url: url,
                    snippet: snippet
                });
            }
        }
        
        // If DDG fails, try alternative
        if (results.length === 0) {
            const altResults = html.match(/<a[^>]+href="(https?:\/\/(?!duckduckgo)[^"]+)"[^>]*>([^<]+)<\/a>/gi) || [];
            for (const match of altResults.slice(0, 5)) {
                const urlMatch = match.match(/href="([^"]+)"/);
                const titleMatch = match.match(/>([^<]+)<\/a>/);
                if (urlMatch && titleMatch && isGoodUrl(urlMatch[1])) {
                    results.push({
                        title: cleanHtml(titleMatch[1]),
                        url: urlMatch[1],
                        snippet: ''
                    });
                }
            }
        }
        
    } catch (e) {
        console.error('Web search error:', e.message);
    }
    
    return results;
}

async function getPageContent(url) {
    try {
        const response = await fetch(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Accept-Language': 'tr-TR,tr;q=0.9,en;q=0.8'
            },
            signal: AbortSignal.timeout(12000)
        });
        
        if (!response.ok) return '';
        
        const html = await response.text();
        
        // Extract title
        const title = html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1] || '';
        
        // Extract meta description
        const metaDesc = html.match(/<meta[^>]*name="description"[^>]*content="([^"]+)"/i)?.[1] || '';
        
        // Extract headings
        const h2s = [...html.matchAll(/<h2[^>]*>([^<]+)<\/h2>/gi)].map(m => cleanHtml(m[1])).slice(0, 4);
        const h3s = [...html.matchAll(/<h3[^>]*>([^<]+)<\/h3>/gi)].map(m => cleanHtml(m[1])).slice(0, 4);
        
        // Extract article/main content
        let content = '';
        
        // Try article tag first
        const articleMatch = html.match(/<article[^>]*>([\s\S]*?)<\/article>/i);
        if (articleMatch) {
            content = articleMatch[1];
        } else {
            // Try main tag
            const mainMatch = html.match(/<main[^>]*>([\s\S]*?)<\/main>/i);
            if (mainMatch) {
                content = mainMatch[1];
            } else {
                // Get body content
                const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
                content = bodyMatch ? bodyMatch[1] : html;
            }
        }
        
        // Clean content
        content = content
            .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
            .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
            .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, '')
            .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, '')
            .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, '')
            .replace(/<aside[^>]*>[\s\S]*?<\/aside>/gi, '')
            .replace(/<form[^>]*>[\s\S]*?<\/form>/gi, '')
            .replace(/<!--[\s\S]*?-->/g, '')
            .replace(/<br\s*\/?>/gi, '\n')
            .replace(/<\/p>/gi, '\n\n')
            .replace(/<\/div>/gi, '\n')
            .replace(/<[^>]+>/g, '')
            .replace(/\n{3,}/g, '\n\n')
            .trim();
        
        content = cleanHtml(content);
        
        // Build report
        let report = `Baslik: ${cleanHtml(title)}\n`;
        if (metaDesc) report += `Aciklama: ${cleanHtml(metaDesc)}\n`;
        if (h2s.length > 0) report += `Basliklar: ${h2s.join(' | ')}\n`;
        if (h3s.length > 0) report += `Alt Basliklar: ${h3s.join(' | ')}\n`;
        report += `\nIcerik:\n${content.substring(0, 2500)}`;
        
        return report;
        
    } catch (e) {
        console.error('Page fetch error:', url, e.message);
        return '';
    }
}

function isGoodUrl(url) {
    if (!url || url.length < 15) return false;
    if (url.includes('duckduckgo.com')) return false;
    if (url.includes('yahoo.com/')) return false;
    if (url.includes('bing.com/')) return false;
    if (url.includes('google.com/search')) return false;
    if (url.includes('google.com/url')) return false;
    if (url.includes('facebook.com/sharer')) return false;
    if (url.includes('twitter.com/intent')) return false;
    return true;
}

function cleanHtml(text) {
    if (!text) return '';
    return text
        .replace(/<!\[CDATA\[|\]\]>/g, '')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&apos;/g, "'")
        .replace(/&nbsp;/g, ' ')
        .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(n))
        .replace(/&#x([a-fA-F0-9]+);/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
        .replace(/\s+/g, ' ')
        .trim();
}

function formatDate(dateStr) {
    if (!dateStr) return '';
    try {
        const date = new Date(dateStr);
        return date.toLocaleDateString('tr-TR', { year: 'numeric', month: 'long', day: 'numeric' });
    } catch {
        return dateStr;
    }
}
