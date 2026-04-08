# Tegirmon Bot

Bu bot Tegirmon (un va yem ishlab chiqaruvchi sex) uchun mijozlarga xizmat ko'rsatish va buyurtmalarni qabul qilish uchun mo'ljallangan. Node.js va Telegraf kutubxonasida yozilgan.

## Texnologiyalar
- Node.js
- Telegraf (Telegram bot API)
- dotenv (Atrof-muhit o'zgaruvchilarini boshqarish)

## Qanday ishga tushirish kerak?

1. Node.js o'rnatilganiga ishonch hosil qiling (https://nodejs.org/).
2. Ushbu loyihani o'zingizning kompyuteringizga oling yoki papkani oching.
3. Terminalda (Command Prompt yoki PowerShell) loyiha papkasiga kiring va kutubxonalarni o'rnating:
   ```bash
   npm install
   ```
4. Loyiha papkasida `.env` nomli yangi fayl yarating (yoki `.env.example` faylidan nusxa oling va nomini `.env` deb o'zgartiring).
5. `.env` fayli ichiga quyidagi ma'lumotlarni kiriting:
   ```env
   BOT_TOKEN=BU_YERGA_BOTFATHERDAN_OLINGAN_TOKENNI_YOZING
   ADMIN_CHAT_ID=BU_YERGA_O_ZINGIZNING_TELEGRAM_ID_RAQAMINGIZNI_YOZING
   ```
   *(Telegram ID ni bilish uchun @userinfobot yoki shunga o'xshash botlardan foydalanishingiz mumkin)*
6. Botni ishga tushiring:
   ```bash
   npm start
   ```

## Admin imkoniyatlari
Bot ishlashni boshlagandan so'ng, admin sifatida ro'yxatdan o'tgan foydalanuvchi Telegramda botga `/admin` deb yozsa, bot jami mijozlar soni va buyurtmalar statistikasini ko'rsatadi. Har bir yangi buyurtma adminga bildirishnoma sifatida yuboriladi.
