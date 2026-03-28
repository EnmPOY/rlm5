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
        let report = '';
        for (const url of urls.slice(0, 3)) {
            report += await analyzeWebsite(url) + '\n\n';
        }
        userMessage = report + '\nSORU: ' + message;
    } else if (search) {
        isDeepResearch = true;
        userMessage = await doDeepResearch(message);
    }

    const systemPrompt = isDeepResearch
        ? `Sen RLM 5'sin. Turkiye'nin en gelismis yapay zeka asistansin. Turkiye'de Troye ekibi tarafindan gelistirildin. Turkce konus.

ASAGIDA KAPSAMLI ARASHTIRMA SON UCLARI VAR. BU VERILERI DIKKATLICE INCLE VE EN IYI YANITI VER.

Kurallar:
1. Tum verileri birlestir
2. Kaynaklari belirt
3. Detayli ve anlasilir yanit ver
4. Bilgi yetersizse bunu belirt
5. Sonuclari duzenli goster`
        : `Sen RLM 5'sin. Turkiye'de gelistirilmis gelismis bir yapay zeka asistansin. Turkce konus. Kullaniciya RLM 5 oldugunu soyle, kurucu Troye ekibi. Sik, faydali ve dogru cevaplar ver.`;

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

// ==================== DERIN ARASTIRMA ====================

async function doDeepResearch(query) {
    console.log('DERIN ARASTIRMA BASLADI:', query);
    
    let report = '';
    let totalSources = 0;
    
    // 1. COKLU HABER KAYNAKLARI
    report += '\n=== GUNCEL HABERLER ===\n\n';
    const allNews = await getAllNews(query);
    for (const news of allNews) {
        report += `[HABER] ${news.title}\nKaynak: ${news.source} | Tarih: ${news.date}\n${news.content}\nLink: ${news.link}\n\n`;
        totalSources++;
    }
    
    // 2. COKLU ARAMA MOTORLARI
    report += '\n=== ARAMA MOTORU SON UCLARI ===\n\n';
    const allSearchResults = await multiSearch(query);
    for (const result of allSearchResults) {
        report += `[${result.engine}] ${result.title}\n${result.snippet}\nLink: ${result.url}\n\n`;
        totalSources++;
    }
    
    // 3. SITELERDEN ICERIK CEKME
    report += '\n=== SITELERDEN ALINAN ICERIKLER ===\n\n';
    
    const sitesToVisit = allSearchResults
        .concat(allNews.map(n => ({ url: n.link, title: n.title })))
        .slice(0, 10);
    
    const uniqueUrls = [];
    const seen = new Set();
    
    for (const site of sitesToVisit) {
        if (seen.has(site.url)) continue;
        if (!isValidUrl(site.url)) continue;
        seen.add(site.url);
        uniqueUrls.push(site);
    }
    
    for (let i = 0; i < uniqueUrls.length; i++) {
        const site = uniqueUrls[i];
        report += `--- Site ${i + 1}/${uniqueUrls.length}: ${site.title} ---\n`;
        report += `Link: ${site.url}\n`;
        
        const content = await getFullContent(site.url);
        if (content) {
            report += `Baslik: ${content.title}\n`;
            if (content.description) report += `Aciklama: ${content.description}\n`;
            if (content.headings.length > 0) report += `Basliklar: ${content.headings.join(' > ')}\n`;
            report += `Icerik:\n${content.text}\n`;
        } else {
            report += `Icerik: Alinamadi\n`;
        }
        report += '\n';
        totalSources++;
    }
    
    report += `\n=== ARASTIRMA OZETI ===\n`;
    report += `Toplam kaynak: ${totalSources}\n`;
    report += `Konu: ${query}\n`;
    report += `\nYukaridaki ${totalSources} kaynaktan toplanan bilgilerle detayli bir rapor hazirla.\n`;
    
    console.log('ARASTIRMA TAMAMLANDI, kaynak sayisi:', totalSources);
    return report;
}

// ==================== HABER KAYNAKLARI ====================

