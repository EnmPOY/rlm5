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
                userMessage = `🌐 WEB SİTE ANALİZİ:\n\n${analysisResults.join('\n\n---\n\n')}\n\n❓ KULLANICI SORUSU:\n${message}\n\nYukarıdaki web sitesi analizine dayanarak kullanıcıya kapsamlı ve detaylı bir cevap ver.`;
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
            userMessage = `📊 WEB ARAŞTIRMASI:\n\nAraştırma sırasında bir hata oluştu: ${err.message}\n\n❓ KULLANICI SORUSU:\n${message}`;
        }
    }

    const systemPrompt = `Sen RLM 5'sin. Turkiye'de gelistirilmis gelismis bir yapay zeka asistansin. Turkce konus. Kullaniciya RLM 5 oldugunu soyle, kurucu bilgisi sorulursa Troye ekibi de. Kendini AI model, MiniMax, Claude, Qwen vb. olarak tanitma. Sik, faydali ve dogru cevaplar ver. Derin araştırma yaparken sitelere gir, analiz et, karsilastir ve kapsamlı rapor sun.`;

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
                max_tokens: isDeepResearch ? 4000 : 2000,
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
    let report = `🔬 **DERİN ARAŞTIRMA RAPORU**\n`;
    report += `═══════════════════════════════════════\n\n`;
    report += `📋 **Konu:** ${query}\n\n`;

    report += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
    report += `📡 **Adım 1: Web Aramasi Yapiliyor...**\n`;
    report += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;

    const searchResults = await searchDuckDuckGo(query);
    
    report += `✅ ${searchResults.results.length} sonuc bulundu:\n\n`;
    
    searchResults.results.slice(0, 5).forEach((r, i) => {
        report += `${i + 1}. 🔗 ${r.title}\n   📝 ${r.snippet}\n   🌐 ${r.url}\n\n`;
    });

    report += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
    report += `🔍 **Adım 2: Siteler Analiz Ediliyor...**\n`;
    report += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;

    const siteAnalyses = [];
    const sitesToAnalyze = searchResults.results.slice(0, 3);

    for (let i = 0; i < sitesToAnalyze.length; i++) {
        const site = sitesToAnalyze[i];
        report += `📱 Site ${i + 1}/${sitesToAnalyze.length}: ${site.title}\n`;
        report += `   🔗 ${site.url}\n`;
        
        try {
            const analysis = await analyzeWebsite(site.url);
            siteAnalyses.push({
                title: site.title,
                url: site.url,
                analysis: analysis
            });
            report += `   ✅ Analiz tamamlandı\n\n`;
        } catch (err) {
            report += `   ⚠️ Analiz yapilamadi: ${err.message}\n\n`;
        }
    }

    report += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
    report += `📊 **Adım 3: Detayli Analizler**\n`;
    report += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;

    for (const site of siteAnalyses) {
        report += `🔸 **${site.title}**\n`;
        report += `${site.analysis}\n\n`;
    }

    if (searchResults.answer) {
        report += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
        report += `📖 **Adım 4: Genel Bilgi**\n`;
        report += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
        report += `${searchResults.answer}\n\n`;
        if (searchResults.answerSource) {
            report += `Kaynak: ${searchResults.answerSource}\n\n`;
        }
    }

    if (searchResults.relatedTopics && searchResults.relatedTopics.length > 0) {
        report += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
        report += `📌 **İlgili Konular**\n`;
        report += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
        searchResults.relatedTopics.slice(0, 5).forEach((t, i) => {
            report += `${i + 1}. ${t.title}\n`;
        });
        report += `\n`;
    }

    report += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
    report += `✅ **Araştirma Tamamlandi**\n`;
    report += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
    report += `\n❓ Şimdi sorunuzu sorun veya daha detayli bilgi isteyin.\n`;
    report += `Not: Yukaridaki analizler web'den derlenmistir.`;


    const researchContext = buildResearchContext(searchResults);
    
    let fullContext = `📊 DERIN ARAŞTIRMA SONUÇLARI:\n`;
    fullContext += `═══════════════════════════════════════\n\n`;
    fullContext += `KONİ: ${query}\n\n`;
    
    fullContext += `ARAMA SONİCLARİ:\n${researchContext}\n\n`;
    
    for (const site of siteAnalyses) {
        fullContext += `═══════════════════════════════════════\n`;
        fullContext += `SİTE ANALİZİ: ${site.title}\n`;
        fullContext += `URL: ${site.url}\n`;
        fullContext += `═══════════════════════════════════════\n\n`;
        fullContext += site.analysis + `\n\n`;
    }
    
    fullContext += `\n❓ KULLANICI SORUSU:\n${query}\n\n`;
    fullContext += `Yukaridaki derin arastirma sonuclarina dayanarak kapsamli ve detayli bir rapor hazirla. Tum bilgileri birlestir, karsilastir, ve sonuclari musterinin anlayacagi sekilde sun. Kaynaklari belirt.`;


    return fullContext;
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
            return `❌ Site erisilemedi (Durum: ${response.status})`;
        }

        const html = await response.text();
        
        const title = extractTag(html, /<title[^>]*>([^<]*)<\/title>/i) || 
                      extractTag(html, /<meta[^>]*property="og:title"[^>]*content="([^"]*)"/i) || 'Bulunamadi';
        
        const description = extractTag(html, /<meta[^>]*name="description"[^>]*content="([^"]*)"/i) ||
                           extractTag(html, /<meta[^>]*property="og:description"[^>]*content="([^"]*)"/i) || 'Bulunamadi';
        
        const h1Tags = html.match(/<h1[^>]*>([^<]*)<\/h1>/gi) || [];
        const h1s = h1Tags.map(h => h.replace(/<[^>]*>/g, '').trim()).filter(h => h.length > 0).slice(0, 5);
        
        const h2Tags = html.match(/<h2[^>]*>([^<]*)<\/h2>/gi) || [];
        const h2s = h2Tags.map(h => h.replace(/<[^>]*>/g, '').trim()).filter(h => h.length > 0).slice(0, 5);
        
        const images = (html.match(/<img[^>]*>/gi) || []).length;
        const links = (html.match(/<a[^>]*href=["'][^"']+["'][^>]*>/gi) || []).length;
        
        const textContent = html
            .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
            .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
            .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, '')
            .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, '')
            .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, '')
            .replace(/<[^>]+>/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
        
        const mainContent = textContent.substring(0, 2500);
        
        const techStack = detectTechStack(html);
        
        const hasSSL = cleanUrl.startsWith('https://');
        
        const lang = extractTag(html, /<html[^>]*lang="([^"]*)"/i) || 'Belirtilmemis';
        const charset = extractTag(html, /<meta[^>]*charset="([^"]*)"/i) || 'UTF-8';
        
        let analysis = `BASLIK: ${title}\n`;
        analysis += `AÇIKLAMA: ${description}\n`;
        analysis += `DIL: ${lang}\n`;
        analysis += `KARAKTER KÜMESİ: ${charset}\n`;
        
        if (h1s.length > 0) {
            analysis += `\nH1 BASLIKLARI:\n`;
            h1s.forEach(h => analysis += `- ${h}\n`);
        }
        
        if (h2s.length > 0) {
            analysis += `\nH2 BASLIKLARI:\n`;
            h2s.slice(0, 3).forEach(h => analysis += `- ${h}\n`);
        }
        
        analysis += `\nİSTATİSTİKLER:\n`;
        analysis += `- Gorüntüler: ${images}\n`;
        analysis += `- Linkler: ${links}\n`;
        analysis += `- İçerik uzunlugu: ${textContent.length} karakter\n`;
        
        analysis += `\nGÜVENLİK: ${hasSSL ? '✅ SSL var (HTTPS)' : '⚠️ SSL yok (HTTP)'}\n`;
        
        if (techStack.length > 0) {
            analysis += `\nTEKNOLOJİLER: ${techStack.join(', ')}\n`;
        }
        
        analysis += `\nANA İÇERİK (${Math.min(mainContent.length, 2500)} karakter):\n${mainContent}`;
        
        return analysis;

    } catch (err) {
        return `❌ Analiz hatasi: ${err.message}`;
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

function detectTechStack(html) {
    const techs = [];
    const lowerHtml = html.toLowerCase();
    
    const techPatterns = [
        { name: 'React', pattern: /react|reactdom|react-/ },
        { name: 'Vue.js', pattern: /vue\.js|vuejs|__vue__/ },
        { name: 'Angular', pattern: /angular|ng-version/ },
        { name: 'Next.js', pattern: /_next\/|next\.js/ },
        { name: 'WordPress', pattern: /wp-content|wp-includes/ },
        { name: 'jQuery', pattern: /jquery[\.-]/ },
        { name: 'Bootstrap', pattern: /bootstrap[\./]/ },
        { name: 'Tailwind CSS', pattern: /tailwindcss|tailwind-/ },
        { name: 'Google Analytics', pattern: /google-analytics|analytics\.js/ },
        { name: 'Cloudflare', pattern: /cloudflare/ },
        { name: 'Google Fonts', pattern: /fonts\.googleapis/ },
        { name: 'Stripe', pattern: /stripe\.com/ },
        { name: 'WooCommerce', pattern: /woocommerce/ },
        { name: 'Laravel', pattern: /laravel_session/ },
        { name: 'PHP', pattern: /\.php|pHP/i },
        { name: 'TypeScript', pattern: /\.ts["\']|typescript/ },
        { name: 'Webpack', pattern: /webpack/ },
        { name: 'Vite', pattern: /vite/ },
        { name: 'Svelte', pattern: /svelte/ },
        { name: 'Shopify', pattern: /shopify/ },
        { name: 'HubSpot', pattern: /hubspot/ },
        { name: 'Hotjar', pattern: /hotjar/ },
        { name: 'Intercom', pattern: /intercom/ },
        { name: 'Disqus', pattern: /disqus/ }
    ];
    
    techPatterns.forEach(({ name, pattern }) => {
        if (pattern.test(lowerHtml)) {
            techs.push(name);
        }
    });
    
    return [...new Set(techs)].slice(0, 8);
}

async function searchDuckDuckGo(query) {
    const encodedQuery = encodeURIComponent(query);
    
    const results = {
        answer: '',
        answerSource: '',
        results: []
    };

    try {
        const apiUrl = `https://api.duckduckgo.com/?q=${encodedQuery}&format=json&pretty=1&no_redirect=1&t=h_&df=all&kl=tr-tr`;
        const apiResponse = await fetch(apiUrl);
        
        if (apiResponse.ok) {
            const data = await apiResponse.json();
            results.answer = data.AbstractText || '';
            results.answerSource = data.AbstractURL || '';
        }
    } catch (e) {
        console.log('DDG API error:', e.message);
    }

    try {
        const htmlUrl = `https://lite.duckduckgo.com/lite/?q=${encodedQuery}&kl=tr-tr`;
        const htmlResponse = await fetch(htmlUrl);
        const html = await htmlResponse.text();
        
        const linkRegex = /<a class="result-link"[^>]*href="([^"]*)"[^>]*>([^<]*)<\/a>/gi;
        const linkMatches = [...html.matchAll(linkRegex)];
        
        const snippetRegex = /<span class="result-snippet">[^<]*(?:<[^>]*>[^<]*)*<\/span>/gi;
        const snippetMatches = [...html.matchAll(snippetRegex)];
        
        const seenUrls = new Set();
        
        for (let i = 0; i < Math.min(linkMatches.length, 8); i++) {
            const url = linkMatches[i][1];
            const title = linkMatches[i][2].trim();
            
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
            
            results.results.push({
                title: title || 'Baslik yok',
                url: url,
                snippet: snippet || 'Aciklama yok'
            });
        }
    } catch (e) {
        console.log('DDG HTML search error:', e.message);
    }

    return results;
}

function buildResearchContext(results) {
    let context = '';

    if (results.answer) {
        context += `GENEL BİLGİ:\n${results.answer}\n`;
        if (results.answerSource) {
            context += `Kaynak: ${results.answerSource}\n`;
        }
        context += '\n';
    }

    if (results.results && results.results.length > 0) {
        context += `ARAMA SONİCLARİ:\n\n`;
        results.results.forEach((r, i) => {
            context += `${i + 1}. ${r.title}\n   ${r.snippet}\n   URL: ${r.url}\n\n`;
        });
    }

    return context || 'Sonuc bulunamadi.';
}
