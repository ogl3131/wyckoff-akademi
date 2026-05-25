# Wyckoff Academy

Bu depo, Wyckoff Trade Akademisi'nin frontend (arayüz) kodlarını ve Zero-Trust HLS Video (Kırılmaz Oynatıcı) altyapısını içermektedir.

## Mimari Özellikleri
- **Supabase Auth:** JWT tabanlı güvenli giriş.
- **Tekli Aktif Oturum (Single Active Session):** Aynı anda iki farklı cihazdan izlemeyi engeller.
- **Zero-Trust HLS Player:** Frontend üzerinde sır tutulmaz, dinamik IP-bound tokenlar ile `.ts` video parçaları korunur.
- **Sıfır Sunucu (Serverless):** GitHub Pages üzerinde barındırılır ve Supabase Edge Functions ile haberleşir.