async function getAllNews(query) {
    const allNews = [];
    const encodedQuery = encodeURIComponent(query);
    
    // 1. Google News RSS
    try {
        const googleNews = await fetchGoogleNews(encodedQuery);
        allNews.push(...googleNews);
    } catch (e) { console.log('Google News hatasi:', e.message); }
    
    // 2. Bing News
    try {
        const bingNews = await fetchBingNews(encodedQuery);
        allNews.push(...bingNews);
    } catch (e) { console.log('Bing News hatasi:', e.message); }
    
    // 3. NewsAPI (yedege)
    try {
        const newsApiNews = await fetchNewsAPI(encodedQuery);
        allNews.push(...newsApiNews);
    } catch (e) { console.log('NewsAPI hatasi:', e.message); }
    
    // Tekrarlari engelle
    const unique = [];
    const seen = new Set();
    for (const n of allNews) {
        if (!seen.has(n.link)) {
            seen.add(n.link);
            unique.push(n);
        }
    }
    
    return unique.slice(0, 8);
}

async function fetchGoogleNews(query) {
    const results = [];
    const urls = [
        `https://news.google.com/rss/search?q=${query}&hl=tr-TR&gl=TR&ceid=TR:tr`,
        `https://news.google.com/rss/search?q=${query}&hl=tr&gl=TR&ceid=TR:tr`,
        `https://news.google.com/rss/search?q=${query}&hl=en-US&gl=US&ceid=US:en`
    ];
    
    for (const rssUrl of urls) {
        try {
            const response = await fetch(rssUrl, {
                headers: { 'User-Agent': 'Mozilla/5.0 (compatible)' },
                signal: AbortSignal.timeout(6000)
            });
            
            const text = await response.text();
            const items = text.match(/<item>([\s\S]*?)<\/item>/gi) || [];
            
            for (const item of items.slice(0, 4)) {
                const title = extractCDATA(item, 'title') || extractTag(item, 'title');
                const link = extractTag(item, 'link') || '';
                const date = extractTag(item, 'pubDate') || '';
                const desc = extractCDATA(item, 'description') || extractTag(item, 'description') || '';
                
                if (title && link) {
                    results.push({
                        title: cleanText(title),
                        link: link,
                        source: 'Google News',
                        date: formatDate(date),
                        content: cleanText(desc).substring(0, 600)
                    });
                }
            }
        } catch (e) {}
        
        if (results.length >= 5) break;
    }
    
    return results;
}

async function fetchBingNews(query) {
    const results = [];
    
    try {
        const response = await fetch(`https://cc.bingj.com/cache.aspx?q=${encodeURIComponent(query)}&d=0&mkt=tr-TR&setlang=tr-TR&w=`, {
            headers: { 'User-Agent': 'Mozilla/5.0' },
            signal: AbortSignal.timeout(6000)
        });
        
        const html = await response.text();
        
        const newsMatches = html.match(/<div[^>]*class="[^"]*news-[^"]*"[^>]*>[\s\S]*?<\/div>/gi) || [];
        
        for (const match of newsMatches.slice(0, 4)) {
            const titleMatch = match.match(/<a[^>]*href="([^"]+)"[^>]*>([^<]+)<\/a>/i);
            if (titleMatch) {
                results.push({
                    title: cleanText(titleMatch[2]),
                    link: titleMatch[1],
                    source: 'Bing News',
                    date: '',
                    content: 'Bing news sonucu'
                });
            }
        }
    } catch (e) {
        console.log('Bing news hatasi:', e.message);
    }
    
    return results;
}

async function fetchNewsAPI(query) {
    // NewsAPI.org ucretsiz plan - 1 gun gecikme olabilir
    const results = [];
    
    try {
        const response = await fetch(`https://newsapi.org/v2/everything?q=${query}&language=tr&sortBy=publishedAt&pageSize=5`, {
            headers: { 'User-Agent': 'Mozilla/5.0' },
            signal: AbortSignal.timeout(5000)
        });
        
        if (response.ok) {
            const data = await response.json();
            for (const article of (data.articles || []).slice(0, 4)) {
                results.push({
                    title: article.title,
                    link: article.url,
                    source: article.source?.name || 'NewsAPI',
                    date: formatDate(article.publishedAt),
                    content: (article.description || '') + ' ' + (article.content || '')
                });
            }
        }
    } catch (e) {
        console.log('NewsAPI hatasi:', e.message);
    }
    
    return results;
}

