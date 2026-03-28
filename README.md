# RLM 5 - G63 AI Assistant

![RLM 5](https://img.shields.io/badge/RLM%205-v1.0.0-0881F0?style=for-the-badge)
![License](https://img.shields.io/badge/License-MIT-green?style=for-the-badge)
![Framework](https://img.shields.io/badge/Framework-Vercel-black?style=for-the-badge)

> G63 tarafından geliştirilen, GLM-4-9B ile desteklenen Türkçe yapay zeka asistanı.

## Özellikler

- 🤖 **GLM-4-9B-Chat** - Hugging Face üzerinde çalışan güçlü AI modeli
- 🌐 **Türkçe Destek** - Türkçe konuşan yapay zeka asistanı
- 🎨 **Modern Arayüz** - Z.ai tarzı şık ve minimal tasarım
- 🌙 **Karanlık Mod** - Göz yorgunluğunu azaltan karanlık tema
- 💾 **Sohbet Geçmişi** - localStorage ile sohbet kaydı
- ⚡ **Deep Think** - Derin analiz modu
- 📱 **Responsive** - Mobil uyumlu tasarım

## Kurulum

### Gereksinimler

- Node.js 18+
- Vercel CLI
- Hugging Face API Token

### 1. Projeyi İndirin

```bash
git clone <repo-url>
cd rlm
```

### 2. Hugging Face Token Alın

1. [Hugging Face](https://huggingface.co) hesabı oluşturun
2. [Settings > Access Tokens](https://huggingface.co/settings/tokens) sayfasına gidin
3. **New Token** butonuna tıklayın
4. Token type: `Read`
5. Token'ı kopyalayın

### 3. Yerel Geliştirme

```bash
# Vercel CLI'yi yükleyin (yoksa)
npm install -g vercel

# Proje klasörüne gidin
cd rlm

# Vercel ile yerel çalıştırın
vercel dev
```

### 4. Vercel'a Deploy Edin

#### Seçenek A: Vercel CLI

```bash
# Vercel'de oturum açın
vercel login

# Deploy edin
vercel

# Production'a deploy
vercel --prod
```

#### Seçenek B: GitHub ile Otomatik Deploy

1. Projeyi GitHub'a yükleyin
2. [vercel.com](https://vercel.com) adresinde **New Project** seçin
3. GitHub reposunu bağlayın
4. **Environment Variables** bölümünde:
   - Name: `HF_TOKEN`
   - Value: Hugging Face token'ınız

## Ortam Değişkenleri

| Değişken | Açıklama | Zorunlu |
|----------|----------|---------|
| `HF_TOKEN` | Hugging Face API Token | ✅ |

### Vercel'de Ortam Değişkeni Ayarlama

1. Vercel Dashboard > Proje > Settings
2. **Environment Variables** bölümüne gidin
3. Ekle:
   - Name: `HF_TOKEN`
   - Value: `hf_xxxxxxxxxx`
   - Environments: All

## Proje Yapısı

```
rlm/
├── index.html      # Ana uygulama (Frontend)
├── api/
│   └── chat.js    # API Endpoint (Backend)
├── package.json   # Bağımlılıklar
├── vercel.json    # Vercel yapılandırması
└── README.md      # Dokümantasyon
```

## API Kullanımı

### Endpoint

```
POST /api/chat
```

### İstek (Request)

```json
{
  "message": "Merhaba, nasılsın?",
  "history": [
    { "role": "user", "content": "Önceki mesaj" },
    { "role": "assistant", "content": "Önceki yanıt" }
  ],
  "autoThink": true
}
```

### Yanıt (Response)

```json
{
  "reply": "Merhaba! Ben RLM 5, size nasıl yardımcı olabilirim?"
}
```

### Hata Yanıtları

```json
{
  "error": "Hata mesajı"
}
```

## Model Hakkında

Kullanılan model: **THUDM/glm-4-9b-chat**

- **Geliştirici:** THUDM (Zhipu AI)
- **Tür:** Chat LLM
- **Platform:** Hugging Face
- **Ücretsiz:** Evet (Rate limit dahilinde)

### Rate Limit

- Hugging Face Inference API ücretsiz katmanında saatlik limit vardır
- Model ilk çağrıda "uyandırılması" gerekebilir (20-60 saniye)

## Sorun Giderme

### "Model yükleniyor" hatası

- Hugging Face modeli uyku modunda olabilir
- 30-60 saniye bekleyip tekrar deneyin
- [Model sayfasını](https://huggingface.co/THUDM/glm-4-9b-chat) ziyaret ederek modelin aktif olduğundan emin olun

### Token hatası

- Hugging Face token'ının geçerli olduğunu kontrol edin
- Token'ın "Read" izinli olduğundan emin olun
- Vercel ortam değişkenlerini doğru ayarladığınızdan emin olun

### CORS hatası

- API istekleri Vercel üzerinden yapılmalı
- localStorage'da token varsa kaldırın

## Teknolojiler

- **Frontend:** HTML5, Tailwind CSS, Vanilla JavaScript
- **Backend:** Node.js, Vercel Functions
- **AI:** GLM-4-9B-Chat (Hugging Face)
- **İkonlar:** Lucide Icons
- **Font:** Inter (Google Fonts)

## Lisans

MIT License - G63

## İletişim

- **Geliştirici:** G63
- **AI Model:** THUDM / Zhipu AI

---

> RLM 5, ❤️ ile G63 tarafından geliştirilmiştir.
