# Repo Pilot · Çoklu Proje Geliştirici Komuta Merkezi & Takvim Sistemi

Geliştiricilerin onlarca GitHub reposundaki `yapilacaklar.md` (veya `TODO.md`) dosyalarını tek bir merkezi ekranda toplayan, önceliklendiren, interaktif aylık takvime döken, sürükle-bırak yeniden planlama sağlayan, sprint/milestone yol haritaları oluşturan, güvenli iCal akışı sunan ve Telegram sabah brifingleri ileten profesyonel komuta merkezi.

---

## ⚡ Canlı Erişim

Sunucunuz arka planda çalışmaktadır:

👉 **[http://localhost:3000](http://localhost:3000)**

---

## 🧭 5 Ana Profesyonel Görünüm Modu

1. **🗂️ Proje Kartları (Grid View):**
   - Her proje için ayrı kart.
   - **Proje Sağlık Skoru (Health Score):** 100 üzerinden `A+`, `B`, `C`, `F` dinamik derecelendirme.
   - **Bayatlayan Proje Radarı (Stale Alert):** 14 günden uzun süredir commit atılmamış ve acil görevi olan projelere otomatik `⚠️ İhmal Edildi` uyarısı.
   - İlerleme çubuğu, görev listesi, GitHub Issue'ya dönüştürme ve tek tıkla yeni görev ekleme.
2. **📊 Merkezi Kanban Panosu (Cross-Repo Kanban):**
   - Tüm projelerdeki görevler tek bir ekranda:
     - 🔴 `P1 · Acil Havuzu`
     - 🟡 `P2 · Sıradakiler`
     - 🔵 `P3 · Düşük / İkincil`
     - 🟢 `Tamamlananlar`
   - Kartların üzerindeki butonlarla görevlerin önceliklerini 1 tıkla değiştirme ve anında GitHub'a commit atma!
3. **📅 İnteraktif Takvim & Planlama (Calendar & Timeline):**
   - **Aylık Takvim Görünümü & Sürükle-Bırak:** Görev haplarını takvim günleri arasında sürükleyip bırakarak teslim tarihlerini anında güncelleyin.
   - **Doğrulanmış İş Yükü Gösterimi:** Günlük saat yükü sadece bekleyen işleri sayar; tüm görevleri tamamlanan günler yeşil `✓ Bitti` rozetiyle ödüllendirilir.
   - **Geciken Görevler Radarı (Overdue Tasks):** Teslim tarihi geçmiş görevleri kırmızı uyarı ışığıyla yakalar.
   - **Günlük Ajanda & Planlama Çekmecesi:** Takvimde herhangi bir güne tıklayarak o günün detaylarını görebilir, boşta bekleyen görevleri o güne atayabilirsiniz.
   - **Sürüm & Sprint Yol Haritası (Milestones):** `%v1.0`, `%Sprint-42`, `%MVP` etiketli işlerin tamamlanma yüzdeleri ve kalan saat tahminleri.
   - **Güvenli iCal Takvim Aboneliği:** Google Calendar, Apple Calendar ve Outlook için güvenli token korumalı besleme URL'si (dış HTTPS adres desteği dahil).
4. **🎯 Günlük Odak & Pomodoro (Daily Focus):**
   - Görevlerin yanındaki **Yıldız (⭐)** butonuna basarak günün 3-5 odağını belirleyin.
   - Farklı modlardan kalan veya silinmiş repolara ait görevler için açık durum rozetleri.
   - API başarısı teyit edilmeden yerel kayıt değiştirilmez; kaynak dosya doğrudan güncellenir.
   - Entegre **Pomodoro Zamanlayıcısı** (25dk Çalışma / 5dk Mola) ve sesli bildirim desteği.
5. **🔍 Kod İçi `// TODO:` & `// FIXME:` Tarayıcısı:**
   - Yapılandırılan yerel proje klasörünü tarayarak kaynak kodlardaki görevleri otomatik listeler.
   - Canlı modda sahte veri göstermez; net rehberlik sunar.
   - **"P1 Yapılacaklara Ekle"** butonu ile gerçek repo sahibi, adı ve dosyasına tek tıkla aktarır.

---

## 📝 Zengin Markdown Formatı (`yapilacaklar.md`)

Görevlerinize teslim tarihi, tahmini efor ve sürüm/milestone ekleyebilirsiniz:

```markdown
# Proje Yapılacaklar Listesi

- [ ] [P1] Ödeme sağlayıcı webhook'unda oluşan timeout hatasını çöz @backend #critical ~2026-10-28 (est: 3h) %v1.0
- [ ] [P1] Redis token blacklist için TTL optimizasyonu yap #redis ~2026-10-29 (est: 2h) %v1.0
- [ ] [P2] Swagger / OpenAPI 3.0 dokümantasyonunu güncelle ~2026-10-31 (est: 4h) %v1.0
- [ ] [P2] Rate-limiting middleware için IP bazlı whitelist ekle ~2026-11-03 (est: 2h) %v1.1
- [ ] [P3] Log formatını JSON Structured standardına geçir ~2026-11-08 (est: 1d) %v1.1
- [x] [P1] JWT token süresi dolunca otomatik refresh akışını tamamla ~2026-10-25 (est: 4h) %v1.0 (#42)
```

*Sözdizimi İpuçları:*
- **Tarih:** `~2026-10-30` veya `[deadline: 2026-10-30]`
- **Tahmini Süre:** `(est: 2h)` veya `(4h)` veya `(1d)` veya `(30m)`
- **Sürüm / Milestone:** `%v1.0` veya `[milestone: Sprint-42]`
- **GitHub Issue:** `(#42)`

---

## 💻 Terminalden Yönetim (Repo Pilot CLI)

CLI oturum yönetimi ile güvenli bir şekilde sunucuya bağlanır:

```bash
# Takvim, gecikenler ve milestone yol haritasını terminalden gör:
npm run cli -- cal

# Tüm projelerin sağlık raporunu ve görev sayılarını listele:
npm run cli -- list

# Sadece kritik P1 acil görevleri listele:
npm run cli -- p1

# Bir projeye yeni görev ekle (tam veya tekil eşleşme):
npm run cli -- add e-ticaret P1 "Ödeme hatasını çöz @backend"

# Telegram sabah özetini telefonuna gönder:
npm run cli -- digest
```

*CLI Özellikleri:*
- Tam repo adı eşleşmesine öncelik verir; birden fazla proje eşleştiğinde belirsiz seçimi reddeder ve liste sunar.
- Hata durumlarında standart `exit code 1` döndürür.

---

## 📱 Güvenlik, Takvim & Telegram Entegrasyonları

- **Oturum & Güvenlik Mimarisi:** Oturum çerezleri HMAC-SHA256 imzalıdır, CSRF koruması aktiftir. Ayarlar `.repopilot/settings.json` (veya geriye dönük uyumlu `.taskdeck/settings.json`) dosyasında `0600` izinleriyle saklanır.
- **Google / Apple Takvim Aboneliği:**  
  Arayüzdeki **"iCal / Google Takvim URL"** butonuna basıldığında token ile korunmuş güncel besleme linki panoya kopyalanır. Dışarıdan erişim için Settings menüsünden `https://` takvim adresi tanımlanabilir.
- **Telegram Sabah Özeti Botu:**  
  Ayarlar menüsünden bot token girildiğinde her sabah saat **09:00'da** gecikmiş görevler, bugünün teslimleri, bu haftanın iş yükü ve P1 acil işler telefonunuza iletilir. Mesajlar HTML kaçış korumalı ve 4000 karakter sınırına uygundur.
