require('dotenv').config();
const { Telegraf, Markup, session, Scenes } = require('telegraf');
const fs = require('fs');

// Bot tokenini va admin chat ID sini env dan olish
const bot = new Telegraf(process.env.BOT_TOKEN);
const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID;

// Sodda JSON baza yaratish yoki borini o'qish
const dbPath = './db.json';
let db = { users: [], ordersCount: 0 };
if (fs.existsSync(dbPath)) {
    db = JSON.parse(fs.readFileSync(dbPath, 'utf-8'));
}

// Baza fayliga yozish funksiyasi
const saveDb = () => {
    fs.writeFileSync(dbPath, JSON.stringify(db, null, 2));
};

// Asosiy menyu klaviaturasi
const mainMenu = Markup.keyboard([
    ['📋 Xizmatlarimiz', '💸 Narxlar'],
    ['🛒 Buyurtma berish', '📞 Bog\'lanish'],
    ['❓ Savollar', '💳 To\'lov uchun'],
    ['📍 Manzil / Lokatsiya']
]).resize();

// ---------------------------------------------------------------- //
// Buyurtma berish jarayoni uchun Wizard Scene (Ketma-ket savollar)
// ---------------------------------------------------------------- //
const orderWizard = new Scenes.WizardScene(
    'order-wizard',
    (ctx) => {
        // 1-qadam: Ismni so'rash
        ctx.reply("Iltimos, ismingizni kiriting:", Markup.keyboard([['⬅️ Orqaga']]).resize());
        ctx.wizard.state.order = {}; // Buyurtma obyekti
        return ctx.wizard.next();
    },
    (ctx) => {
        // 2-qadam: Telefon raqamni so'rash
        if (!ctx.message || !ctx.message.text) return;
        if(ctx.message.text === '⬅️ Orqaga') {
            ctx.reply("Buyurtma bekor qilindi.", mainMenu);
            return ctx.scene.leave();
        }
        ctx.wizard.state.order.name = ctx.message.text;
        ctx.reply("Telefon raqamingizni kiriting:", Markup.keyboard([['⬅️ Orqaga']]).resize());
        return ctx.wizard.next();
    },
    (ctx) => {
        // 3-qadam: Xizmat turini so'rash
        if (!ctx.message || !ctx.message.text) return;
        if(ctx.message.text === '⬅️ Orqaga') {
            ctx.reply("Buyurtma bekor qilindi.", mainMenu);
            return ctx.scene.leave();
        }
        ctx.wizard.state.order.phone = ctx.message.text;
        ctx.reply(
            "Qaysi xizmat kerak?",
            Markup.keyboard([
                ['Un qilish', 'Yem qilish'],
                ['Tegirmon uni sotib olish'],
                ['⬅️ Orqaga']
            ]).oneTime().resize()
        );
        return ctx.wizard.next();
    },
    (ctx) => {
        // 4-qadam: Necha kilogramm ekanligini so'rash
        if (!ctx.message || !ctx.message.text) return;
        if(ctx.message.text === '⬅️ Orqaga') {
            ctx.reply("Buyurtma bekor qilindi.", mainMenu);
            return ctx.scene.leave();
        }
        ctx.wizard.state.order.service = ctx.message.text;
        ctx.reply("Massa qancha (necha kilogramm)? (Iltimos, faqat raqam bilan yozing)", Markup.keyboard([['⬅️ Orqaga']]).resize());
        return ctx.wizard.next();
    },
    (ctx) => {
        // 5-qadam: Kilogrammni o'qish, hisoblash va izoh so'rash
        if (!ctx.message || !ctx.message.text) return;
        if(ctx.message.text === '⬅️ Orqaga') {
            ctx.reply("Buyurtma bekor qilindi.", mainMenu);
            return ctx.scene.leave();
        }
        
        let kgStr = ctx.message.text.trim();
        let kg = parseFloat(kgStr);
        if(isNaN(kg)) {
            ctx.reply("Iltimos, vaznni faqat raqam ko'rinishida kiriting (masalan: 100):");
            return;
        }
        ctx.wizard.state.order.kg = kg;

        // Narxni hisoblash
        let pricePerKg = 0;
        let serviceType = ctx.wizard.state.order.service;
        if(serviceType.includes('Un qilish')) {
            pricePerKg = 600;
        } else if(serviceType.includes('Yem qilish')) {
            pricePerKg = 500;
        } else if(serviceType.includes('sotib olish')) {
            pricePerKg = 5000;
        }

        let priceText = "";
        if(pricePerKg > 0) {
             let totalPrice = kg * pricePerKg;
             priceText = `${kg} kg x ${pricePerKg} so'm = ${totalPrice.toLocaleString()} so'm`;
        } else {
             priceText = `Buyurtma narxi menejer tomonidan aytiladi`;
        }
        ctx.wizard.state.order.priceText = priceText;

        ctx.reply(`✅ Siz tanlagan vazn: ${kg} kg.\n💰 Jami hisob-kitob: ${priceText}\n\nQo'shimcha izohingiz bormi? Agar bo'lmasa 'Yoq' deb yozing.`, Markup.keyboard([['⬅️ Orqaga']]).resize());
        return ctx.wizard.next();
    },
    (ctx) => {
        // Oxirgi qadam: Tugatish va adminga yuborish
        if (!ctx.message || !ctx.message.text) return;
        if(ctx.message.text === '⬅️ Orqaga') {
            ctx.reply("Buyurtma bekor qilindi.", mainMenu);
            return ctx.scene.leave();
        }
        ctx.wizard.state.order.comment = ctx.message.text;
        
        ctx.reply("Buyurtmangiz qabul qilindi! Tez orada aloqaga chiqamiz.", mainMenu);
        
        // Bazaga buyurtma sonini qo'shib saqlash
        db.ordersCount += 1;
        saveDb();
        
        // Adminga xabar yuborish
        const orderInfo = `🔔 YANGI BUYURTMA!\n\n👤 Kimdan: ${ctx.wizard.state.order.name}\n📞 Telefon: ${ctx.wizard.state.order.phone}\n🛠 Xizmat tur: ${ctx.wizard.state.order.service}\n⚖️ Vazni: ${ctx.wizard.state.order.kg} kg\n💵 Hisoblangan narx: ${ctx.wizard.state.order.priceText}\n📝 Izoh: ${ctx.wizard.state.order.comment}`;
        if(ADMIN_CHAT_ID) {
            bot.telegram.sendMessage(ADMIN_CHAT_ID, orderInfo).catch(err => console.log("Adminga xabar yuborishda xatolik:", err));
        }

        // Sahnadan chiqish
        return ctx.scene.leave();
    }
);

