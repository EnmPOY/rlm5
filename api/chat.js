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
        let report = 'KOD ANALIZI:\n\n';
        for (const url of urls.slice(0, 3)) {
            report += await analyzeWebsiteCode(url) + '\n\n';
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

async function analyzeWebsiteCode(url) {
    console.log('KOD ANALIZ:', url);
    
    let html = '';
    let bypassed = false;
    
    // YONTEM 1: Normal erisim
    try {
        const response = await fetch(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
                'Accept-Language': 'tr-TR,tr;q=0.9,en;q=0.8',
                'Accept-Encoding': 'gzip, deflate, br',
                'Cache-Control': 'no-cache',
                'Pragma': 'no-cache',
                'Sec-Ch-Ua': '"Chromium";v="123", "Not:A-Brand";v="99"',
                'Sec-Ch-Ua-Mobile': '?0',
                'Sec-Ch-Ua-Platform': '"Windows"',
                'Sec-Fetch-Dest': 'document',
                'Sec-Fetch-Mode': 'navigate',
                'Sec-Fetch-Site': 'none',
                'Sec-Fetch-User': '?1',
                'Upgrade-Insecure-Requests': '1'
            },
            signal: AbortSignal.timeout(10000)
        });
        
        if (response.ok) {
            html = await response.text();
            // Cloudflare sayfasi mi kontrol et
            if (!html.includes('<!DOCTYPE html') && !html.includes('<html')) {
                html = '';
            }
        }
    } catch (e) {
        console.log('Method 1 failed:', e.message);
    }
    
    // YONTEM 2: Google Cache
    if (!html || html.length < 500) {
        try {
            const cacheUrl = `https://webcache.googleusercontent.com/search?q=cache:${encodeURIComponent(url)}`;
            const response = await fetch(cacheUrl, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                    'Accept': 'text/html'
                },
                signal: AbortSignal.timeout(8000)
            });
            if (response.ok) {
                const cacheHtml = await response.text();
                if (cacheHtml.includes('<!DOCTYPE') || cacheHtml.includes('<html')) {
                    html = cacheHtml;
                    bypassed = true;
                }
            }
        } catch (e) {
            console.log('Google cache failed:', e.message);
        }
    }
    
    // YONTEM 3: Wayback Machine
    if (!html || html.length < 500) {
        try {
            const waybackUrl = `https://web.archive.org/web/${Date.now()}/${url}`;
            const response = await fetch(waybackUrl, {
                headers: {
                    'User-Agent': 'Mozilla/5.0'
                },
                signal: AbortSignal.timeout(8000)
            });
            if (response.ok) {
                const waybackHtml = await response.text();
                if (waybackHtml.includes('<!DOCTYPE') || waybackHtml.includes('<html')) {
                    html = waybackHtml;
                    bypassed = true;
                }
            }
        } catch (e) {
            console.log('Wayback failed:', e.message);
        }
    }
    
    // YONTEM 4: textise dot iitty (metin versiyonu)
    if (!html || html.length < 500) {
        try {
            const textiseUrl = `https://lite.textise dot iitty.com/?url=${encodeURIComponent(url)}`;
            const response = await fetch(textiseUrl.replace(' dot ', '.'), {
                headers: { 'User-Agent': 'Mozilla/5.0' },
                signal: AbortSignal.timeout(6000)
            });
            if (response.ok) {
                const textHtml = await response.text();
                if (textHtml.length > 200) {
                    html = `<html><body><pre>${textHtml}</pre></body></html>`;
                    bypassed = true;
                }
            }
        } catch (e) {
            console.log('Textise failed:', e.message);
        }
    }
    
    // YONTEM 5: textise dot ph
    if (!html || html.length < 500) {
        try {
            const textiseUrl = `https://textise dot ph/?url=${encodeURIComponent(url)}`;
            const response = await fetch(textiseUrl.replace(' dot ', '.'), {
                headers: { 'User-Agent': 'Mozilla/5.0' },
                signal: AbortSignal.timeout(6000)
            });
            if (response.ok) {
                const textHtml = await response.text();
                if (textHtml.length > 200) {
                    html = `<html><body><pre>${textHtml}</pre></body></html>`;
                    bypassed = true;
                }
            }
        } catch (e) {
            console.log('Textise.ph failed:', e.message);
        }
    }
    
    if (!html || html.length < 500) {
        return `CLOUDFLARE KORUMASI: Site korumaya alinmis, direkt erisilemiyor.\n\nYAPILAN DENEMELER:\n- Normal erisim\n- Google Cache\n- Wayback Machine\n\nSite: ${url}\n\nONERILER:\n1. Siteyi manuel tarayicida ac ve icerigi paylas\n2. Wayback Machine'dan bak: https://web.archive.org/web/*/${url.replace('https://', '')}\n3. Google Cache'den bak: https://webcache.googleusercontent.com/search?q=cache:${encodeURIComponent(url)}`;
    }
    
    let report = '';
    report += '═══════════════════════════════════════════\n';
    report += `SITE: ${url}\n`;
    if (bypassed) report += `(Cloudflare atlatildi - cache)\n`;
    report += '═══════════════════════════════════════════\n\n';
    
    // 1. HTML ANALIZI
    report += 'HTML YAPISI:\n';
    report += '───────────────────────────────────────────\n';
    
    const doctype = html.match(/<!DOCTYPE[^>]*>/i)?.[0] || 'Bulunamadi';
    const htmlVersion = html.match(/<html[^>]*>/i)?.[0] || '';
    const lang = html.match(/<html[^>]*lang="([^"]+)"/i)?.[1] || 
                 html.match(/<html[^>]*xml:lang="([^"]+)"/i)?.[1] || 'Belirtilmemis';
    const charset = html.match(/<meta[^>]*charset="([^"]+)"/i)?.[1] || 
                    html.match(/<meta[^>]*charset='([^']+)'/i)?.[1] || 'UTF-8';
    
    report += `Doctype: ${cleanHtml(doctype)}\n`;
    report += `Dil: ${lang}\n`;
    report += `Karakter: ${charset}\n`;
    
    // Heading analysis
    const h1s = [...html.matchAll(/<h1[^>]*>([^<]+)<\/h1>/gi)].map(m => cleanHtml(m[1]));
    const h2s = [...html.matchAll(/<h2[^>]*>([^<]+)<\/h2>/gi)].map(m => cleanHtml(m[1]));
    const h3s = [...html.matchAll(/<h3[^>]*>([^<]+)<\/h3>/gi)].map(m => cleanHtml(m[1]));
    const h4s = [...html.matchAll(/<h4[^>]*>([^<]+)<\/h4>/gi)].map(m => cleanHtml(m[1]));
    
    report += `\nBasliklar:\n`;
    report += `  H1 (${h1s.length}): ${h1s.slice(0, 3).join(', ') || 'Yok'}\n`;
    report += `  H2 (${h2s.length}): ${h2s.slice(0, 3).join(', ') || 'Yok'}\n`;
    report += `  H3 (${h3s.length}): ${h3s.slice(0, 3).join(', ') || 'Yok'}\n`;
        report += `  H4 (${h4s.length}): ${h4s.slice(0, 2).join(', ') || 'Yok'}\n`;
        
        // Semantic tags
        const hasHeader = /<header/i.test(html);
        const hasFooter = /<footer/i.test(html);
        const hasNav = /<nav/i.test(html);
        const hasMain = /<main/i.test(html);
        const hasArticle = /<article/i.test(html);
        const hasSection = /<section/i.test(html);
        const hasAside = /<aside/i.test(html);
        
        report += `\nSemantik Etiketler:\n`;
        report += `  ✅ <header>: ${hasHeader ? 'Var' : 'Yok'}\n`;
        report += `  ✅ <nav>: ${hasNav ? 'Var' : 'Yok'}\n`;
        report += `  ✅ <main>: ${hasMain ? 'Var' : 'Yok'}\n`;
        report += `  ✅ <article>: ${hasArticle ? 'Var' : 'Yok'}\n`;
        report += `  ✅ <section>: ${hasSection ? 'Var' : 'Yok'}\n`;
        report += `  ✅ <aside>: ${hasAside ? 'Var' : 'Yok'}\n`;
        report += `  ✅ <footer>: ${hasFooter ? 'Var' : 'Yok'}\n`;
        
        report += '\n';
        
        // 2. TEKNOLOJI ANALIZI
        report += '🛠️ TESPIT EDILEN TEKNOLOJILER:\n';
        report += '───────────────────────────────────────────\n';
        
        const techs = detectTechnologies(html);
        if (techs.length > 0) {
            report += techs.join('\n') + '\n';
        } else {
            report += 'Belirlenemedi (ozel kod veya minify edilmis)\n';
        }
        report += '\n';
        
        // 3. SEO ANALIZI
        report += '🔍 SEO ANALIZI:\n';
        report += '───────────────────────────────────────────\n';
        
        const title = html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1] || 'YOK';
        const metaDesc = html.match(/<meta[^>]*name="description"[^>]*content="([^"]+)"/i)?.[1] || 'YOK';
        const metaKeywords = html.match(/<meta[^>]*name="keywords"[^>]*content="([^"]+)"/i)?.[1] || 'YOK';
        const metaAuthor = html.match(/<meta[^>]*name="author"[^>]*content="([^"]+)"/i)?.[1] || 'YOK';
        const ogTitle = html.match(/<meta[^>]*property="og:title"[^>]*content="([^"]+)"/i)?.[1] || 'YOK';
        const ogDesc = html.match(/<meta[^>]*property="og:description"[^>]*content="([^"]+)"/i)?.[1] || 'YOK';
        const ogImage = html.match(/<meta[^>]*property="og:image"[^>]*content="([^"]+)"/i)?.[1] || 'YOK';
        const ogType = html.match(/<meta[^>]*property="og:type"[^>]*content="([^"]+)"/i)?.[1] || 'YOK';
        const canonical = html.match(/<link[^>]*rel="canonical"[^>]*href="([^"]+)"/i)?.[1] || 'YOK';
        const robots = html.match(/<meta[^>]*name="robots"[^>]*content="([^"]+)"/i)?.[1] || 'YOK';
        
        report += `Title: ${cleanHtml(title).substring(0, 60)}\n`;
        report += `Description: ${cleanHtml(metaDesc).substring(0, 80)}\n`;
        report += `Keywords: ${cleanHtml(metaKeywords).substring(0, 60)}\n`;
        report += `Author: ${cleanHtml(metaAuthor)}\n`;
        report += `Canonical: ${canonical.substring(0, 50)}\n`;
        report += `Robots: ${robots}\n`;
        report += `\nOpen Graph:\n`;
        report += `  Type: ${ogType}\n`;
        report += `  Title: ${cleanHtml(ogTitle).substring(0, 50)}\n`;
        report += `  Description: ${cleanHtml(ogDesc).substring(0, 50)}\n`;
        report += `  Image: ${ogImage ? 'Var' : 'Yok'}\n`;
        report += '\n';
        
        // 4. TASARIM ANALIZI
        report += '🎨 TASARIM & CSS ANALIZI:\n';
        report += '───────────────────────────────────────────\n';
        
        const cssFiles = [...html.matchAll(/<link[^>]*rel=["']stylesheet["'][^>]*href="([^"]+)"/gi)].map(m => m[1]);
        const inlineStyles = (html.match(/style="[^"]*"/gi) || []).length;
        const cssClasses = [...html.matchAll(/class="([^"]+)"/gi)].map(m => m[1].split(' ')).flat();
        const uniqueClasses = [...new Set(cssClasses)].filter(c => c.length > 1);
        
        report += `Harici CSS: ${cssFiles.length} adet\n`;
        if (cssFiles.length > 0) {
            cssFiles.slice(0, 3).forEach(css => {
                report += `  - ${css.substring(0, 60)}\n`;
            });
        }
        
        report += `Inline Style: ${inlineStyles} adet\n`;
        report += `Kullanilan CSS Class: ${uniqueClasses.length} adet\n`;
        
        // Detect CSS framework
        const cssFramework = detectCssFramework(html);
        if (cssFramework) {
            report += `CSS Framework: ${cssFramework}\n`;
        }
        
        // Extract colors
        const colors = extractColors(html);
        if (colors.length > 0) {
            report += `Tespit Edilen Renkler: ${colors.slice(0, 5).join(', ')}\n`;
        }
        
        report += '\n';
        
        // 5. JAVASCRIPT ANALIZI
        report += '⚡ JAVASCRIPT ANALIZI:\n';
        report += '───────────────────────────────────────────\n';
        
        const jsFiles = [...html.matchAll(/<script[^>]*src="([^"]+)"[^>]*>/gi)].map(m => m[1]);
        const inlineScripts = (html.match(/<script(?![^>]*src)[^>]*>/gi) || []).length;
        const jsLibs = detectJsLibraries(html);
        
        report += `Harici JS Dosyasi: ${jsFiles.length} adet\n`;
        if (jsFiles.length > 0) {
            jsFiles.slice(0, 3).forEach(js => {
                report += `  - ${js.substring(0, 60)}\n`;
            });
        }
        report += `Inline Script: ${inlineScripts} adet\n`;
        
        if (jsLibs.length > 0) {
            report += `JS Kutuphaneleri:\n`;
            jsLibs.forEach(lib => report += `  - ${lib}\n`);
        }
        
        report += '\n';
        
        // 6. IÇERIK ANALIZI
        report += '📝 IÇERIK ANALIZI:\n';
        report += '───────────────────────────────────────────\n';
        
        const images = (html.match(/<img[^>]+>/gi) || []).length;
        const links = (html.match(/<a[^>]+href=["'][^"']+["'][^>]*>/gi) || []).length;
        const forms = (html.match(/<form[^>]*>/gi) || []).length;
        const inputs = (html.match(/<input/gi) || []).length;
        const buttons = (html.match(/<button/gi) || []).length;
        const videos = (html.match(/<video/gi) || []).length;
        const iframes = (html.match(/<iframe/gi) || []).length;
        
        report += `Gorseller: ${images}\n`;
        report += `Linkler: ${links}\n`;
        report += `Formlar: ${forms}\n`;
        report += `Inputlar: ${inputs}\n`;
        report += `Butonlar: ${buttons}\n`;
        report += `Videolar: ${videos}\n`;
        report += `Iframe: ${iframes}\n`;
        
        // Extract page text
        const textContent = html
            .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
            .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
            .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, '')
            .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, '')
            .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, '')
            .replace(/<[^>]+>/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
        
        const wordCount = textContent.split(/\s+/).length;
        report += `Kelime Sayisi: ~${wordCount}\n`;
        report += `Karakter Sayisi: ${textContent.length}\n`;
        
        report += '\n';
        
        // 7. SCRIPT ÖZETI
        report += '📋 SAYFA ÖZETI:\n';
        report += '───────────────────────────────────────────\n';
        report += `Baslik: ${cleanHtml(title)}\n`;
        report += `Site Turu: ${detectSiteType(title, metaDesc, h1s)}\n`;
        
        report += '\n';
        
        // 8. SORUNLAR VE ONERILER
        report += '⚠️ KOD KALITE & ONERILER:\n';
        report += '───────────────────────────────────────────\n';
        
        const issues = [];
        
        if (!hasMain) issues.push('❌ <main> etiketi yok - Erişilebilirlik için eklennmeli');
        if (!hasNav) issues.push('⚠️ <nav> etiketi yok - Navigasyon belirtilmemis');
        if (h1s.length === 0) issues.push('❌ H1 basligi yok - SEO icin onemli');
        if (h1s.length > 1) issues.push('⚠️ Birden fazla H1 var - Sadece 1 tane olmali');
        if (metaDesc.length < 50) issues.push('⚠️ Meta description cok kisa');
        if (title.length < 30) issues.push('⚠️ Title cok kisa');
        if (!ogTitle) issues.push('⚠️ Open Graph title yok - Sosyal paylasim icin eklennmeli');
        if (!ogImage) issues.push('⚠️ Open Graph image yok - Sosyal paylasim icin eklennmeli');
        if (inlineScripts > 3) issues.push('⚠️ Fazla inline script var - Harici dosyaya tasinmali');
        if (inlineStyles > 5) issues.push('⚠️ Fazla inline style var - CSS dosyasina tasinmali');
        
        if (issues.length > 0) {
            report += issues.join('\n') + '\n';
        } else {
            report += '✅ Kod kalitesi iyi gorunuyor\n';
        }
        
        report += '\n';
        
        // 9. BULUNAN ANAHTAR KELIMELER VE KONU
        report += '🔑 SITE KONUSU:\n';
        report += '───────────────────────────────────────────\n';
        
        const keywords = extractKeywords(html, title, metaDesc, h1s, h2s);
        report += `Anahtar Kelimeler: ${keywords.join(', ')}\n`;
        report += `Site Amaci: ${detectPurpose(metaDesc, textContent, h1s)}\n`;
        
        return report;
        
    } catch (e) {
        console.error('Code analysis error:', url, e.message);
        return `HATA: ${e.message}\nURL: ${url}`;
    }
}

