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
    let report = '';
    let sourceCount = 0;
    
    const newsResults = await searchNews(query);
    if (newsResults.length > 0) {
        report += '\n=== HABER KAYNAKLARI ===\n\n';
        for (const item of newsResults) {
            report += `[HABER] ${item.title}\nKaynak: ${item.source}\nTarih: ${item.date}\nIcerik: ${item.content}\nLink: ${item.link}\n\n`;
            sourceCount++;
        }
    }
    
    const webResults = await searchWeb(query);
    if (webResults.length > 0) {
        report += '\n=== WEB ARAMA SONUCLARI ===\n\n';
        for (const item of webResults) {
            report += `[WEB] ${item.title}\nLink: ${item.url}\nAciklama: ${item.snippet}\n\n`;
            sourceCount++;
        }
    }
    
    report += '\n=== SITE ANALIZLERI ===\n\n';
    
    const sitesToVisit = [...webResults, ...newsResults.map(n => ({ url: n.link, title: n.title }))].slice(0, 6);
    const seen = new Set();
    
    for (const site of sitesToVisit) {
        if (seen.has(site.url)) continue;
        seen.add(site.url);
        
        if (!isGoodUrl(site.url)) continue;
        
        const content = await getPageContent(site.url);
        if (content && content.length > 100) {
            report += `[SITE] ${site.title}\nLink: ${site.url}\nIcerik:\n${content}\n\n`;
            sourceCount++;
        }
    }
    
    if (sourceCount === 0) {
        report += '\nSonuc bulunamadi.\n';
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
    
    try {
        const response = await fetch(`https://news.google.com/rss/search?q=${encodedQuery}&hl=tr-TR&gl=TR&ceid=TR:tr`, {
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
                results.push({
                    title: cleanHtml(title),
                    link: link,
                    source: 'Google News',
                    date: formatDate(date),
                    content: cleanHtml(desc).substring(0, 500)
                });
            }
        }
    } catch (e) {
        console.log('News error:', e.message);
    }
    
    return results;
}

async function searchWeb(query) {
    const results = [];
    const encodedQuery = encodeURIComponent(query);
    
    try {
        const response = await fetch(`https://lite.duckduckgo.com/lite/?q=${encodedQuery}&kl=tr-tr`, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Accept': 'text/html'
            },
            signal: AbortSignal.timeout(10000)
        });
        
        const html = await response.text();
        const linkRegex = /<a\s+class="result-link"\s+href="([^"]+)"[^>]*>([^<]+)<\/a>/gi;
        const snippetRegex = /<span[^>]*class="result-snippet"[^>]*>([\s\S]*?)<\/span>/gi;
        
        const links = [...html.matchAll(linkRegex)];
        const snippets = [...html.matchAll(snippetRegex)];
        
        for (let i = 0; i < Math.min(links.length, 8); i++) {
            const url = links[i][1];
            const title = cleanHtml(links[i][2]);
            
            if (isGoodUrl(url)) {
                let snippet = snippets[i] ? cleanHtml(snippets[i][1]).substring(0, 400) : '';
                results.push({ title, url, snippet });
            }
        }
        
    } catch (e) {
        console.error('Search error:', e.message);
    }
    
    return results;
}