// Sahnani o'rnatish
const stage = new Scenes.Stage([orderWizard]);
bot.use(session());
bot.use(stage.middleware());

// Barcha kiruvchi xabarlar uchun foydalanuvchilarni saqlab olish (Statistika uchun)
bot.use((ctx, next) => {
    if (ctx.from) {
        if (!db.users.includes(ctx.from.id)) {
            db.users.push(ctx.from.id);
            saveDb();
        }
    }
    return next();
});

// ---------------------------------------------------------------- //
// Buyruqlar va xabarlar
// ---------------------------------------------------------------- //

// SALOMLASHISH (/start buyrug'i)
bot.start((ctx) => {
    ctx.reply("Assalomu alaykum! Tegirmon botiga xush kelibsiz.\nQuyidagi menyudan kerakli bo'limni tanlang:", mainMenu);
});

// ADMIN UCHUN (Statistika va ma'lumotlar)
bot.command('admin', (ctx) => {
    if (ctx.from.id.toString() === ADMIN_CHAT_ID) {
        ctx.reply(`📊 Admin statistikasi:\n\n👥 Jami bot foydalanuvchilari: ${db.users.length} ta\n🛍 Buyurtmalar soni: ${db.ordersCount} ta`);
    } else {
        ctx.reply("Kechirasiz, sizda admin huquqlari yo'q.");
    }
});

// 1-TUGMA: Xizmatlarimiz
bot.hears('📋 Xizmatlarimiz', (ctx) => {
    ctx.reply(
        "📄 Bizning xizmatlarimiz:\n\n" +
        "Har bir ochiq menyu tugmasini bosib to'liq ma'lumot olishingiz mumkin:",
        Markup.inlineKeyboard([
            [Markup.button.callback("Bug'doyni un qilish", "service_un")],
            [Markup.button.callback("Makka va bug'doyni yem qilish", "service_yem")],
            [Markup.button.callback("Sotuvda un borligini bilish", "service_sotuv")],
            [Markup.button.callback("❌ Yopish", "delete_msg")]
        ])
    );
});

bot.action('service_un', (ctx) => {
    ctx.answerCbQuery();
    ctx.editMessageText("🌾 Bug'doyni un qilish xizmati:\n\nBizda maxsus tegirmonda toza sifatli bug'doyingizni un holatiga keltirib berish imkoniyati mavjud.", Markup.inlineKeyboard([[Markup.button.callback("⬅️ Orqaga", "back_services")]]));
});

bot.action('service_yem', (ctx) => {
    ctx.answerCbQuery();
    ctx.editMessageText("🌽 Bug'doy va Makkajo'xorini yem qilish xizmati:\n\nChorva mollari va parrandalar uchun maxsus maydalangan sifatli yem tayyorlab beramiz.", Markup.inlineKeyboard([[Markup.button.callback("⬅️ Orqaga", "back_services")]]));
});

bot.action('service_sotuv', (ctx) => {
    ctx.answerCbQuery();
    ctx.editMessageText("🛍 Sotuvda Tegirmon un bor:\n\nO'zimizda ishlab chiqarilgan yuqori sifatli un mahsulotlari ulgurji hamda chakana savdoda doimiy mavjud.", Markup.inlineKeyboard([[Markup.button.callback("⬅️ Orqaga", "back_services")]]));
});

