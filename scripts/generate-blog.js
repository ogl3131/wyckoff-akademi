const fs = require('fs');
const path = require('path');

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

if (!GEMINI_API_KEY) {
    console.error("HATA: GEMINI_API_KEY çevre değişkeni tanımlanmamış!");
    process.exit(1);
}

// Görseller için popüler Unsplash finans/trade koleksiyonu bağlantıları
const unsplashImages = [
    "https://images.unsplash.com/photo-1611974789855-9c2a0a7236a3?auto=format&fit=crop&w=1200&q=80",
    "https://images.unsplash.com/photo-1590283603385-17ffb3a7f29f?auto=format&fit=crop&w=1200&q=80",
    "https://images.unsplash.com/photo-1642390061910-0f7121b24ccb?auto=format&fit=crop&w=1200&q=80",
    "https://images.unsplash.com/photo-1621761191319-c6fb62004040?auto=format&fit=crop&w=1200&q=80",
    "https://images.unsplash.com/photo-1559526324-4b87b5e36e44?auto=format&fit=crop&w=1200&q=80",
    "https://images.unsplash.com/photo-1618042164219-62c820f10723?auto=format&fit=crop&w=1200&q=80",
    "https://images.unsplash.com/photo-1620228883793-f300b6d61d0a?auto=format&fit=crop&w=1200&q=80"
];

async function generateArticle(retries = 5, initialDelay = 3000) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`;
    
    const prompt = `Sen Wyckoff ve Price Action konusunda uzman, Türkçe içerik üreten profesyonel bir finans yazarısın. Wyckoff Akademi web sitesi için Google SEO uyumlu, 'trade eğitimi', 'borsa eğitimi', 'Price Action', 'Wyckoff Metodolojisi', 'kripto para' ve 'teknik analiz' gibi anahtar kelimeleri doğal bir şekilde barındıran, zengin içerikli ve bilgilendirici bir blog yazısı yazacaksın.
Yazı dili samimi ama son derece profesyonel olmalıdır.
İçerikte şunlar yer almalıdır:
- Giriş paragrafı (okuyucunun dikkatini çeken, sorunu tanımlayan)
- Alt başlıklar (h3 etiketleriyle, class'ı 'font-display font-bold text-white text-base md:text-lg mt-6 mb-3 border-l-4 border-brand-primary pl-3' olmalıdır)
- Açıklayıcı ve eğitici listeler (ul ve li etiketleriyle, list-disc pl-6 space-y-2.5 text-gray-400 text-sm md:text-base)
- Önemli noktalar veya tanımlar için şık paneller (class'ı 'glass-panel p-4 rounded-xl border border-dark-border text-left bg-dark-bg/25 mb-4' olan div'ler)
- Güçlü vurgular için strong etiketleri.
- Sonuç veya harekete geçirici mesaj (öğrencinin Wyckoff Akademi'ye ücretsiz katılmasını teşvik eden).

Aşağıdaki konulardan biri üzerine odaklan (her çalışmada farklı bir konu seçmeye çalış):
1. Price Action konseptleri (MSS, BOS, Order Block, Liquidity Sweep, FVG - Fair Value Gap, OTE - Optimal Trade Entry).
2. Wyckoff Metodolojisi (Bileşik Adam teorisi, Birikim/Dağıtım fazları, Faz A-E arası analizler, Spring ve UTAD sahte kırılımları).
3. Trade psikolojisi ve disiplini (FOMO, Revenge trading, aşırı güven, disiplinli günlük tutma).
4. Profesyonel risk yönetimi (Kasa yönetimi, %1-2 risk kuralı, R:R oranları, stop-loss psikolojisi).
5. Kripto para ve borsa analiz yöntemleri (Hacim analizi, kurumsal emir akışı).`;

    const requestBody = {
        contents: [{
            parts: [{ text: prompt }]
        }],
        generationConfig: {
            responseMimeType: "application/json",
            responseSchema: {
                type: "OBJECT",
                properties: {
                    title: { type: "STRING" },
                    category: { type: "STRING" },
                    readTime: { type: "STRING" },
                    contentHtml: { type: "STRING" }
                },
                required: ["title", "category", "readTime", "contentHtml"]
            }
        }
    };

    let delay = initialDelay;
    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            console.log(`Gemini API çağrısı yapılıyor... (Deneme ${attempt}/${retries})`);
            const response = await fetch(url, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(requestBody)
            });

            if (response.status === 503 || response.status === 429) {
                console.warn(`Geçici Google API Hatası (${response.status}). ${delay}ms sonra tekrar denenecek...`);
                await new Promise(resolve => setTimeout(resolve, delay));
                delay *= 2; // Üstel bekleme süresini artır
                continue;
            }

            if (!response.ok) {
                const errText = await response.text();
                throw new Error(`Gemini API hatası: ${response.status} - ${errText}`);
            }

            const data = await response.json();
            const resultText = data.candidates[0].content.parts[0].text;
            const article = JSON.parse(resultText);

            // Rastgele resim ata
            const randomImage = unsplashImages[Math.floor(Math.random() * unsplashImages.length)];
            article.image = randomImage;

            return article;
        } catch (error) {
            console.error(`Deneme ${attempt} başarısız oldu:`, error.message);
            if (attempt === retries) throw error;
            await new Promise(resolve => setTimeout(resolve, delay));
            delay *= 2;
        }
    }
}

async function main() {
    try {
        const indexPath = path.join(__dirname, '..', 'index.html');
        let html = fs.readFileSync(indexPath, 'utf8');

        // Mevcut ID'leri bulup bir sonrakini belirleme
        const ids = [...html.matchAll(/(\d+):\s*\{\s*title:/g)].map(m => parseInt(m[1], 10));
        const nextId = ids.length > 0 ? Math.max(...ids) + 1 : 1;

        console.log(`Yeni makale ID'si: ${nextId}`);

        const article = await generateArticle();

        const trDate = new Date().toLocaleDateString('tr-TR', {
            day: 'numeric',
            month: 'long',
            year: 'numeric'
        });

        // HTML içindeki template literal çakışmalarını önlemek için kaçış işlemleri
        const contentHtmlEscaped = article.contentHtml.replace(/`/g, '\\`').replace(/\${/g, '\\${');

        const newArticleString = `                ${nextId}: {
                    title: "${article.title.replace(/"/g, '\\"')}",
                    category: "${article.category}",
                    date: "${trDate}",
                    readTime: "${article.readTime}",
                    image: "${article.image}",
                    contentHtml: \`
${contentHtmlEscaped}
                    \`
                },`;

        // blogArticles: { altına ekle
        const target = "blogArticles: {";
        const replacement = `${target}\n${newArticleString}`;
        
        if (!html.includes(target)) {
            throw new Error("index.html dosyasında 'blogArticles: {' bulunamadı!");
        }

        html = html.replace(target, replacement);
        fs.writeFileSync(indexPath, html, 'utf8');
        
        console.log(`BAŞARILI: "${article.title}" başlıklı yeni makale index.html'e eklendi!`);
    } catch (e) {
        console.error("Hata oluştu:", e);
        process.exit(1);
    }
}

main();
