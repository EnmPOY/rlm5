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

    const { message, history = [], search = false, imageUrls = [] } = req.body;
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

    // Resim URL'lerini tespit et (mesaj icinde veya ayri alandan)
    const imageExtensions = /\.(jpg|jpeg|png|gif|webp|svg|bmp|ico|tiff)(\?[^"'\s]*)?$/i;
    const messageImageUrls = (urls || []).filter(url => imageExtensions.test(url));
    const allImageUrls = [...new Set([...messageImageUrls, ...(imageUrls || [])])];
    
    let userMessage = message;
    let isDeepResearch = false;
    let imageAnalysis = null;

    // RESIM ANALIZI
    if (allImageUrls.length > 0) {
        console.log('RESIM ANALIZI:', allImageUrls.length, 'resim tespit edildi');
        imageAnalysis = await analyzeImages(allImageUrls);
        userMessage = `${imageAnalysis}\n\nKULLANICI MESAJI: ${message}`;
    }
    // SITE ANALIZI
    else if (urls && urls.length > 0) {
        let report = '';
        for (const url of urls.slice(0, 3)) {
            report += await analyzeWebsite(url) + '\n\n';
        }
        userMessage = report + '\nSORU: ' + message;
    }
    // DERIN ARASTIRMA
    else if (search) {
        isDeepResearch = true;
        userMessage = await doDeepResearch(message);
    }

    const systemPrompt = isDeepResearch
        ? `Sen RLM 5'sin. Turkiye'nin en gelismis yapay zeka asistansin. Turkiye'de Troye ekibi tarafindan gelistirildin. Turkce konus.

ASAGIDA KAPSAMLI ARASTIRMA SON UCLARI VAR. BU VERILERI DIKKATLICE INCLE VE EN IYI YANITI VER.

Kurallar:
1. Tum verileri birlestir
2. Kaynaklari belirt
3. Detayli ve anlasilir yanit ver
4. Bilgi yetersizse bunu belirt
5. Sonuclari duzenli goster`
        : `Sen RLM 5'sin. Turkiye'de gelistirilmis gelismis bir yapay zeka asistansin. Turkce konus. Kullaniciya RLM 5 oldugunu soyle, kurucu Troye ekibi. Sik, faydali ve dogru cevaplar ver. Gorsel analizi yapabilirsin.`;

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

// ==================== GELISMIS ICERIK CEKME ====================

async function getFullContent(url) {
    let html = '';
    let source = 'direct';
    
    // 1. Direkt erisim - tum basliklarla
    try {
        const response = await fetch(url, {
            headers: getBrowserHeaders(),
            signal: AbortSignal.timeout(12000)
        });
        
        if (response.ok) {
            html = await response.text();
        }
    } catch (e) {
        console.log('Direkt erisim hatasi:', e.message);
    }
    
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
    
    // 3. Bing Cache
    if (!html || html.length < 500) {
        try {
            const cacheUrl = `https://cc.bingj.com/cache.aspx?q=${encodeURIComponent(url)}&d=0`;
            const response = await fetch(cacheUrl, {
                headers: { 'User-Agent': 'Mozilla/5.0' },
                signal: AbortSignal.timeout(8000)
            });
            
            if (response.ok) {
                const cacheHtml = await response.text();
                if (cacheHtml.includes('<!DOCTYPE') || cacheHtml.includes('<html')) {
                    html = cacheHtml;
                    source = 'bing-cache';
                }
            }
        } catch (e) {}
    }
    
    // 4. Wayback Machine
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
    
    // 5. Textise dot iitty
    if (!html || html.length < 500) {
        try {
            const textiseUrl = `https://lite.textise.net/?url=${encodeURIComponent(url)}`;
            const response = await fetch(textiseUrl, {
                headers: { 'User-Agent': 'Mozilla/5.0' },
                signal: AbortSignal.timeout(6000)
            });
            
            if (response.ok) {
                const textHtml = await response.text();
                if (textHtml.length > 200) {
                    html = `<html><body><pre>${textHtml}</pre></body></html>`;
                    source = 'textise';
                }
            }
        } catch (e) {}
    }
    
    if (!html || html.length < 200) {
        return null;
    }
    
    return extractContentAdvanced(html, source, url);
}

function extractContentAdvanced(html, source, originalUrl) {
    // Meta bilgileri cek
    const title = extractMeta(html, 'title') || 
                  extractMeta(html, 'og:title') || 
                  extractMeta(html, 'twitter:title') || '';
    
    const description = extractMeta(html, 'description') || 
                       extractMeta(html, 'og:description') || 
                       extractMeta(html, 'twitter:description') || '';
    
    const author = extractMeta(html, 'author') || '';
    const publishDate = extractMeta(html, 'article:published_time') || 
                       extractMeta(html, 'date') || '';
    
    // Tum basliklari cek
    const h1s = extractAllHeadings(html, 'h1');
    const h2s = extractAllHeadings(html, 'h2');
    const h3s = extractAllHeadings(html, 'h3');
    const h4s = extractAllHeadings(html, 'h4');
    
    // Oncelikle ana icerigi bul
    let mainContent = findMainContent(html);
    
    // Eger ana icerik cok kisa ise body kullan
    if (mainContent.length < 500) {
        const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
        if (bodyMatch) {
            mainContent = cleanHTML(bodyMatch[1]);
        }
    }
    
    // Paragraf ve listeleri cikar
    const paragraphs = extractParagraphs(mainContent);
    const lists = extractLists(mainContent);
    
    // Tablo iceriklerini cikar
    const tables = extractTables(mainContent);
    
    // Kod bloklarini cikar (varsa)
    const codeBlocks = extractCodeBlocks(mainContent);
    
    // Tum metni birlestir
    let fullText = '';
    
    if (h1s.length > 0) {
        fullText += `BASLIKLAR: ${h1s[0]}\n`;
        if (h2s.length > 0) fullText += `Alt Basliklar: ${h2s.join(' > ')}\n`;
        fullText += '\n';
    }
    
    if (paragraphs.length > 0) {
        fullText += 'ICERIK:\n';
        paragraphs.forEach((p, i) => {
            if (p.length > 20) {
                fullText += `${i + 1}. ${p}\n\n`;
            }
        });
    }
    
    if (lists.length > 0) {
        fullText += '\nLISTELER:\n';
        lists.forEach((l, i) => {
            fullText += `${i + 1}. ${l}\n`;
        });
    }
    
    if (tables.length > 0) {
        fullText += '\nTABLOLAR:\n';
        tables.forEach(t => {
            fullText += t + '\n';
        });
    }
    
    if (codeBlocks.length > 0) {
        fullText += '\nKODLAR:\n';
        codeBlocks.forEach(c => {
            fullText += c + '\n';
        });
    }
    
    // Ek bilgiler
    let extras = '';
    
    if (author) extras += `Yazar: ${author}\n`;
    if (publishDate) extras += `Tarih: ${publishDate}\n`;
    if (h4s.length > 0) extras += `Diger Basliklar: ${h4s.join(', ')}\n`;
    
    if (extras) {
        fullText = '\nBILGILER:\n' + extras + '\n' + fullText;
    }
    
    return {
        title: cleanText(title),
        description: cleanText(description),
        headings: [...h1s, ...h2s, ...h3s].filter(h => h.length > 0),
        text: fullText.substring(0, 4000),
        source,
        url: originalUrl
    };
}

function findMainContent(html) {
    let bestContent = '';
    let bestScore = 0;
    
    // Yuksek puanli etiketler
    const candidates = [];
    
    // 1. Semantic etiketler
    const semanticTags = ['article', 'main', 'maincontent', 'content', 'post', 'entry', 'blog', 'story'];
    
    // 2. Class/ID kaliplari
    const contentPatterns = [
        /class="[^"]*(?:content|article|post|entry|blog|story|text|body|main)[^"]*"/gi,
        /id="[^"]*(?:content|article|post|entry|blog|story|text|body|main)[^"]*"/gi,
        /class="[^"]*(?:single|page)[^"]*"/gi
    ];
    
    // Semantic etiketleri bul
    for (const tag of semanticTags) {
        const regex = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'gi');
        let match;
        while ((match = regex.exec(html)) !== null) {
            const content = match[1];
            const textLength = content.replace(/<[^>]+>/g, '').length;
            const linkDensity = calculateLinkDensity(content);
            const score = textLength * (1 - linkDensity);
            
            if (score > bestScore) {
                bestScore = score;
                bestContent = content;
            }
        }
    }
    
    // Class/ID kaliplarini bul
    for (const pattern of contentPatterns) {
        const matches = html.match(pattern) || [];
        for (const attr of matches) {
            const classMatch = attr.match(/class="([^"]+)"/i) || attr.match(/id="([^"]+)"/i);
            if (classMatch) {
                const className = classMatch[1].replace(/\s+/g, '.');
                const escapedClass = className.replace(/\./g, '\\.');
                
                const regex = new RegExp(`<div[^>]*${escapedClass}[^>]*>([\\s\\S]*?)<\\/div>`, 'gi');
                let match;
                while ((match = regex.exec(html)) !== null) {
                    const content = match[1];
                    const textLength = content.replace(/<[^>]+>/g, '').length;
                    const linkDensity = calculateLinkDensity(content);
                    const score = textLength * (1 - linkDensity);
                    
                    if (score > bestScore) {
                        bestScore = score;
                        bestContent = content;
                    }
                }
            }
        }
    }
    
    // Textise versiyonuysa direkt text olarak al
    if (source === 'textise' || html.includes('<pre>')) {
        const preMatch = html.match(/<pre[^>]*>([\s\S]*?)<\/pre>/i);
        if (preMatch) {
            return cleanText(preMatch[1]);
        }
    }
    
    return bestContent || html;
}

function calculateLinkDensity(element) {
    const text = element.replace(/<[^>]+>/g, '');
    const links = element.match(/<a[^>]*href=["'][^"']+["'][^>]*>/gi) || [];
    const linkText = links.map(l => l.replace(/<[^>]+>/g, '')).join('');
    
    if (text.length === 0) return 1;
    return linkText.length / text.length;
}

function extractMeta(html, name) {
    // Standart meta
    let match = html.match(new RegExp(`<meta[^>]+name=["']${name}["'][^>]+content=["']([^"']+)["']`, 'i'));
    if (match) return match[1];
    
    // Ters sirali
    match = html.match(new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+name=["']${name}["']`, 'i'));
    if (match) return match[1];
    
    // OG/Twitter
    if (name.includes(':')) {
        match = html.match(new RegExp(`<meta[^>]+property=["']${name}["'][^>]+content=["']([^"']+)["']`, 'i'));
        if (match) return match[1];
        
        match = html.match(new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+property=["']${name}["']`, 'i'));
        if (match) return match[1];
    }
    
    return null;
}

function extractAllHeadings(html, tag) {
    const regex = new RegExp(`<${tag}[^>]*>([^<]+)<\\/${tag}>`, 'gi');
    const headings = [];
    let match;
    
    while ((match = regex.exec(html)) !== null) {
        const text = cleanText(match[1]).trim();
        if (text.length > 2 && text.length < 200) {
            headings.push(text);
        }
    }
    
    return headings;
}

function extractParagraphs(html) {
    const paragraphs = [];
    
    // <p> etiketleri
    const pRegex = /<p[^>]*>([\s\S]*?)<\/p>/gi;
    let match;
    while ((match = pRegex.exec(html)) !== null) {
        const text = cleanText(match[1]).trim();
        if (text.length > 30) {
            paragraphs.push(text);
        }
    }
    
    // <div> icinde <br> olanlar
    const divBrRegex = /<div[^>]*>([\s\S]*?)<\/div>/gi;
    while ((match = divBrRegex.exec(html)) !== null) {
        const content = match[1];
        const parts = content.split(/<br\s*\/?>/gi);
        for (const part of parts) {
            const text = cleanText(part).trim();
            if (text.length > 50 && !paragraphs.includes(text)) {
                paragraphs.push(text);
            }
        }
    }
    
    return paragraphs;
}

function extractLists(html) {
    const lists = [];
    
    const ulRegex = /<ul[^>]*>([\s\S]*?)<\/ul>/gi;
    const olRegex = /<ol[^>]*>([\s\S]*?)<\/ol>/gi;
    
    let match;
    while ((match = ulRegex.exec(html)) !== null) {
        const items = match[1].match(/<li[^>]*>([\s\S]*?)<\/li>/gi) || [];
        const listItems = items.map(li => cleanText(li.replace(/<\/?li[^>]*>/gi, '')).trim()).filter(t => t.length > 5);
        if (listItems.length > 0) {
            lists.push(...listItems);
        }
    }
    
    while ((match = olRegex.exec(html)) !== null) {
        const items = match[1].match(/<li[^>]*>([\s\S]*?)<\/li>/gi) || [];
        const listItems = items.map(li => cleanText(li.replace(/<\/?li[^>]*>/gi, '')).trim()).filter(t => t.length > 5);
        if (listItems.length > 0) {
            lists.push(...listItems);
        }
    }
    
    return lists;
}

function extractTables(html) {
    const tables = [];
    
    const tableRegex = /<table[^>]*>([\s\S]*?)<\/table>/gi;
    let match;
    while ((match = tableRegex.exec(html)) !== null) {
        const rows = match[1].match(/<tr[^>]*>([\s\S]*?)<\/tr>/gi) || [];
        const tableData = [];
        
        for (const row of rows.slice(0, 10)) {
            const cells = row.match(/<(?:td|th)[^>]*>([\s\S]*?)<\/(?:td|th)>/gi) || [];
            const rowData = cells.map(c => cleanText(c.replace(/<\/?(?:td|th)[^>]*>/gi, '')).trim()).filter(t => t.length > 0);
            if (rowData.length > 0) {
                tableData.push(rowData.join(' | '));
            }
        }
        
        if (tableData.length > 0) {
            tables.push(tableData.join('\n'));
        }
    }
    
    return tables;
}

function extractCodeBlocks(html) {
    const codes = [];
    
    const codeRegex = /<(?:pre|code)[^>]*>([\s\S]*?)<\/(?:pre|code)>/gi;
    let match;
    while ((match = codeRegex.exec(html)) !== null) {
        const code = cleanText(match[1]).trim();
        if (code.length > 20 && code.length < 1000) {
            codes.push(code);
        }
    }
    
    return codes;
}

function cleanHTML(html) {
    // Once tum zararli kodlari temizle
    let clean = html
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
        .replace(/<noscript[^>]*>[\s\S]*?<\/noscript>/gi, '')
        .replace(/<iframe[^>]*>[\s\S]*?<\/iframe>/gi, '')
        .replace(/<!--[\s\S]*?-->/g, '')
        .replace(/<svg[^>]*>[\s\S]*?<\/svg>/gi, '')
        .replace(/<canvas[^>]*>[\s\S]*?<\/canvas>/gi, '')
        .replace(/<video[^>]*>[\s\S]*?<\/video>/gi, '')
        .replace(/<audio[^>]*>[\s\S]*?<\/audio>/gi, '')
        .replace(/<embed[^>]*>/gi, '')
        .replace(/<object[^>]*>[\s\S]*?<\/object>/gi, '');
    
    // Navigasyon ve yan elemanlari temizle
    clean = clean
        .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, '')
        .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, '')
        .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, '')
        .replace(/<aside[^>]*>[\s\S]*?<\/aside>/gi, '')
        .replace(/<form[^>]*>[\s\S]*?<\/form>/gi, '')
        .replace(/<button[^>]*>[\s\S]*?<\/button>/gi, '')
        .replace(/<input[^>]*>/gi, '')
        .replace(/<select[^>]*>[\s\S]*?<\/select>/gi, '');
    
    return clean;
}

// ==================== SITE ANALIZI ====================

async function analyzeWebsite(url) {
    console.log('SITE ANALIZ:', url);
    
    let html = '';
    let bypassMethod = '';
    let extraInfo = {};
    
    // Tum yontemleri dene
    const fetchMethods = [
        // 1. Direkt
        async () => {
            const response = await fetch(url, { headers: getBrowserHeaders(), signal: AbortSignal.timeout(15000) });
            if (response.ok) {
                const text = await response.text();
                if (text.includes('<!DOCTYPE') || text.includes('<html')) {
                    extraInfo.status = response.status;
                    extraInfo.contentType = response.headers.get('content-type');
                    return { html: text, method: 'Direkt' };
                }
            }
            return null;
        },
        // 2. Google Cache
        async () => {
            const response = await fetch(`https://webcache.googleusercontent.com/search?q=cache:${encodeURIComponent(url)}`, { signal: AbortSignal.timeout(10000) });
            if (response.ok) {
                const text = await response.text();
                if (text.includes('<!DOCTYPE') || text.includes('<html')) {
                    return { html: text, method: 'Google Cache' };
                }
            }
            return null;
        },
        // 3. Wayback
        async () => {
            const response = await fetch(`https://web.archive.org/web/2024/${url}`, { signal: AbortSignal.timeout(10000) });
            if (response.ok) {
                const text = await response.text();
                if (text.includes('<!DOCTYPE') || text.includes('<html')) {
                    return { html: text, method: 'Wayback' };
                }
            }
            return null;
        },
        // 4. Bing Cache
        async () => {
            const response = await fetch(`https://cc.bingj.com/cache.aspx?q=${encodeURIComponent(url)}&d=0`, { signal: AbortSignal.timeout(10000) });
            if (response.ok) {
                const text = await response.text();
                if (text.includes('<!DOCTYPE') || text.includes('<html')) {
                    return { html: text, method: 'Bing Cache' };
                }
            }
            return null;
        },
        // 5. Textise
        async () => {
            const response = await fetch(`https://lite.textise.net/?url=${encodeURIComponent(url)}`, { signal: AbortSignal.timeout(8000) });
            if (response.ok) {
                const text = await response.text();
                if (text.length > 200) {
                    return { html: `<html><body><pre>${text}</pre></body></html>`, method: 'Textise' };
                }
            }
            return null;
        },
        // 6. Textise dot iitty
        async () => {
            const response = await fetch(`https://textise.net/showtext.aspx?strURL=${encodeURIComponent(url)}`, { signal: AbortSignal.timeout(8000) });
            if (response.ok) {
                const text = await response.text();
                if (text.length > 200) {
                    return { html: `<html><body><pre>${text}</pre></body></html>`, method: 'Textise.net' };
                }
            }
            return null;
        }
    ];
    
    for (const method of fetchMethods) {
        try {
            const result = await method();
            if (result && result.html && result.html.length > 500) {
                html = result.html;
                bypassMethod = result.method;
                break;
            }
        } catch (e) {}
    }
    
    if (!html || html.length < 500) {
        return `SITE ANALIZI\nURL: ${url}\n\nDurum: Siteye erisilemedi\n\nManuel kontrol icin:\n- https://webcache.googleusercontent.com/search?q=cache:${encodeURIComponent(url)}\n- https://web.archive.org/web/*/${url.replace('https://', '')}`;
    }
    
    const content = extractContentAdvanced(html, bypassMethod, url);
    
    let report = '';
    report += `SITE ANALIZI\n`;
    report += `URL: ${url}\n`;
    report += `Yontem: ${bypassMethod}\n`;
    if (extraInfo.status) report += `Durum: ${extraInfo.status}\n`;
    report += `================================\n\n`;
    
    // Site adi
    const siteName = extractMeta(html, 'og:site_name') || new URL(url).hostname.replace('www.', '');
    report += `Site Adi: ${siteName}\n`;
    
    // Meta
    report += `\nMETA BILGILER:\n`;
    report += `Baslik: ${content.title || 'Yok'}\n`;
    report += `Aciklama: ${content.description || 'Yok'}\n`;
    
    // Resim
    const ogImage = extractMeta(html, 'og:image') || extractMeta(html, 'twitter:image');
    if (ogImage) report += `Resim: ${ogImage}\n`;
    
    // Favicon
    const favicon = html.match(/<link[^>]*rel=["'](?:icon|shortcut icon)["'][^>]*href=["']([^"']+)["']/i)?.[1] ||
                   html.match(/<link[^>]*href=["']([^"']+\.ico)["'][^>]*rel=["'](?:icon|shortcut icon)["']/i)?.[1] || '';
    if (favicon) report += `Icon: ${favicon}\n`;
    
    // Basliklar
    if (content.headings.length > 0) {
        report += `\nBASLIKLAR:\n`;
        content.headings.slice(0, 5).forEach((h, i) => {
            report += `${i + 1}. ${h}\n`;
        });
    }
    
    // Sosyal
    report += `\nSOSYAL MEDYA:\n`;
    report += `Facebook OG: ${extractMeta(html, 'og:type') ? 'Var' : 'Yok'}\n`;
    report += `Twitter Card: ${extractMeta(html, 'twitter:card') || 'Yok'}\n`;
    
    // Teknoloji
    report += `\nTEKNOLOJILER:\n`;
    const techs = detectTech(html);
    report += (techs.length > 0 ? techs.join(', ') : 'Belirlenemedi') + '\n';
    
    // Icerik
    report += `\nICERIK:\n`;
    report += `================================\n`;
    if (content.text && content.text.length > 100) {
        report += content.text.substring(0, 4000);
    } else {
        report += 'Icerik cikaramadi. Site dinamik olabilir veya JavaScript gerektiriyor.\n';
    }
    
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

// ==================== RESIM ANALIZI ====================

async function analyzeImages(imageUrls) {
    console.log('RESIM ANALIZI BASLADI:', imageUrls.length);
    
    let report = '';
    report += '\n========== RESIM ANALIZI ==========\n\n';
    
    for (let i = 0; i < Math.min(imageUrls.length, 5); i++) {
        const imageUrl = imageUrls[i];
        console.log('Resim indiriliyor:', imageUrl);
        
        try {
            const imageData = await downloadImage(imageUrl);
            
            if (imageData) {
                report += `--- RESIM ${i + 1} ---\n`;
                report += `URL: ${imageUrl}\n`;
                report += `Boyut: ${imageData.size}\n`;
                report += `Tip: ${imageData.type}\n`;
                report += `Genislik: ${imageData.width || 'Bilinmiyor'}\n`;
                report += `Yukseklik: ${imageData.height || 'Bilinmiyor'}\n`;
                
                // Base64 kodlanmis goruntu (kucuk boyutluysa)
                if (imageData.base64 && imageData.base64.length < 100000) {
                    report += `\n[GORUNTU BILGISI]\n`;
                    report += `Base64 uzunlugu: ${imageData.base64.length} karakter\n`;
                    report += `\nAI'ya gonderilecek gorsel verisi hazir.\n`;
                }
                
                report += '\n';
            }
        } catch (e) {
            console.log('Resim indirme hatasi:', e.message);
            report += `--- RESIM ${i + 1} ---\n`;
            report += `URL: ${imageUrl}\n`;
            report += `Durum: Indirilemedi (${e.message})\n\n`;
        }
    }
    
    report += '===================================\n';
    report += '\nYukaridaki resimleri analiz et ve detayli bir rapor hazirla.\n';
    report += '\nRESIM ANALIZ RAPORU:\n';
    report += '- Resimde ne gorunuyor?\n';
    report += '- Renkler ve tasarim nedir?\n';
    report += '- Metin varsa ne yaziyo?\n';
    report += '- Grafik veya diyagram ise neyi gosteriyor?\n';
    report += '- Sonuç ve degerlendirme nedir?\n';
    
    return report;
}

async function downloadImage(url) {
    try {
        const response = await fetch(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Accept': 'image/webp,image/apng,image/*,*/*;q=0.8',
                'Accept-Language': 'tr-TR,tr;q=0.9,en;q=0.8'
            },
            signal: AbortSignal.timeout(15000)
        });
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        
        const contentType = response.headers.get('content-type') || 'image/jpeg';
        const arrayBuffer = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        const base64 = buffer.toString('base64');
        
        // Resim boyutunu al
        let width = null;
        let height = null;
        
        // PNG header
        if (contentType.includes('png') && buffer.length > 24) {
            width = buffer.readUInt32BE(16);
            height = buffer.readUInt32BE(20);
        }
        // JPEG header
        else if ((contentType.includes('jpeg') || contentType.includes('jpg')) && buffer.length > 2) {
            // JPEG boyut okuma (basit)
            width = 'JPEG (genislik tespit edilemedi)';
            height = 'JPEG (yukseklik tespit edilemedi)';
        }
        
        return {
            base64: base64,
            type: contentType,
            size: formatBytes(buffer.length),
            width: width,
            height: height
        };
        
    } catch (e) {
        console.log('Resim indirme hatasi:', url, e.message);
        return null;
    }
}

function formatBytes(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
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