function detectTechnologies(html) {
    const techs = [];
    const lowerHtml = html.toLowerCase();
    
    const patterns = [
        // Frameworks
        { name: 'React', pattern: /react[\.\-]|reactdom|reactjs|create-react-app/ },
        { name: 'Next.js', pattern: /_next\/|next\.js|nextjs/ },
        { name: 'Vue.js', pattern: /vue\.js|vuejs|vue-router|nuxt\.js/ },
        { name: 'Nuxt.js', pattern: /nuxt\.js|__nuxt/ },
        { name: 'Angular', pattern: /angular|ng-version|x-ng/ },
        { name: 'Svelte', pattern: /svelte/ },
        { name: 'Solid.js', pattern: /solid-js|solidjs/ },
        { name: 'Remix', pattern: /remix-run/ },
        
        // CSS Frameworks
        { name: 'Tailwind CSS', pattern: /tailwindcss|tailwind\.css|class="[^"]*grid|class="[^"]*flex/ },
        { name: 'Bootstrap', pattern: /bootstrap[\.\/-]|bootstrap/ },
        { name: 'Foundation', pattern: /foundation\.css|foundation\.js/ },
        { name: 'Materialize', pattern: /materialize\.css|materialize\.js/ },
        { name: 'Bulma', pattern: /bulma\.css/ },
        { name: 'Semantic UI', pattern: /semantic\.ui|semantic-ui/ },
        { name: 'UIKit', pattern: /uikit[\.\/-]/ },
        
        // JS Libraries
        { name: 'jQuery', pattern: /jquery[\.\-]|jquery-/ },
        { name: 'Lodash', pattern: /lodash\.|_\.|\.lodash/ },
        { name: 'Axios', pattern: /axios\/|axios\./ },
        { name: 'Moment.js', pattern: /moment\.js|moment\(|\.moment/ },
        { name: 'Chart.js', pattern: /chart\.js|chartjs/ },
        { name: 'Three.js', pattern: /three\.js|threejs/ },
        { name: 'D3.js', pattern: /d3\.js|d3js/ },
        { name: 'GSAP', pattern: /gsap\.|greensock/ },
        { name: 'Velocity.js', pattern: /velocity\.|velocityjs/ },
        { name: 'Anime.js', pattern: /anime\.js|animejs/ },
        
        // Build Tools
        { name: 'Webpack', pattern: /webpack/ },
        { name: 'Vite', pattern: /vite|vite\.js/ },
        { name: 'Parcel', pattern: /parcel/ },
        { name: 'Rollup', pattern: /rollup/ },
        { name: 'Gulp', pattern: /gulpfile/ },
        { name: 'Grunt', pattern: /gruntfile/ },
        
        // CMS
        { name: 'WordPress', pattern: /wp-content|wp-includes|wordpress|wp-json/ },
        { name: 'Shopify', pattern: /shopify|shopify-content|my-shopify/ },
        { name: 'Wix', pattern: /wix\.com|wixsite|_wix_/ },
        { name: 'Squarespace', pattern: /squarespace/ },
        { name: 'Webflow', pattern: /webflow\.io|wf-.{10}/ },
        { name: 'Ghost', pattern: /ghost|ghost\.org/ },
        { name: 'Strapi', pattern: /strapi/ },
        { name: 'Contentful', pattern: /contentful|ctfl\.io/ },
        
        // E-commerce
        { name: 'WooCommerce', pattern: /woocommerce|woo-|wc-api/ },
        { name: 'Magento', pattern: /mage-|\.magento/ },
        { name: 'PrestaShop', pattern: /prestashop|prestashop-/ },
        { name: 'OpenCart', pattern: /opencart|route=/ },
        
        // Analytics & Tracking
        { name: 'Google Analytics', pattern: /google-analytics|analytics\.js|ga\(|__gaTracker|gtag/ },
        { name: 'Google Tag Manager', pattern: /googletagmanager|gtm\.|GTM-/ },
        { name: 'Facebook Pixel', pattern: /facebook\.com.*fbevents|fbq\(|connect\.facebook/ },
        { name: 'Hotjar', pattern: /hotjar|hj\.|hotjar\.com/ },
        { name: 'Mixpanel', pattern: /mixpanel|mixpanel\.com/ },
        { name: 'Segment', pattern: /segment\.com|segment\.io|analytics\.js/ },
        
        // CDNs
        { name: 'Cloudflare', pattern: /cloudflare|_cf_|__cf_/ },
        { name: 'AWS CloudFront', pattern: /cloudfront|cloudfront\.net/ },
        { name: 'jsDelivr', pattern: /jsdelivr|cdn\.jsdelivr/ },
        { name: 'unpkg', pattern: /unpkg\.com/ },
        { name: 'cdnjs', pattern: /cdnjs\.cloudflare|cdnjs\.com/ },
        
        // Fonts
        { name: 'Google Fonts', pattern: /fonts\.googleapis|fonts\.gstatic/ },
        { name: 'Font Awesome', pattern: /font-awesome|fa-|fas |far |fab |fontawesome/ },
        { name: 'Icon Font', pattern: /iconfont|glyphicon|entypo/ },
        
        // Payment
        { name: 'Stripe', pattern: /stripe\.com|js\.stripe|stripe-js/ },
        { name: 'PayPal', pattern: /paypal|paypal\.com.*checkout/ },
        { name: 'Braintree', pattern: /braintree|braintree-/ },
        
        // Other Services
        { name: 'Intercom', pattern: /intercom|ic-widget|intercom-messenger/ },
        { name: 'Zendesk', pattern: /zendesk|zendesk_api|zd-api/ },
        { name: 'Disqus', pattern: /disqus|disqus_config|disqus_shortname/ },
        { name: 'HubSpot', pattern: /hubspot|hs-script|hubspotforms/ },
        { name: 'Mailchimp', pattern: /mailchimp|list-manage|mc-.{10}/ },
        { name: 'Cookiebot', pattern: /cookiebot|consent\.cookiebot/ },
        { name: 'OneTrust', pattern: /onetrust|otbanner/ },
        { name: 'Trustpilot', pattern: /trustpilot|trustpilot-widget/ },
        
        // Security
        { name: 'reCAPTCHA', pattern: /recaptcha|google.*recaptcha|grecaptcha/ },
        { name: 'hCaptcha', pattern: /hcaptcha|captcha/ },
        { name: 'Akamai', pattern: /akamai|akamaized/ },
        { name: 'Sucuri', pattern: /sucuri|sucuri-scanner/ },
        
        // API/Backend
        { name: 'REST API', pattern: /\/api\/|\/v\d+\/|api\.|graphql/ },
        { name: 'Firebase', pattern: /firebase|firebaseapp|firestore/ },
        { name: 'Supabase', pattern: /supabase/ },
        { name: 'Auth0', pattern: /auth0|auth0\.com/ },
        { name: 'JWT', pattern: /jwt|json.?web.?token| bearer /i },
        
        // Hosting
        { name: 'Vercel', pattern: /vercel|now\.sh|_vercel/ },
        { name: 'Netlify', pattern: /netlify|netlify\.app|_redirects/ },
        { name: 'Heroku', pattern: /heroku|herokuapp/ },
        { name: 'DigitalOcean', pattern: /digitalocean|digitalocean\.com/ },
        { name: 'AWS', pattern: /aws\.amazon|s3\.amazonaws|ec2\./ },
        { name: 'Firebase Hosting', pattern: /firebaseapp|web\.app/ },
    ];
    
    patterns.forEach(({ name, pattern }) => {
        if (pattern.test(lowerHtml)) {
            techs.push(name);
        }
    });
    
    return [...new Set(techs)].slice(0, 15);
}

function detectCssFramework(html) {
    const lower = html.toLowerCase();
    
    if (/<link[^>]*tailwindcss/i.test(lower) || /tailwind\.config/i.test(lower)) return 'Tailwind CSS';
    if (/<link[^>]*bootstrap/i.test(lower)) return 'Bootstrap';
    if (/<link[^>]*foundation/i.test(lower)) return 'Foundation';
    if (/<link[^>]*materialize/i.test(lower)) return 'Materialize CSS';
    if (/<link[^>]*bulma/i.test(lower)) return 'Bulma';
    if (/<link[^>]*semantic/i.test(lower)) return 'Semantic UI';
    if (/<link[^>]*uikit/i.test(lower)) return 'UIKit';
    
    return null;
}

function detectJsLibraries(html) {
    const libs = [];
    const lower = html.toLowerCase();
    
    if (/jquery[\.\-]|\.jquery/i.test(lower)) libs.push('jQuery');
    if (/axios\./i.test(lower)) libs.push('Axios');
    if (/gsap\.|greensock/i.test(lower)) libs.push('GSAP');
    if (/anime\.js/i.test(lower)) libs.push('Anime.js');
    if (/chart\.js/i.test(lower)) libs.push('Chart.js');
    if (/three\.js/i.test(lower)) libs.push('Three.js');
    if (/lodash[\.\-_]/i.test(lower)) libs.push('Lodash');
    if (/moment\.js/i.test(lower)) libs.push('Moment.js');
    if (/swiper\.|swiperjs/i.test(lower)) libs.push('Swiper.js');
    if (/slick-carousel|slick-slider/i.test(lower)) libs.push('Slick Carousel');
    if (/owl\.carousel|owlcarousel/i.test(lower)) libs.push('Owl Carousel');
    if (/datatables|dtable/i.test(lower)) libs.push('DataTables');
    if (/flatpickr/i.test(lower)) libs.push('Flatpickr');
    if (/intl-tel-input/i.test(lower)) libs.push('Intl Tel Input');
    if (/select2/i.test(lower)) libs.push('Select2');
    if (/toastr|toast\.js/i.test(lower)) libs.push('Toastr');
    if (/sweetalert|sweetalert2/i.test(lower)) libs.push('SweetAlert');
    
    return libs;
}

function extractColors(html) {
    const colors = [];
    const colorRegex = /#[a-f0-9]{3,8}|rgb\([^)]+\)|rgba\([^)]+\)/gi;
    const matches = html.match(colorRegex) || [];
    
    [...new Set(matches)].forEach(color => {
        if (color.length <= 9 && !colors.includes(color.toLowerCase())) {
            colors.push(color.toLowerCase());
        }
    });
    
    return colors;
}

function detectSiteType(title, metaDesc, h1s) {
    const text = `${title} ${metaDesc} ${h1s.join(' ')}`.toLowerCase();
    
    if (text.includes('shop') || text.includes('magaza') || text.includes('satici') || text.includes('urun')) return 'E-ticaret / Magaza';
    if (text.includes('blog') || text.includes('yazi') || text.includes('makale')) return 'Blog';
    if (text.includes('haber') || text.includes('news') || text.includes('gazete')) return 'Haber Sitesi';
    if (text.includes('forum') || text.includes('topluluk') || text.includes('destek')) return 'Forum / Topluluk';
    if (text.includes('egitim') || text.includes('kurs') || text.includes('okul') || text.includes('universite')) return 'Egitim / Kurs';
    if (text.includes('saglik') || text.includes('hastane') || text.includes('doktor') || text.includes('medical')) return 'Saglik';
    if (text.includes('oyun') || text.includes('game') || text.includes('play')) return 'Oyun';
    if (text.includes('video') || text.includes('film') || text.includes('dizi') || text.includes('youtube')) return 'Video / Medya';
    if (text.includes('muzik') || text.includes('music') || text.includes('sarki') || text.includes('spotify')) return 'Muzik';
    if (text.includes('hava') || text.includes('weather')) return 'Hava Durumu';
    if (text.includes('finans') || text.includes('doviz') || text.includes('borsa') || text.includes('banka')) return 'Finans / Banka';
    if (text.includes('sirket') || text.includes('kurumsal') || text.includes('hakkimizda')) return 'Kurumsal / Sirket';
    if (text.includes('portfolyo') || text.includes('galeri') || text.includes('fotograf')) return 'Portfolyo / Galeri';
    if (text.includes('proje') || text.includes('app') || text.includes('uygulama') || text.includes('web app')) return 'Web Uygulamasi';
    if (text.includes('dashboard') || text.includes('yonetim') || text.includes('admin')) return 'Yonetim Paneli';
    if (text.includes('landing') || text.includes('tanitim') || text.includes('promo')) return 'Landing Page';
    if (text.includes('login') || text.includes('giris') || text.includes('signin')) return 'Giris / Kimlik';
    
    return 'Genel Web Sitesi';
}

function extractKeywords(html, title, metaDesc, h1s, h2s) {
    const text = `${title} ${metaDesc} ${h1s.join(' ')} ${h2s.join(' ')}`.toLowerCase();
    
    const words = text.split(/\s+/)
        .filter(w => w.length > 4)
        .filter(w => !['https', 'http', 'www', 'com', 'org', 'html', 'style', 'script'].includes(w));
    
    const freq = {};
    words.forEach(w => {
        const clean = w.replace(/[^a-z0-9]/g, '');
        if (clean.length > 3) {
            freq[clean] = (freq[clean] || 0) + 1;
        }
    });
    
    const sorted = Object.entries(freq)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 8)
        .map(([word]) => word);
    
    return sorted;
}

function detectPurpose(metaDesc, textContent, h1s) {
    const text = `${metaDesc} ${h1s.join(' ')}`.toLowerCase();
    
    if (text.includes('sat') || text.includes('al') || text.includes('sepet') || text.includes('odeme')) return 'Urun/Donanim satisi';
    if (text.includes('hizmet') || text.includes('servis')) return 'Hizmet sunumu';
    if (text.includes('bilgi') || text.includes('rehber') || text.includes('kilavuz')) return 'Bilgi paylasimi';
    if (text.includes('destek') || text.includes('yardim') || text.includes('help')) return 'Musteri destegi';
    if (text.includes('abone') || text.includes('uyelik') || text.includes('kayit')) return 'Uyelik/Abone sistemi';
    if (text.includes('indir') || text.includes('download')) return 'Dosya/Indirme sitesi';
    if (text.includes('iletisim') || text.includes('contact')) return 'Iletisim/Info';
    
    return 'Genel amacli web sitesi';
}
