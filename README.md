# GestureFlow Kontrol

GestureFlow Kontrol, YouTube ve standart HTML5 video oynatıcılarını kamera tabanlı el/yüz takibiyle kontrol eden Manifest V3 Chrome uzantısıdır. Görüntü işleme Chrome içinde yerel çalışır; kamera kareleri sunucuya gönderilmez.

## Özellikler

- Açılır pencere üzerinden hedef video sekmesini görme, kontrolü başlatma/durdurma ve ayarları yönetme
- Arka planda çalışan offscreen kamera oturumu
- Kamera izni engellenirse görünür `camera-permission` sekmesiyle yedek başlatma akışı
- HTTP/HTTPS sayfalarında otomatik HTML5 video seçimi
- Sayfa üzerinde sade canlı takip bildirimi
- El hareketleriyle oynat, duraklat, ileri/geri sar, ses artır/azalt
- Yüz ekrandan uzaklaşınca veya gözler kapalı kalınca otomatik duraklatma

## Geçerli Mimari

- `popup/`: ana kullanıcı arayüzü, durum özeti, başlat/durdur düğmesi ve ayarlar
- `background/`: sekme durumu, kontrol durumu, rozetler, offscreen belge ve mesaj yönlendirme
- `offscreen/`: normal akışta kamera oturumunu arka planda çalıştırır
- `camera-permission/`: kamera izni arka planda alınamazsa görünür yedek kontrol sekmesi
- `content/`: sayfadaki videoyu bulur, medya komutlarını uygular ve overlay gösterir
- `gesture/`: MediaPipe el/yüz modellerini başlatır, hareketleri sınıflandırır, kararlı komut üretir
- `shared/`: tipler, varsayılan ayarlar, mesaj sözleşmeleri ve storage yardımcıları

Komut akışı:

```text
Kamera -> MediaPipe -> gesture/session.ts -> background -> content/video-controller.ts -> HTML5 video
```

## Hareketler

- Açık avuç: oynat
- Kapalı yumruk: duraklat
- Başparmak sağa basılı tutma: ileri sar
- Başparmak sola basılı tutma: geri sar
- Başparmak yukarı basılı tutma: sesi artır
- Başparmak aşağı basılı tutma: sesi azalt

Yüz korumaları el görünmüyorken çalışır:

- Ekrandan uzak bakma belirlenen süreyi geçerse video duraklatılır.
- Gözler belirlenen süre kapalı kalırsa video duraklatılır.
- Ekrana tekrar bakma yeterince uzun sürerse oynatma devam eder.

## Kurulum ve Çalıştırma

Bağımlılıkları yükleyin:

```powershell
npm install
```

Uzantıyı derleyin:

```powershell
npm run build
```

Bu komut yüklenebilir uzantıyı `dist/` klasörüne üretir. Eksikse MediaPipe model dosyalarını indirir ve gerekli WASM dosyalarını kopyalar.

Chrome'da yükleme:

1. `chrome://extensions` adresini açın.
2. Developer mode seçeneğini açın.
3. `Load unpacked` seçin.
4. Bu repo içindeki `dist/` klasörünü seçin.

Geliştirme sırasında izleme modu:

```powershell
npm run dev
```

## Hızlı Test

1. Uzantıyı `dist/` klasöründen yükleyin.
2. YouTube veya standart `<video>` kullanan bir sayfa açın.
3. Uzantı simgesine tıklayın.
4. Popup içinde video durumunun hazır olduğunu doğrulayın.
5. `Başlat` düğmesine basın.
6. Kamera iznini onaylayın. Gerekirse açılan `GestureFlow Kamera` sekmesini açık bırakın.
7. Açık avuç, kapalı yumruk, başparmak sağ/sol/yukarı/aşağı hareketlerini deneyin.
8. Sayfadaki overlay ve popup durumlarının komutları güncellediğini kontrol edin.

## Geliştirici Doğrulaması

```powershell
npx tsc --noEmit
npm run build
git diff --check
```

## Bilinen Sınırlar

- Uzantı evrensel video desteği için HTTP/HTTPS host erişimi ister.
- Bazı özel oynatıcılar gerçek `<video>` öğesini gizlediği için ek platform uyarlaması gerektirebilir.
- Kamera izni Chrome/işletim sistemi ayarları tarafından engellenirse kullanıcı izni elle düzeltmelidir.
- Oynatma hızı komutları altyapıda tutulur, ancak şu an atanmış kullanıcı hareketi olmadığı için popup içinde gösterilmez.

## Gelecek İyileştirmeler

- Per-site ayarlar
- Özelleştirilebilir hareket eşleştirmeleri
- Daha ayrıntılı options sayfası
- Chrome Web Store yayın kontrol listesi, ekran görüntüleri ve gizlilik metni