bot.action('back_services', (ctx) => {
    ctx.answerCbQuery();
    ctx.editMessageText("📄 Bizning xizmatlarimiz:\n\nHar bir ochiq menyu tugmasini bosib to'liq ma'lumot olishingiz mumkin:",
        Markup.inlineKeyboard([
            [Markup.button.callback("Bug'doyni un qilish", "service_un")],
            [Markup.button.callback("Makka va bug'doyni yem qilish", "service_yem")],
            [Markup.button.callback("Sotuvda un borligini bilish", "service_sotuv")],
            [Markup.button.callback("❌ Yopish", "delete_msg")]
        ])
    );
});

bot.action('delete_msg', (ctx) => {
    ctx.deleteMessage().catch(() => {});
});

// 2-TUGMA: Narxlar
bot.hears('💸 Narxlar', (ctx) => {
    ctx.reply(
        "💰 Bizning narxlarimiz:\n\n" +
        "• Bug'doyni un qilish: 600 so'mdan\n" +
        "• Makka va bug'doyni yem qilish: 500 so'mdan\n" +
        "• Sotuvdagi un: 1 kg un - 5000 so'm",
        Markup.inlineKeyboard([
             [Markup.button.callback("Buyurtma berish (Un qilish)", "order_now")] ,
             [Markup.button.callback("Buyurtma berish (Yem qilish)", "order_now")] ,
             [Markup.button.callback("Buyurtma berish (Un sotib olish)", "order_now")] ,
             [Markup.button.callback("❌ Yopish", "delete_msg")]
        ])
    );
});

// Inline tugmadagi buyurtmani ushlab olish (Sahnaga kirish)
bot.action('order_now', (ctx) => {
    ctx.answerCbQuery();
    ctx.scene.enter('order-wizard');
});

// 3-TUGMA: Buyurtma berish (Pastki menyu bosilganda ham ishlaydi)
bot.hears('🛒 Buyurtma berish', (ctx) => {
    ctx.scene.enter('order-wizard');
});

// 4-TUGMA: Bog'lanish
bot.hears('📞 Bog\'lanish', (ctx) => {
    ctx.reply(
        "📞 Kontaktlar va manzillarimiz:\n\n" +
        "• Telefon: +998944362712\n" +
        "• Telefon: +998940293229\n" +
        "• Ish vaqti: 08:00 — 18:00\n" +
        "• Dam olish kuni: Juma"
    );
});

// 5-TUGMA: Savollar
bot.hears('❓ Savollar', (ctx) => {
    ctx.reply(
        "❓ Ko'p beriladigan savollar:\n\n" +
        "🔹 Qancha vaqtda tayyor bo'ladi?\n— 3 kundan 7 kungacha navbatga qarab albatta.\n\n" +
        "🔹 To'lov qanday?\n— Naqd yoki plastik orqalik (Click yoki Payme).\n\n" +
        "🔹 Kafolat bormi?\n— Ha, Agar Muammo bo'lsa biz bilan bog'laning."
    );
});

// 6-TUGMA: To'lov uchun
bot.hears('💳 To\'lov uchun', (ctx) => {
    ctx.reply(
        "💳 To'lov ma'lumotlari:\n\n" +
        "Quyidagi plastik kartaga to'lovni (Click yoki Payme) amalga oshirishingiz mumkin:\n\n" +
        "💳 Karta raqami: `9860 0101 1521 1137`\n" +
        "👤 Karta egasi: Shavkatjonov Rakhmatillo\n\n" +
        "*(Karta raqamini ustiga bossangiz nusxa olib olinadi)*", { parse_mode: "Markdown" }
    );
});

// 7-TUGMA: Manzil / Lokatsiya
bot.hears('📍 Manzil / Lokatsiya', (ctx) => {
    ctx.reply("📍 Bizning manzil: Andijon viloyati, Asaka.\n\n👇 Quyidagi xarita orqali bizni osongina topib kelishingiz mumkin:");
    // Sexning aniq koordinatalari
    ctx.replyWithLocation(40.659309, 72.241006); 
});

// Botni xatolikni tutishi va ishga tushirish funksiyalari
bot.catch((err, ctx) => {
    console.error(`Ooops, encountered an error for ${ctx.updateType}`, err);
});

// "Menu" (Menu tugmasi - chekkadagi) ro'yxatini yaratish
bot.telegram.setMyCommands([
    { command: 'start', description: 'Botni qayta ishga tushirish' },
    { command: 'admin', description: 'Admin paneli / Statistika' }
]).catch(err => console.log('Menyu yaratishda xatolik:', err));

bot.launch().then(() => {
    console.log("Bot muvaffaqiyatli ishga tushdi / Bot has started 🎉");
});

// Dastur to'xtatilganida botni uzib qo'yish
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));

// Bepul serverlar (masalan, Glitch) uchun oddiy web-server ulab qo'yamiz (uxlab qolmasligi uchun)
const http = require('http');
http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Bot ushbu serverda 100% faol ishlab turibdi!');
}).listen(process.env.PORT || 8080);