// ==================== COKLU ARAMA MOTORLARI ====================

async function multiSearch(query) {
    const allResults = [];
    
    // 1. DuckDuckGo Lite
    try {
        const ddgResults = await searchDuckDuckGo(query);
        allResults.push(...ddgResults);
    } catch (e) { console.log('DDG hatasi:', e.message); }
    
    // 2. Bing Cache
    try {
        const bingResults = await searchBing(query);
        allResults.push(...bingResults);
    } catch (e) { console.log('Bing hatasi:', e.message); }
    
    // 3. Startpage
    try {
        const startpageResults = await searchStartpage(query);
        allResults.push(...startpageResults);
    } catch (e) { console.log('Startpage hatasi:', e.message); }
    
    // 4. Yahoo
    try {
        const yahooResults = await searchYahoo(query);
        allResults.push(...yahooResults);
    } catch (e) { console.log('Yahoo hatasi:', e.message); }
    
    // Tekrarlari engelle
    const unique = [];
    const seen = new Set();
    for (const r of allResults) {
        if (!seen.has(r.url)) {
            seen.add(r.url);
            unique.push(r);
        }
    }
    
    return unique.slice(0, 12);
}

async function searchDuckDuckGo(query) {
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
        
        const linkRegex = /<a\s+class="result-link"\s+href="([^"]+)"[^>]*>([^<]+)<\/a>/gi;
        const snippetRegex = /<span[^>]*class="result-snippet"[^>]*>([\s\S]*?)<\/span>/gi;
        
        const links = [...html.matchAll(linkRegex)];
        const snippets = [...html.matchAll(snippetRegex)];
        
        for (let i = 0; i < Math.min(links.length, 10); i++) {
            const url = links[i][1];
            const title = cleanText(links[i][2]);
            
            if (isValidUrl(url)) {
                const snippet = snippets[i] ? cleanText(snippets[i][1]).substring(0, 300) : '';
                results.push({
                    engine: 'DuckDuckGo',
                    title,
                    url,
                    snippet
                });
            }
        }
    } catch (e) {
        console.log('DDG search hatasi:', e.message);
    }
    
    return results;
}

async function searchBing(query) {
    const results = [];
    const encodedQuery = encodeURIComponent(query);
    
    try {
        const response = await fetch(`https://cc.bingj.com/cache.aspx?q=${encodedQuery}&d=0&mkt=tr-TR&setlang=tr-TR`, {
            headers: { 'User-Agent': 'Mozilla/5.0' },
            signal: AbortSignal.timeout(8000)
        });
        
        const html = await response.text();
        
        const linkRegex = /<a[^>]*class="[^"]*b_title[^"]*"[^>]*href="([^"]+)"[^>]*>([^<]+)<\/a>/gi;
        const snippetRegex = /<p[^>]*class="[^"]*b_paractl[^"]*"[^>]*>([\s\S]*?)<\/p>/gi;
        
        const links = [...html.matchAll(linkRegex)];
        const snippets = [...html.matchAll(snippetRegex)];
        
        for (let i = 0; i < Math.min(links.length, 6); i++) {
            const url = links[i][1];
            const title = cleanText(links[i][2]);
            
            if (isValidUrl(url)) {
                const snippet = snippets[i] ? cleanText(snippets[i][1]).substring(0, 300) : '';
                results.push({
                    engine: 'Bing',
                    title,
                    url,
                    snippet
                });
            }
        }
    } catch (e) {
        console.log('Bing search hatasi:', e.message);
    }
    
    return results;
}

