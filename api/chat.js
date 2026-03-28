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
    let websiteAnalysis = null;

    if (urls && urls.length > 0) {
        try {
            const analysisResults = [];
            for (const url of urls.slice(0, 3)) {
                const result = await analyzeWebsite(url);
                analysisResults.push(result);
            }
            if (analysisResults.length > 0) {
                websiteAnalysis = analysisResults.join('\n\n---\n\n');
                userMessage = `🌐 WEB SİTE ANALİZİ:\n${websiteAnalysis}\n\n❓ KULLANICI SORUSU:\n${message}\n\nYukarıdaki web sitesi analizine dayanarak kullanıcıya kapsamlı ve detaylı bir cevap ver.`;
            }
        } catch (err) {
            console.error('Website analysis error:', err);
        }
    } else if (search) {
        try {
            const searchResults = await searchDuckDuckGo(message);
            const researchContext = buildResearchContext(searchResults);
            userMessage = `📊 WEB ARAŞTIRMASI:\n${researchContext}\n\n❓ KULLANICI SORUSU:\n${message}\n\nYukarıdaki web araştırma sonuçlarına dayanarak kapsamlı ve detaylı bir cevap ver. Kaynakları belirt.`;
        } catch (err) {
            console.error('Search Error:', err);
        }
    }

    const systemPrompt = `Sen RLM 5'sin. Turkiye'de gelistirilmis gelismis bir yapay zeka asistansin. Turkce konus. Kullaniciya RLM 5 oldugunu soyle, kurucu bilgisi sorulursa Troye ekibi de. Kendini AI model, MiniMax, Claude, Qwen vb. olarak tanitma. Sik, faydali ve dogru cevaplar ver. Web sitesi analizi yaparken detayli ve profesyonel analiz sun.`;

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
                max_tokens: websiteAnalysis ? 2000 : 500,
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

        if (websiteAnalysis) {
            aiReply = '🔍 **Site Analizi:**\n\n' + aiReply;
        }

        res.status(200).json({ reply: aiReply });

    } catch (error) {
        console.error('API Error:', error);
        res.status(500).json({ error: 'Sunucu hatası. Bağlantınızı kontrol edin.' });
    }
};

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
            return `❌ Site erişilemedi: ${cleanUrl}\nDurum: ${response.status}`;
        }

        const html = await response.text();
        
        const title = extractTag(html, /<title[^>]*>([^<]*)<\/title>/i) || 
                      extractTag(html, /<meta[^>]*property="og:title"[^>]*content="([^"]*)"/i) || 'Bulunamadı';
        
        const description = extractTag(html, /<meta[^>]*name="description"[^>]*content="([^"]*)"/i) ||
                           extractTag(html, /<meta[^>]*property="og:description"[^>]*content="([^"]*)"/i) || 'Bulunamadı';
        
        const keywords = extractTag(html, /<meta[^>]*name="keywords"[^>]*content="([^"]*)"/i) || 'Bulunamadı';
        
        const author = extractTag(html, /<meta[^>]*name="author"[^>]*content="([^"]*)"/i) || 'Belirtilmemiş';
        
        const h1Tags = html.match(/<h1[^>]*>([^<]*)<\/h1>/gi) || [];
        const h1s = h1Tags.map(h => h.replace(/<[^>]*>/g, '').trim()).filter(h => h.length > 0).slice(0, 5);
        
        const images = (html.match(/<img[^>]*>/gi) || []).length;
        const links = (html.match(/<a[^>]*href=["'][^"']+["'][^>]*>/gi) || []).length;
        
        const textContent = html
            .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
            .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
            .replace(/<[^>]+>/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
        
        const mainContent = textContent.substring(0, 3000);
        
        const social = {
            ogImage: extractTag(html, /<meta[^>]*property="og:image"[^>]*content="([^"]*)"/i) || 'Yok',
            ogType: extractTag(html, /<meta[^>]*property="og:type"[^>]*content="([^"]*)"/i) || 'webpage',
            twitterCard: extractTag(html, /<meta[^>]*name="twitter:card"[^>]*content="([^"]*)"/i) || 'Yok'
        };

        const techStack = detectTechStack(html);
        
        const hasSSL = cleanUrl.startsWith('https://');
        
        let analysis = `📱 **Site:** ${cleanUrl}\n\n`;
        analysis += `📌 **Başlık:** ${title}\n\n`;
        analysis += `📝 **Açıklama:** ${description}\n\n`;
        analysis += `🏷️ **Anahtar Kelimeler:** ${keywords}\n\n`;
        analysis += `👤 **Yazar:** ${author}\n\n`;
        
        if (h1s.length > 0) {
            analysis += `📊 **Başlıklar (H1):**\n${h1s.map(h => `   • ${h}`).join('\n')}\n\n`;
        }
        
        analysis += `📈 **İçerik İstatistikleri:**\n`;
        analysis += `   • Görseller: ${images}\n`;
        analysis += `   • Linkler: ${links}\n`;
        analysis += `   • İçerik uzunluğu: ${textContent.length} karakter\n\n`;
        
        analysis += `🔒 **Güvenlik:** ${hasSSL ? '✅ SSL sertifikası var (HTTPS)' : '⚠️ SSL sertifikası yok (HTTP)'}\n\n`;
        
        analysis += `🛠️ **Tespit Edilen Teknolojiler:** ${techStack.join(', ') || 'Belirlenemedi'}\n\n`;
        
        analysis += `📱 **Sosyal Medya:**\n`;
        analysis += `   • Tür: ${social.ogType}\n`;
        analysis += `   • Twitter Card: ${social.twitterCard}\n`;
        analysis += `   • OG Image: ${social.ogImage !== 'Yok' ? 'Var' : 'Yok'}\n\n`;
        
        analysis += `📄 **Ana İçerik (ilk 3000 karakter):**\n${mainContent}`;
        
        return analysis;

    } catch (err) {
        return `❌ Site analiz edilemedi: ${url}\nHata: ${err.message}`;
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
        { name: 'Angular', pattern: /angular|ng-version|x-ng/ },
        { name: 'Next.js', pattern: /_next\/|next\.js|nextjs/ },
        { name: 'Nuxt.js', pattern: /__nuxt|_nuxt/ },
        { name: 'WordPress', pattern: /wp-content|wp-includes|wordpress/ },
        { name: 'jQuery', pattern: /jquery[\.-]|jquery-/ },
        { name: 'Bootstrap', pattern: /bootstrap[\./]|bootstrap-/ },
        { name: 'Tailwind CSS', pattern: /tailwindcss|tailwind-|tailwind\.css/ },
        { name: 'Google Analytics', pattern: /google-analytics|analytics\.js|ga\(|__gaTracker/ },
        { name: 'Facebook Pixel', pattern: /facebook\.com.*fbevents|connect\.facebook/ },
        { name: 'Cloudflare', pattern: /cloudflare|__cf_email|_cf电力/ },
        { name: 'Font Awesome', pattern: /font-awesome|fa-solid|fa-brands/ },
        { name: 'Google Fonts', pattern: /fonts\.googleapis|fonts\.gstatic/ },
        { name: 'Stripe', pattern: /stripe\.com|js\.stripe/ },
        { name: 'WooCommerce', pattern: /woocommerce|wc-api/ },
        { name: 'Laravel', pattern: /laravel_session|_token/i },
        { name: 'Node.js', pattern: /node_modules|\.node/ },
        { name: 'PHP', pattern: /\.php|pHP/i },
        { name: 'TypeScript', pattern: /\.ts\"|typescript/ },
        { name: 'Webpack', pattern: /webpack/ },
        { name: 'Vite', pattern: /vite/ },
        { name: 'Svelte', pattern: /svelte/ },
        { name: 'Shopify', pattern: /shopify|my-shopify/ },
        { name: 'Wix', pattern: /wix\.com|wixsite/ },
        { name: 'Squarespace', pattern: /squarespace/ },
        { name: 'HubSpot', pattern: /hubspot|hs-script/ },
        { name: 'Mailchimp', pattern: /mailchimp|list-manage/ },
        { name: 'Hotjar', pattern: /hotjar|hj\./ },
        { name: 'Intercom', pattern: /intercom|ic-widget/ },
        { name: 'Zendesk', pattern: /zendesk|zendesk_api/ },
        { name: 'Disqus', pattern: /disqus|disqus_config/ },
        { name: 'Gravatar', pattern: /gravatar/ }
    ];
    
    techPatterns.forEach(({ name, pattern }) => {
        if (pattern.test(lowerHtml)) {
            techs.push(name);
        }
    });
    
    return [...new Set(techs)].slice(0, 10);
}

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