async function getPageContent(url) {
    try {
        const response = await fetch(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Accept': 'text/html',
                'Accept-Language': 'tr-TR,tr;q=0.9'
            },
            signal: AbortSignal.timeout(12000)
        });
        
        if (!response.ok) return '';
        
        const html = await response.text();
        const title = html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1] || '';
        const metaDesc = html.match(/<meta[^>]*name="description"[^>]*content="([^"]+)"/i)?.[1] || '';
        const h2s = [...html.matchAll(/<h2[^>]*>([^<]+)<\/h2>/gi)].map(m => cleanHtml(m[1])).slice(0, 4);
        const h3s = [...html.matchAll(/<h3[^>]*>([^<]+)<\/h3>/gi)].map(m => cleanHtml(m[1])).slice(0, 4);
        
        let content = html.match(/<article[^>]*>([\s\S]*?)<\/article>/i)?.[1] ||
                     html.match(/<main[^>]*>([\s\S]*?)<\/main>/i)?.[1] ||
                     html.match(/<body[^>]*>([\s\S]*?)<\/body>/i)?.[1] || html;
        
        content = content
            .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
            .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
            .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, '')
            .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, '')
            .replace(/<[^>]+>/g, '')
            .replace(/\n{3,}/g, '\n\n')
            .trim();
        
        let report = `Baslik: ${cleanHtml(title)}\n`;
        if (metaDesc) report += `Aciklama: ${cleanHtml(metaDesc)}\n`;
        if (h2s.length > 0) report += `Basliklar: ${h2s.join(' | ')}\n`;
        if (h3s.length > 0) report += `Alt Basliklar: ${h3s.join(' | ')}\n`;
        report += `\nIcerik:\n${content.substring(0, 2500)}`;
        
        return report;
        
    } catch (e) {
        return '';
    }
}

async function analyzeWebsiteCode(url) {
    let html = '';
    let bypassed = false;
    let methodsTried = [];
    
    try {
        const response = await fetch(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml',
                'Accept-Language': 'tr-TR,tr;q=0.9,en;q=0.8',
                'Accept-Encoding': 'gzip, deflate, br'
            },
            signal: AbortSignal.timeout(10000)
        });
        
        if (response.ok) {
            html = await response.text();
            if (html.includes('<!DOCTYPE') || html.includes('<html')) {
                methodsTried.push('Normal erisim basarili');
            }
        }
    } catch (e) {
        methodsTried.push('Normal erisim basarisiz');
    }
    
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
                    bypassed = true;
                    methodsTried.push('Google Cache basarili');
                }
            }
        } catch (e) {
            methodsTried.push('Google Cache basarisiz');
        }
    }
    
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
                    bypassed = true;
                    methodsTried.push('Wayback Machine basarili');
                }
            }
        } catch (e) {
            methodsTried.push('Wayback Machine basarisiz');
        }
    }
    
    if (!html || html.length < 500) {
        return `CLOUDFLARE KORUMASI: Site korumaya alinmis.\n\nYapilan denemeler:\n${methodsTried.join('\n')}\n\nSite: ${url}\n\nCozumler:\n1. https://webcache.googleusercontent.com/search?q=cache:${encodeURIComponent(url)}\n2. https://web.archive.org/web/*/${url.replace('https://', '')}`;
    }
    
    let report = '';
    report += 'SITE ANALIZI\n';
    report += 'URL: ' + url + '\n';
    if (bypassed) report += '(Cache kullanildi)\n';
    report += '================================\n\n';
    
    const lang = html.match(/<html[^>]*lang="([^"]+)"/i)?.[1] || 'Belirtilmemis';
    const charset = html.match(/<meta[^>]*charset="([^"]+)"/i)?.[1] || 'UTF-8';
    
    report += 'HTML YAPISI:\n';
    report += 'Dil: ' + lang + '\n';
    report += 'Karakter: ' + charset + '\n';
    
    const h1s = [...html.matchAll(/<h1[^>]*>([^<]+)<\/h1>/gi)].map(m => cleanHtml(m[1]));
    const h2s = [...html.matchAll(/<h2[^>]*>([^<]+)<\/h2>/gi)].map(m => cleanHtml(m[1]));
    const h3s = [...html.matchAll(/<h3[^>]*>([^<]+)<\/h3>/gi)].map(m => cleanHtml(m[1]));
    
    report += 'H1: ' + (h1s.length > 0 ? h1s.slice(0, 3).join(', ') : 'Yok') + '\n';
    report += 'H2: ' + (h2s.length > 0 ? h2s.slice(0, 3).join(', ') : 'Yok') + '\n';
    report += 'H3: ' + (h3s.length > 0 ? h3s.slice(0, 3).join(', ') : 'Yok') + '\n';
    
    report += '\nSEMANTIK ETIKETLER:\n';
    report += 'header: ' + (/<header/i.test(html) ? 'Var' : 'Yok') + '\n';
    report += 'nav: ' + (/<nav/i.test(html) ? 'Var' : 'Yok') + '\n';
    report += 'main: ' + (/<main/i.test(html) ? 'Var' : 'Yok') + '\n';
    report += 'article: ' + (/<article/i.test(html) ? 'Var' : 'Yok') + '\n';
    report += 'section: ' + (/<section/i.test(html) ? 'Var' : 'Yok') + '\n';
    report += 'footer: ' + (/<footer/i.test(html) ? 'Var' : 'Yok') + '\n';
    
    const title = html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1] || 'Yok';
    const metaDesc = html.match(/<meta[^>]*name="description"[^>]*content="([^"]+)"/i)?.[1] || 'Yok';
    
    report += '\nSEO:\n';
    report += 'Title: ' + cleanHtml(title).substring(0, 60) + '\n';
    report += 'Description: ' + cleanHtml(metaDesc).substring(0, 80) + '\n';
    
    report += '\nTESPIT EDILEN TEKNOLOJILER:\n';
    const techs = detectTechnologies(html);
    report += (techs.length > 0 ? techs.join(', ') : 'Belirlenemedi') + '\n';
    
    report += '\nICERIK ISTASYSTIKLERI:\n';
    report += 'Gorseller: ' + (html.match(/<img/gi) || []).length + '\n';
    report += 'Linkler: ' + (html.match(/<a /gi) || []).length + '\n';
    report += 'Formlar: ' + (html.match(/<form/gi) || []).length + '\n';
    
    let content = html
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
        .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, '')
        .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    
    report += '\nSITE ICERIGI (2500 karakter):\n';
    report += content.substring(0, 2500);
    
    return report;
}