async function searchStartpage(query) {
    const results = [];
    const encodedQuery = encodeURIComponent(query);
    
    try {
        const response = await fetch(`https://www.startpage.com/do/search?cmd=process_search&query=${encodedQuery}&language=turkish&cat=web`, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Accept': 'text/html'
            },
            signal: AbortSignal.timeout(8000)
        });
        
        const html = await response.text();
        
        const linkRegex = /<a[^>]*href="(https?:\/\/(?!startpage)[^"]+)"[^>]*class="[^"]*result[^"]*"[^>]*>\s*<span[^>]*class="title"[^>]*>([^<]+)<\/span>/gi;
        
        let match;
        while ((match = linkRegex.exec(html)) !== null && results.length < 5) {
            const url = match[1];
            const title = cleanText(match[2]);
            
            if (isValidUrl(url)) {
                results.push({
                    engine: 'Startpage',
                    title,
                    url,
                    snippet: ''
                });
            }
        }
    } catch (e) {
        console.log('Startpage hatasi:', e.message);
    }
    
    return results;
}

async function searchYahoo(query) {
    const results = [];
    const encodedQuery = encodeURIComponent(query);
    
    try {
        const response = await fetch(`https://search.yahoo.com/search?p=${encodedQuery}&ei=UTF-8&fr=moz-firefox`, {
            headers: {
                'User-Agent': 'Mozilla/5.0',
                'Accept': 'text/html'
            },
            signal: AbortSignal.timeout(8000)
        });
        
        const html = await response.text();
        
        const linkRegex = /<h3[^>]*class="[^"]*title[^"]*"[^>]*>\s*<a[^>]*href="([^"]+)"[^>]*>([^<]+)<\/a>/gi;
        const snippetRegex = /<p[^>]*class="[^"]*ex[sz][^"]*"[^>]*>([\s\S]*?)<\/p>/gi;
        
        const links = [...html.matchAll(linkRegex)];
        const snippets = [...html.matchAll(snippetRegex)];
        
        for (let i = 0; i < Math.min(links.length, 5); i++) {
            const url = links[i][1];
            const title = cleanText(links[i][2]);
            
            if (isValidUrl(url)) {
                const snippet = snippets[i] ? cleanText(snippets[i][1]).substring(0, 300) : '';
                results.push({
                    engine: 'Yahoo',
                    title,
                    url,
                    snippet
                });
            }
        }
    } catch (e) {
        console.log('Yahoo hatasi:', e.message);
    }
    
    return results;
}

// ==================== ICERIK CEKME ====================

async function getFullContent(url) {
    let html = '';
    let source = 'direct';
    
    // 1. Direkt erisim
    try {
        const response = await fetch(url, {
            headers: getBrowserHeaders(),
            signal: AbortSignal.timeout(10000)
        });
        
        if (response.ok) {
            html = await response.text();
        }
    } catch (e) {}
    
    // 2. Google Cache
    if (!html || html.length < 500) {
        try {
            const cacheUrl = `https://webcache.googleusercontent.com/search?q=cache:${encodeURIComponent(url)}`;
            const response = await fetch(cacheUrl, {
                headers: { 'User-Agent': 'Mozilla/5.0 (compatible; GoogleServer)' },
                signal: AbortSignal.timeout(8000)
            });
            
            if (response.ok) {
                const cacheHtml = await response.text();
                if (cacheHtml.includes('<!DOCTYPE') || cacheHtml.includes('<html')) {
                    html = cacheHtml;
                    source = 'google-cache';
                }
            }
        } catch (e) {}
    }
    
    // 3. Wayback Machine
    if (!html || html.length < 500) {
        try {
            const waybackUrl = `https://web.archive.org/web/2024/${url}`;
            const response = await fetch(waybackUrl, {
                headers: { 'User-Agent': 'Mozilla/5.0' },
                signal: AbortSignal.timeout(8000)
            });
            
            if (response.ok) {
                const waybackHtml = await response.text();
                if (waybackHtml.includes('<!DOCTYPE') || waybackHtml.includes('<html')) {
                    html = waybackHtml;
                    source = 'wayback';
                }
            }
        } catch (e) {}
    }
    
    if (!html || html.length < 200) {
        return null;
    }
    
    return extractContent(html, source);
}

