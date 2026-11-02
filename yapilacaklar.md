# Proje Yapılacaklar Listesi

> Bu dosya TaskDeck web paneli tarafından otomatik olarak taranır ve öncelik derecelerine göre sıralanır.

## Öncelik Seviyeleri:
- **[P1]** veya **[Acil]**: En yüksek öncelik. Kartın en tepesinde kırmızı uyarı rozetiyle gösterilir.
- **[P2]** veya **[Orta]**: Normal öncelik. Sarı rozet.
- **[P3]** veya **[Düşük]**: İkincil / Acil olmayan işler. Mavi rozet.
- **[P4]** veya **[Fikir]**: İleride yapılabilecek fikirler / backlog. Gri rozet.

---

### Bekleyen Görevler
- [ ] [P1] Ödeme sağlayıcı webhook'unda oluşan timeout hatasını çöz @backend #critical
- [ ] [P1] Veritabanı bağlantı havuzunu (connection pool) optimize et #database
- [ ] [P2] Swagger API dokümantasyonunu OpenAPI 3 standardına güncelle
- [ ] [P2] Kullanıcı kayıt akışına e-posta doğrulama adımı ekle
- [ ] [P3] Loglama formatını JSON structured formata taşı
- [ ] [P4] İleride GraphQL desteği eklemeyi araştır

### Tamamlananlar
- [x] [P1] JWT token süresi dolunca otomatik refresh akışını tamamla
- [x] [P2] Docker compose dosyasını modernize et