function detectTechnologies(html) {
    const techs = [];
    const lower = html.toLowerCase();
    
    if (/<script[^>]*src="[^"]*react/i.test(lower)) techs.push('React');
    if (/<script[^>]*src="[^"]*vue/i.test(lower)) techs.push('Vue.js');
    if (/<script[^>]*src="[^"]*angular/i.test(lower)) techs.push('Angular');
    if (/tailwindcss/i.test(lower)) techs.push('Tailwind CSS');
    if (/bootstrap/i.test(lower)) techs.push('Bootstrap');
    if (/jquery/i.test(lower)) techs.push('jQuery');
    if (/wp-content|wp-includes/i.test(lower)) techs.push('WordPress');
    if (/shopify/i.test(lower)) techs.push('Shopify');
    if (/woocommerce/i.test(lower)) techs.push('WooCommerce');
    if (/google-analytics|gtag\(/i.test(lower)) techs.push('Google Analytics');
    if (/facebook.*fbevents|fbq\(/i.test(lower)) techs.push('Facebook Pixel');
    if (/hotjar/i.test(lower)) techs.push('Hotjar');
    if (/cloudflare/i.test(lower)) techs.push('Cloudflare');
    if (/google-fonts|fonts\.googleapis/i.test(lower)) techs.push('Google Fonts');
    if (/font-awesome|fa-|fas |far /i.test(lower)) techs.push('Font Awesome');
    if (/firebase/i.test(lower)) techs.push('Firebase');
    if (/_vercel|vercel/i.test(lower)) techs.push('Vercel');
    if (/netlify/i.test(lower)) techs.push('Netlify');
    if (/stripe|paypal/i.test(lower)) techs.push('Odeme Sistemi');
    if (/gtm-|googletagmanager/i.test(lower)) techs.push('Google Tag Manager');
    
    return techs.slice(0, 10);
}

function isGoodUrl(url) {
    if (!url || url.length < 15) return false;
    if (url.includes('duckduckgo.com')) return false;
    if (url.includes('yahoo.com/')) return false;
    if (url.includes('bing.com/')) return false;
    if (url.includes('google.com/search')) return false;
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
        .replace(/&nbsp;/g, ' ')
        .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(n))
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