function extractContent(html, source) {
    const title = html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1] || 
                 html.match(/<meta[^>]*property="og:title"[^>]*content="([^"]+)"/i)?.[1] || '';
    
    const description = html.match(/<meta[^>]*name="description"[^>]*content="([^"]+)"/i)?.[1] ||
                       html.match(/<meta[^>]*property="og:description"[^>]*content="([^"]+)"/i)?.[1] || '';
    
    const h1s = [...html.matchAll(/<h1[^>]*>([^<]+)<\/h1>/gi)].map(m => cleanText(m[1]));
    const h2s = [...html.matchAll(/<h2[^>]*>([^<]+)<\/h2>/gi)].map(m => cleanText(m[1])).slice(0, 5);
    const h3s = [...html.matchAll(/<h3[^>]*>([^<]+)<\/h3>/gi)].map(m => cleanText(m[1])).slice(0, 5);
    
    let articleContent = '';
    
    const articlePatterns = [
        /<article[^>]*>([\s\S]*?)<\/article>/i,
        /<main[^>]*>([\s\S]*?)<\/main>/i,
        /<div[^>]*class="[^"]*content[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
        /<div[^>]*class="[^"]*article[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
        /<div[^>]*class="[^"]*post[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
        /<div[^>]*class="[^"]*entry[^"]*"[^>]*>([\s\S]*?)<\/div>/i
    ];
    
    for (const pattern of articlePatterns) {
        const match = html.match(pattern);
        if (match && match[1].length > articleContent.length) {
            articleContent = match[1];
        }
    }
    
    if (!articleContent) {
        const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
        articleContent = bodyMatch ? bodyMatch[1] : html;
    }
    
    let text = articleContent
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
        .replace(/<\/li>/gi, '\n')
        .replace(/<[^>]+>/g, '')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
    
    return {
        title: cleanText(title),
        description: cleanText(description),
        headings: [...h1s, ...h2s, ...h3s].slice(0, 8),
        text: text.substring(0, 3000),
        source
    };
}

// ==================== SITE ANALIZI ====================

