# kumsal-rules

Kumsal iOS uygulamasının **web köprüsü kural dosyası** (`rules.json`) ve bu kuralları her gece
canlı sitelere karşı sınayan **kanarya**.

`rules.json` yalnız **yapılandırma verisidir**: CSS seçicileri, URL kalıpları (düzenli ifade),
eşikler, süreler ve özellik bayrakları. Çalıştırılabilir kod içermez. Uygulama dosyayı açılışta
ve 24 saatte bir arka planda çeker (ETag / If-Modified-Since, 5 sn), doğrular, önbelleğe alır;
çekemezse pakete gömülü kopyayı kullanır.

## Ne işe yarar

Google'ın sonuç sayfası ya da bir akor sitesinin HTML yapısı değişince, mağaza sürümü beklemeden
seçicileri burada güncellemek. Bayraklar (`flags`) bir özelliği uzaktan kapatır:

| Bayrak | Kapalıyken |
|---|---|
| `serpListEnabled` | Köprü araması normal Google sayfasıyla açılır (sonuç listesi yok) |
| `genericCaptureEnabled` | Arama motorundan tanınmayan siteye dokunuş yakalanmaz |
| `smartPreviewEnabled` | Hiçbir bağlantı yakalanmaz (akıllı önizleme tamamen kapalı) |

## Nasıl güncellenir (elle)

1. `rules.json`'da değeri düzelt, **`version`'ı 1 artır**, `updatedAt`'i güncelle.
   Uygulama sürümü düşük ya da şeması/değerleri geçersiz bir dosyayı **reddeder** ve önceki
   geçerli kurallarla devam eder — bozuk bir yayın uygulamayı bozamaz.
2. Yerelde sına: `npm ci && mkdir -p canary/bin && swiftc -O canary/fetch.swift -o canary/bin/fetch && node canary/check.mjs`
3. `main`'e push et. Uygulamalar 24 saat içinde (ya da sonraki açılışta) alır.

Alan ekleme/silme uygulama güncellemesi gerektirir (eski uygulamalar yeni şemayı reddeder).

## Gece kanaryası

`.github/workflows/canary.yml` — her gece 03:30 UTC ve elle (Actions → canary → Run workflow).

1. `canary/check.mjs`: `canary/fixtures/fixtures.json`'daki durağan şarkı sayfalarını (akorlar.com,
   akorlab.com, Ultimate Guitar) çeker, kural seçicilerini uygular, sonucu yer gerçeğiyle
   (başlık, sanatçı, birkaç akor, kısa söz parçaları) karşılaştırır. Google için sabit sorguda
   asgari organik sonuç sayısına bakar.
   - Cloudflare doğrulaması ve Google izin/JavaScript sayfası **belirsiz** sayılır, hata değil.
2. Bir kaynak kırıksa `canary/fix.mjs` koşar: güncel HTML'i kırpıp Claude'a (Haiku) gönderir,
   yalnız o kaynağın seçici değerleri için aday alır. **Doğrulama kapısı:** aday kurallarla kontrol
   yeniden koşar; geçerse `version+1` ile bot commit'i atılır
   (`canary: <kaynak> seçicileri otomatik tazelendi`), geçmezse hiçbir şey yazılmaz ve issue açılır.
   Korkuluklar: koşu başına en çok 1 tamir; betik yalnız `rules.json` yazar; şema alanı eklenemez,
   silinemez.

Kuru koşu (API anahtarı gerekmez): `node canary/fix.mjs --dry-run --mock-response yanit.json [--snapshots dizin]`

## Mac mini'de gece koşusu (birincil)

akorlar.com Cloudflare'i GitHub'ın veri merkezi IP'lerini engelliyor (19.11.2026 ilk koşu: 403,
"belirsiz"); ev bağlantısı geçiyor. Bu yüzden kanarya her gece 03:00'te (yerel saat) Mac mini'de
`canary/run-local.sh` ile koşar; GitHub iş akışı (03:30 UTC) yedektir.

Kurulum (bir kez, kalıcı kopyada — `~/projects/kumsal-rules`):

```
canary/install-local.sh                                    # launchd kaydı
security add-generic-password -U -s kumsal-canary -a anthropic -w   # Anthropic anahtarı (sorar)
launchctl kickstart gui/$(id -u)/com.kumsal.canary         # elle bir koşu
tail -n 20 ~/Library/Logs/kumsal-canary/canary.log
```

Gereksinimler: Mac mini açık ve kullanıcı oturumu açık (anahtarlık erişilebilir); `git push` ve
`gh` (issue) için GitHub kimliği geçerli. Ağ yoksa koşu sessizce atlanır (yanlış alarm yok).

## Issue açılırsa

"KANARYA: <kaynak> kırık, otomatik tamir başarısız" — issue gövdesinde düşme nedenleri ve (varsa)
reddedilen aday durur.

1. Sayfayı tarayıcıda aç; yapı mı değişti, sayfa mı kalktı (404), yoksa bot duvarı mı?
2. Sayfa kalktıysa `fixtures.json`'da başka durağan bir şarkıya geç.
3. Yapı değiştiyse seçiciyi elle düzelt (yukarıdaki "Nasıl güncellenir"), `node canary/check.mjs`
   yeşil olunca push et, issue'yu kapat.
4. Acil durumda ilgili bayrağı `false` yap (`version+1`) — özellik uygulamalarda sessizce kapanır,
   köprü eski davranışıyla çalışır.

## Geri alma (rollback)

Bozuk bir kural yayınlandıysa: `git revert <commit>` → `version` **yine artırılmalı** (uygulama
düşük sürümü reddeder). Yani revert'ten sonra `version`'ı son yayınlanandan büyük yapıp push et.

## Sınırlar

- Google kontrolü düz istekle neredeyse her zaman "belirsiz" kalır (Google JavaScript istiyor);
  SERP seçicilerinin gerçek sınaması uygulamanın içindeki tarayıcıda olur
  (`bridge.serpExtractFailed` telemetrisi).
- GitHub'ın macOS makineleri veri merkezi IP'sidir; Cloudflare onları da sorgularsa kaynak
  "belirsiz" kalır (yanlış alarm ve yanlış "tamir" olmaz, ama o gece sınanmamış olur).