async function analyzeWebsite(url) {
    console.log('SITE ANALIZ:', url);
    
    let html = '';
    let bypassMethod = '';
    
    // 1. Direkt erisim
    try {
        const response = await fetch(url, {
            headers: getBrowserHeaders(),
            signal: AbortSignal.timeout(10000)
        });
        if (response.ok) {
            html = await response.text();
            if (html.includes('<!DOCTYPE') || html.includes('<html')) {
                bypassMethod = 'Direkt';
            }
        }
    } catch (e) {}
    
    // 2. Google Cache
    if (!html || html.length < 500) {
        try {
            const cacheUrl = `https://webcache.googleusercontent.com/search?q=cache:${encodeURIComponent(url)}`;
            const response = await fetch(cacheUrl, {
                headers: { 'User-Agent': 'Mozilla/5.0' },
                signal: AbortSignal.timeout(8000)
            });
            if (response.ok) {
                const cacheHtml = await response.text();
                if (cacheHtml.includes('<!DOCTYPE') || cacheHtml.includes('<html')) {
                    html = cacheHtml;
                    bypassMethod = 'Google Cache';
                }
            }
        } catch (e) {}
    }
    
    // 3. Wayback Machine
    if (!html || html.length < 500) {
        try {
            const waybackUrl = `https://web.archive.org/web/2024/${url}`;
            const response = await fetch(waybackUrl, {
                headers: { 'User-Agent': 'Mozilla/5.0' },
                signal: AbortSignal.timeout(8000)
            });
            if (response.ok) {
                const waybackHtml = await response.text();
                if (waybackHtml.includes('<!DOCTYPE') || waybackHtml.includes('<html')) {
                    html = waybackHtml;
                    bypassMethod = 'Wayback Machine';
                }
            }
        } catch (e) {}
    }
    
    if (!html || html.length < 500) {
        return `SITE ANALIZI: ${url}\n\nDurum: Siteye erisilemedi\n\nManuel kontrol icin:\n- https://webcache.googleusercontent.com/search?q=cache:${encodeURIComponent(url)}\n- https://web.archive.org/web/*/${url.replace('https://', '')}`;
    }
    
    let report = '';
    report += `SITE ANALIZI\n`;
    report += `URL: ${url}\n`;
    report += `Kaynak: ${bypassMethod}\n`;
    report += `================================\n\n`;
    
    // HTML Yapisi
    const lang = html.match(/<html[^>]*lang="([^"]+)"/i)?.[1] || 'Belirtilmemis';
    const charset = html.match(/<meta[^>]*charset="([^"]+)"/i)?.[1] || 'UTF-8';
    
    report += `DIL: ${lang}\n`;
    report += `KARAKTER: ${charset}\n`;
    
    // Basliklar
    const h1s = [...html.matchAll(/<h1[^>]*>([^<]+)<\/h1>/gi)].map(m => cleanText(m[1]));
    const h2s = [...html.matchAll(/<h2[^>]*>([^<]+)<\/h2>/gi)].map(m => cleanText(m[1]));
    const h3s = [...html.matchAll(/<h3[^>]*>([^<]+)<\/h3>/gi)].map(m => cleanText(m[1]));
    
    report += `\nBASLIKLAR:\n`;
    report += `H1 (${h1s.length}): ${h1s.slice(0, 3).join(', ') || 'Yok'}\n`;
    report += `H2 (${h2s.length}): ${h2s.slice(0, 3).join(', ') || 'Yok'}\n`;
    report += `H3 (${h3s.length}): ${h3s.slice(0, 3).join(', ') || 'Yok'}\n`;
    
    // Semantik
    report += `\nSEMANTIK YAPI:\n`;
    report += `<header>: ${/<header/i.test(html) ? 'Var' : 'Yok'}\n`;
    report += `<nav>: ${/<nav/i.test(html) ? 'Var' : 'Yok'}\n`;
    report += `<main>: ${/<main/i.test(html) ? 'Var' : 'Yok'}\n`;
    report += `<article>: ${/<article/i.test(html) ? 'Var' : 'Yok'}\n`;
    report += `<section>: ${/<section/i.test(html) ? 'Var' : 'Yok'}\n`;
    report += `<footer>: ${/<footer/i.test(html) ? 'Var' : 'Yok'}\n`;
    
    // SEO
    const title = html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1] || 'Yok';
    const metaDesc = html.match(/<meta[^>]*name="description"[^>]*content="([^"]+)"/i)?.[1] || 'Yok';
    const ogTitle = html.match(/<meta[^>]*property="og:title"[^>]*content="([^"]+)"/i)?.[1] || 'Yok';
    const ogImage = html.match(/<meta[^>]*property="og:image"[^>]*content="([^"]+)"/i)?.[1] || 'Yok';
    
    report += `\nSEO:\n`;
    report += `Title: ${cleanText(title).substring(0, 70)}\n`;
    report += `Description: ${cleanText(metaDesc).substring(0, 100)}\n`;
    report += `OG Title: ${cleanText(ogTitle).substring(0, 50)}\n`;
    report += `OG Image: ${ogImage ? 'Var' : 'Yok'}\n`;
    
    // Teknolojiler
    report += `\nTEKNOLOJILER:\n`;
    const techs = detectTech(html);
    report += (techs.length > 0 ? techs.join(', ') : 'Belirlenemedi') + '\n';
    
    // Istatistikler
    report += `\nICERIK:\n`;
    report += `Gorseller: ${(html.match(/<img/gi) || []).length}\n`;
    report += `Linkler: ${(html.match(/<a /gi) || []).length}\n`;
    report += `Formlar: ${(html.match(/<form/gi) || []).length}\n`;
    
    // Ana metin
    let text = html
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
        .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, '')
        .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    
    report += `\nSITE METNI:\n`;
    report += text.substring(0, 2500);
    
    return report;
}

function detectTech(html) {
    const techs = [];
    const lower = html.toLowerCase();
    
    if (/react|reactdom|create-react-app/i.test(lower)) techs.push('React');
    if (/_next\/|next\.js|nextjs/i.test(lower)) techs.push('Next.js');
    if (/vue\.js|vuejs|vue-router/i.test(lower)) techs.push('Vue.js');
    if (/nuxt\.js|__nuxt/i.test(lower)) techs.push('Nuxt.js');
    if (/angular|ng-version/i.test(lower)) techs.push('Angular');
    if (/svelte/i.test(lower)) techs.push('Svelte');
    if (/tailwindcss|tailwind-/i.test(lower)) techs.push('Tailwind CSS');
    if (/bootstrap[\.\/-]/i.test(lower)) techs.push('Bootstrap');
    if (/materialize/i.test(lower)) techs.push('Materialize CSS');
    if (/jquery[\.\-_]/i.test(lower)) techs.push('jQuery');
    if (/axios/i.test(lower)) techs.push('Axios');
    if (/gsap\.|greensock/i.test(lower)) techs.push('GSAP');
    if (/chart\.js|chartjs/i.test(lower)) techs.push('Chart.js');
    if (/wp-content|wp-includes|wordpress/i.test(lower)) techs.push('WordPress');
    if (/shopify/i.test(lower)) techs.push('Shopify');
    if (/woocommerce/i.test(lower)) techs.push('WooCommerce');
    if (/google-analytics|gtag\(|ga\(/i.test(lower)) techs.push('Google Analytics');
    if (/facebook.*fbevents|fbq\(/i.test(lower)) techs.push('Facebook Pixel');
    if (/hotjar/i.test(lower)) techs.push('Hotjar');
    if (/cloudflare/i.test(lower)) techs.push('Cloudflare');
    if (/google-fonts|fonts\.googleapis/i.test(lower)) techs.push('Google Fonts');
    if (/font-awesome|fa-|fas |far |fab /i.test(lower)) techs.push('Font Awesome');
    if (/firebase/i.test(lower)) techs.push('Firebase');
    if (/_vercel|vercel/i.test(lower)) techs.push('Vercel');
    if (/netlify/i.test(lower)) techs.push('Netlify');
    if (/stripe/i.test(lower)) techs.push('Stripe');
    if (/gtm-|googletagmanager/i.test(lower)) techs.push('Google Tag Manager');
    if (/hubspot/i.test(lower)) techs.push('HubSpot');
    if (/intercom/i.test(lower)) techs.push('Intercom');
    
    return [...new Set(techs)].slice(0, 12);
}

// ==================== YARDIMCI FONKSIYONLAR ====================

function getBrowserHeaders() {
    return {
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
    };
}

function isValidUrl(url) {
    if (!url || url.length < 15) return false;
    if (url.includes('duckduckgo.com')) return false;
    if (url.includes('yahoo.com/search')) return false;
    if (url.includes('bing.com/search')) return false;
    if (url.includes('google.com/search')) return false;
    if (url.includes('google.com/url')) return false;
    if (url.includes('facebook.com/sharer')) return false;
    if (url.includes('twitter.com/intent')) return false;
    if (url.includes('linkedin.com/sharing')) return false;
    return true;
}

function extractTag(text, tag) {
    const match = text.match(new RegExp(`<${tag}>([^<]+)<\/${tag}>`, 'i'));
    return match ? match[1] : null;
}

function extractCDATA(text, tag) {
    const match = text.match(new RegExp(`<${tag}><!\\[CDATA\\[([^\\]]+)\\]\\]><\\/${tag}>`, 'i'));
    return match ? match[1] : null;
}

function cleanText(text) {
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
        .replace(/<[^>]+>/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

function formatDate(dateStr) {
    if (!dateStr) return 'Yeni';
    try {
        const date = new Date(dateStr);
        const now = new Date();
        const diff = now - date;
        
        if (diff < 3600000) return Math.floor(diff / 60000) + ' dakika once';
        if (diff < 86400000) return Math.floor(diff / 3600000) + ' saat once';
        if (diff < 604800000) return Math.floor(diff / 86400000) + ' gun once';
        
        return date.toLocaleDateString('tr-TR', { year: 'numeric', month: 'short', day: 'numeric' });
    } catch {
        return dateStr;
    }
}
