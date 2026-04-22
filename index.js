require('dotenv').config();
const { Telegraf, Markup, session, Scenes } = require('telegraf');
const fs = require('fs');
const path = require('path');

// Bot tokenini va admin chat ID sini env dan olish
const bot = new Telegraf(process.env.BOT_TOKEN);
// Faqat shu Telegram user ID ga /admin ruxsat beriladi (faqat raqam, probelsiz)
const ADMIN_CHAT_ID = (process.env.ADMIN_CHAT_ID || '').trim();

// Sodda JSON baza yaratish yoki borini o'qish
const dbPath = path.join(__dirname, 'db.json');
const legacyDbPath = path.resolve(process.cwd(), 'db.json');

const readDb = (filePath) => {
    if (!fs.existsSync(filePath)) return { users: [], ordersCount: 0 };
    try {
        return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    } catch {
        return { users: [], ordersCount: 0 };
    }
};

const normalizeUser = (user) => {
    if (typeof user === 'number' || typeof user === 'string') {
        return {
            id: String(user),
            firstName: '',
            lastName: '',
            username: '',
            joinedAt: new Date().toISOString()
        };
    }

    return {
        id: String(user?.id ?? ''),
        firstName: user?.firstName || '',
        lastName: user?.lastName || '',
        username: user?.username || '',
        joinedAt: user?.joinedAt || new Date().toISOString()
    };
};

const primaryDb = readDb(dbPath);
const shouldReadLegacy = legacyDbPath !== dbPath;
const legacyDb = shouldReadLegacy ? readDb(legacyDbPath) : { users: [], ordersCount: 0 };

let db = {
    users: [...(primaryDb.users || []), ...(legacyDb.users || [])],
    ordersCount: Math.max(Number(primaryDb.ordersCount || 0), Number(legacyDb.ordersCount || 0))
};

// Eski bazani yangi formatga moslash (users: [id] -> users: [{...profile}]) va takrorlarni olib tashlash
if (!Array.isArray(db.users)) db.users = [];
const userMap = new Map();
for (const rawUser of db.users) {
    const normalized = normalizeUser(rawUser);
    if (!normalized.id) continue;
    if (!userMap.has(normalized.id)) {
        userMap.set(normalized.id, normalized);
    } else {
        const existing = userMap.get(normalized.id);
        existing.firstName = existing.firstName || normalized.firstName;
        existing.lastName = existing.lastName || normalized.lastName;
        existing.username = existing.username || normalized.username;
    }
}
db.users = Array.from(userMap.values());

// Baza fayliga yozish funksiyasi
const saveDb = () => {
    fs.writeFileSync(dbPath, JSON.stringify(db, null, 2));
};

// Yagona formatni darhol asosiy db.json ga yozib qo'yamiz
saveDb();

/** Telegram HTML — xavfsiz chiqish (foydalanuvchi matnlari uchun) */
const escapeHtml = (s) =>
    String(s ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');

const html = { parse_mode: 'HTML' };

// Asosiy menyu (2 ustun — bosish qulay)
const mainMenu = Markup.keyboard([
    ['📋 Xizmatlar', '💸 Narxlar'],
    ['🛒 Buyurtma', '📞 Aloqa'],
    ['❓ Savollar', '💳 To\u0027lov'],
    ['📍 Manzil']
]).resize();

const wizardBack = Markup.keyboard([['⬅️ Orqaga']]).resize();
const phoneKeyboard = () =>
    Markup.keyboard([[Markup.button.contactRequest('📱 Raqamni yuborish')], ['⬅️ Orqaga']])
        .oneTime()
        .resize();
// Telegraf Markup bilan ba'zan reply keyboard ichida location button chiqmay qolishi mumkin,
// shuning uchun reply_markupni Bot API formatida qo'lda beramiz.
const locationKeyboard = () => ({
    reply_markup: {
        keyboard: [
            [{ text: '📍 Lokatsiya yuborish', request_location: true }],
            [{ text: '⬅️ Orqaga' }]
        ],
        one_time_keyboard: true,
        resize_keyboard: true
    }
});

// ---------------------------------------------------------------- //
// Buyurtma berish jarayoni uchun Wizard Scene (Ketma-ket savollar)
// ---------------------------------------------------------------- //
const orderWizard = new Scenes.WizardScene(
    'order-wizard',
    (ctx) => {
        ctx.wizard.state.order = {};
        ctx.reply(
            '🛒 <b>Buyurtma</b> <i>1/6</i>\n\n' +
                '👤 <b>Ismingiz</b>ni yozing\n' +
                '<i>Misol: Ali Valiyev</i>',
            { ...html, ...wizardBack }
        );
        return ctx.wizard.next();
    },
    (ctx) => {
        if (!ctx.message || !ctx.message.text) return;
        if (ctx.message.text === '⬅️ Orqaga') {
            ctx.reply('❌ Buyurtma bekor qilindi.', { ...html, ...mainMenu });
            return ctx.scene.leave();
        }
        ctx.wizard.state.order.name = ctx.message.text;
        ctx.reply(
            '🛒 <b>Buyurtma</b> <i>2/6</i>\n\n' +
                '📱 <b>Telefon</b> raqamingizni yuboring\n' +
                '<i>Pastdagi tugma orqali yuboring yoki qo‘lda kiriting: +998901234567</i>',
            { ...html, ...phoneKeyboard() }
        );
        return ctx.wizard.next();
    },
    (ctx) => {
        if (!ctx.message) return;
        if (ctx.message.text === '⬅️ Orqaga') {
            ctx.reply('❌ Buyurtma bekor qilindi.', { ...html, ...mainMenu });
            return ctx.scene.leave();
        }

        let phone = '';
        if (ctx.message.contact) {
            // Faqat foydalanuvchining o'z kontaktini qabul qilamiz
            if (String(ctx.message.contact.user_id || '') !== String(ctx.from.id)) {
                ctx.reply('⚠️ Iltimos, o‘zingizning telefon raqamingizni yuboring.', {
                    ...html,
                    ...phoneKeyboard()
                });
                return;
            }
            phone = ctx.message.contact.phone_number || '';
        } else if (ctx.message.text) {
            phone = ctx.message.text.trim();
        }

        if (!phone) {
            ctx.reply('⚠️ Telefon raqamingizni yuboring.', { ...html, ...phoneKeyboard() });
            return;
        }

        ctx.wizard.state.order.phone = phone;
        ctx.reply(
            '🛒 <b>Buyurtma</b> <i>3/6</i>\n\n' +
                '📦 <b>Xizmat</b>ni tanlang',
            {
                ...html,
                ...Markup.keyboard([
                    ['🌾 Un qilish', '🌽 Yem qilish'],
                    ['🛒 Tegirmon uni sotib olish'],
                    ['⬅️ Orqaga']
                ])
                    .oneTime()
                    .resize()
            }
        );
        return ctx.wizard.next();
    },
    (ctx) => {
        if (!ctx.message || !ctx.message.text) return;
        if (ctx.message.text === '⬅️ Orqaga') {
            ctx.reply('❌ Buyurtma bekor qilindi.', { ...html, ...mainMenu });
            return ctx.scene.leave();
        }
        ctx.wizard.state.order.service = ctx.message.text;
        ctx.reply(
            '🛒 <b>Buyurtma</b> <i>4/6</i>\n\n' +
                '⚖️ <b>Vazn</b> — necha kg?\n' +
                '<i>Faqat raqam: 50 yoki 12.5</i>',
            { ...html, ...wizardBack }
        );
        return ctx.wizard.next();
    },
    (ctx) => {
        if (!ctx.message || !ctx.message.text) return;
        if (ctx.message.text === '⬅️ Orqaga') {
            ctx.reply('❌ Buyurtma bekor qilindi.', { ...html, ...mainMenu });
            return ctx.scene.leave();
        }

        const kgStr = ctx.message.text.trim();
        const kg = parseFloat(kgStr);
        if (isNaN(kg)) {
            ctx.reply(
                '⚠️ Iltimos, vaznni <b>raqam</b> bilan yozing.\n<i>Misol: 100</i>',
                { ...html, ...wizardBack }
            );
            return;
        }
        ctx.wizard.state.order.kg = kg;

        let pricePerKg = 0;
        const serviceType = ctx.wizard.state.order.service;
        if (serviceType.includes('Un qilish')) {
            pricePerKg = 600;
        } else if (serviceType.includes('Yem qilish')) {
            pricePerKg = 500;
        } else if (serviceType.includes('sotib olish')) {
            pricePerKg = 5000;
        }

        let priceText = '';
        if (pricePerKg > 0) {
            const totalPrice = kg * pricePerKg;
            priceText = `${kg} kg × ${pricePerKg.toLocaleString('uz-UZ')} = <b>${totalPrice.toLocaleString('uz-UZ')} soʻm</b>`;
        } else {
            priceText = 'Menejer aniqlaydi';
        }
        ctx.wizard.state.order.priceText = priceText.replace(/<[^>]+>/g, '');

        ctx.reply(
            '🛒 <b>Buyurtma</b> <i>5/6</i>\n\n' +
                `✅ Vazn: <b>${escapeHtml(kg)}</b> kg\n` +
                `💰 Hisob: ${priceText}\n\n` +
                '📍 <b>Lokatsiya</b> yuboring\n' +
                '<i>Tugmani bosing va joylashuvingizni yuboring.</i>',
            { ...html, ...locationKeyboard() }
        );
        return ctx.wizard.next();
    },
    (ctx) => {
        // Lokatsiyani qabul qilish (Telegram'dan location keladi)
        if (!ctx.message) return;

        if (ctx.message.text === '⬅️ Orqaga') {
            ctx.reply('❌ Buyurtma bekor qilindi.', { ...html, ...mainMenu });
            return ctx.scene.leave();
        }

        if (!ctx.message.location) {
            ctx.reply('⚠️ Lokatsiyani yuboring.', { ...html, ...locationKeyboard() });
            return;
        }

        ctx.wizard.state.order.location = {
            latitude: ctx.message.location.latitude,
            longitude: ctx.message.location.longitude
        };

        ctx.reply(
            '🛒 <b>Buyurtma</b> <i>6/6</i>\n\n' +
                '📝 <b>Izoh</b> (ixtiyoriy)\n' +
                "<i>Bo'lmasa: <code>Yo'q</code></i>",
            { ...html, ...wizardBack }
        );
        return ctx.wizard.next();
    },
    (ctx) => {
        if (!ctx.message || !ctx.message.text) return;
        if (ctx.message.text === '⬅️ Orqaga') {
            ctx.reply('❌ Buyurtma bekor qilindi.', { ...html, ...mainMenu });
            return ctx.scene.leave();
        }
        ctx.wizard.state.order.comment = ctx.message.text;

        ctx.reply(
            '✅ <b>Rahmat!</b>\n\n' +
                "Buyurtmangiz qabul qilindi. Tez orada siz bilan bog'lanamiz.",
            { ...html, ...mainMenu }
        );
        
        // Bazaga buyurtma sonini qo'shib saqlash
        db.ordersCount += 1;
        saveDb();
        
        // Adminga xabar yuborish
        const o = ctx.wizard.state.order;
        const mapsLink =
            o.location && typeof o.location.latitude === 'number' && typeof o.location.longitude === 'number'
                ? `https://www.google.com/maps?q=${o.location.latitude},${o.location.longitude}`
                : 'yo‘q';
        const orderInfo =
            `🔔 YANGI BUYURTMA\n\n` +
            `👤 Kimdan: ${escapeHtml(o.name)}\n` +
            `📞 Telefon: ${escapeHtml(o.phone)}\n` +
            `🛠 Xizmat: ${escapeHtml(o.service)}\n` +
            `⚖️ Vazn: ${escapeHtml(o.kg)} kg\n` +
            `💵 Hisob: ${escapeHtml(o.priceText)}\n` +
            `📍 Lokatsiya: ${escapeHtml(mapsLink)}\n` +
            `📝 Izoh: ${escapeHtml(o.comment)}`;
        if (ADMIN_CHAT_ID) {
            bot.telegram.sendMessage(ADMIN_CHAT_ID, orderInfo).catch(err => console.log("Adminga xabar yuborishda xatolik:", err));
        }

        // Sahnadan chiqish
        return ctx.scene.leave();
    }
);

// Sahnani o'rnatish
const stage = new Scenes.Stage([orderWizard]);
bot.use(session());

// Admin komandalarini scene'dan oldin ushlaymiz (wizard ichida ham ishlasin)
const tryHandleEarlyAdminCommands = (ctx) => {
    const text = ctx.message && ctx.message.text ? ctx.message.text.trim() : '';
    if (!text) return false;

    if (/^\/id(?:@\w+)?$/i.test(text)) {
        ctx.reply(
            `🆔 Sizning ID: <code>${escapeHtml(String(ctx.from.id))}</code>\n` +
                `⚙️ ENV dagi ADMIN_CHAT_ID: <code>${escapeHtml(ADMIN_CHAT_ID || 'yoq')}</code>`,
            html
        );
        return true;
    }

    if (/^\/admin(?:@\w+)?$/i.test(text)) {
        if (ctx.from.id.toString() === ADMIN_CHAT_ID) {
            ctx.reply(
                '📊 <b>Admin paneli</b>\n\n' +
                    `👥 Foydalanuvchilar: <b>${db.users.length}</b>\n` +
                    `🛍 Buyurtmalar: <b>${db.ordersCount}</b>`,
                html
            );
        } else {
            ctx.reply('🔒 Bu bo‘lim faqat admin uchun.', html);
        }
        return true;
    }

    if (/^\/users(?:@\w+)?$/i.test(text)) {
        sendUsersList(ctx);
        return true;
    }

    return false;
};

bot.use((ctx, next) => {
    if (tryHandleEarlyAdminCommands(ctx)) return;
    return next();
});

bot.use(stage.middleware());

// Barcha kiruvchi xabarlar uchun foydalanuvchilarni saqlab olish (Statistika uchun)
bot.use((ctx, next) => {
    if (ctx.from) {
        const telegramId = String(ctx.from.id);
        const existingUser = db.users.find((u) => u.id === telegramId);
        if (!existingUser) {
            db.users.push({
                id: telegramId,
                firstName: ctx.from.first_name || '',
                lastName: ctx.from.last_name || '',
                username: ctx.from.username || '',
                joinedAt: new Date().toISOString()
            });
            saveDb();
        } else {
            // Username/ism o'zgarsa yangilab boramiz
            const updated =
                existingUser.firstName !== (ctx.from.first_name || '') ||
                existingUser.lastName !== (ctx.from.last_name || '') ||
                existingUser.username !== (ctx.from.username || '');
            if (updated) {
                existingUser.firstName = ctx.from.first_name || '';
                existingUser.lastName = ctx.from.last_name || '';
                existingUser.username = ctx.from.username || '';
                saveDb();
            }
        }
    }
    return next();
});

// ---------------------------------------------------------------- //
// Buyruqlar va xabarlar
// ---------------------------------------------------------------- //

// SALOMLASHISH (/start buyrug'i)
bot.start((ctx) => {
    ctx.reply(
        '👋 <b>Assalomu alaykum!</b>\n\n' +
            '🏭 <b>Tegirmon</b> — yordamchi botiga xush kelibsiz.\n' +
            'Pastdagi menyudan bo‘limni tanlang.',
        { ...html, ...mainMenu }
    );
});

bot.command('menu', (ctx) => {
    ctx.reply('📱 <b>Asosiy menyu</b>', { ...html, ...mainMenu });
});

// Eski klaviatura tugmalari (Telegramda saqlanib qolgan bo‘lsa)
bot.hears(
    [
        '📋 Xizmatlarimiz',
        '🛒 Buyurtma berish',
        '📞 Bog\'lanish',
        '📍 Manzil / Lokatsiya',
        '💳 To\'lov uchun'
    ],
    (ctx) => {
        ctx.reply(
            '⌨️ <b>Menyu yangilandi.</b>\n<i>Pastdagi tugmalardan foydalaning.</i>',
            { ...html, ...mainMenu }
        );
    }
);

// ADMIN UCHUN (Statistika va ma'lumotlar)
bot.command('admin', (ctx) => {
    if (ctx.from.id.toString() === ADMIN_CHAT_ID) {
        ctx.reply(
            '📊 <b>Admin paneli</b>\n\n' +
                `👥 Foydalanuvchilar: <b>${db.users.length}</b>\n` +
                `🛍 Buyurtmalar: <b>${db.ordersCount}</b>`,
            html
        );
    } else {
        ctx.reply('🔒 Bu bo‘lim faqat admin uchun.', html);
    }
});

// Admin ID ni tez tekshirish uchun
bot.command('id', (ctx) => {
    ctx.reply(
        `🆔 Sizning ID: <code>${escapeHtml(String(ctx.from.id))}</code>\n` +
            `⚙️ ENV dagi ADMIN_CHAT_ID: <code>${escapeHtml(ADMIN_CHAT_ID || 'yoq')}</code>`,
        html
    );
});

const sendUsersList = (ctx) => {
    if (ctx.from.id.toString() !== ADMIN_CHAT_ID) {
        ctx.reply('🔒 Bu bo‘lim faqat admin uchun.', html);
        return;
    }

    if (!db.users.length) {
        ctx.reply('👥 Hozircha foydalanuvchilar topilmadi.', html);
        return;
    }

    const maxUsers = 40;
    const usersToShow = db.users.slice(-maxUsers).reverse();
    const lines = usersToShow.map((u, i) => {
        const fullName = `${u.firstName || ''} ${u.lastName || ''}`.trim() || 'Nomaʼlum';
        const username = u.username ? `@${u.username}` : 'username yo‘q';
        return `${i + 1}) <b>${escapeHtml(fullName)}</b> — ${escapeHtml(username)} — <code>${escapeHtml(u.id)}</code>`;
    });

    const text =
        `👥 <b>Foydalanuvchilar ro‘yxati</b>\n` +
        `Jami: <b>${db.users.length}</b>\n` +
        `Ko‘rsatilmoqda: oxirgi <b>${usersToShow.length}</b>\n\n` +
        lines.join('\n');

    ctx.reply(text, html);
};

// ADMIN UCHUN: foydalanuvchilar ro'yxati
bot.command('users', (ctx) => {
    sendUsersList(ctx);
});

// Ba'zi holatlarda bot.command ushlamasa ham ishlashi uchun fallback
bot.hears(/^\/users(?:@\w+)?$/i, (ctx) => {
    sendUsersList(ctx);
});

const servicesKeyboard = () =>
    Markup.inlineKeyboard([
        [
            Markup.button.callback('🌾 Un qilish', 'service_un'),
            Markup.button.callback('🌽 Yem qilish', 'service_yem')
        ],
        [Markup.button.callback('🛒 Sotuvdagi un', 'service_sotuv')],
        [Markup.button.callback('✕ Yopish', 'delete_msg')]
    ]);

// 1-TUGMA: Xizmatlar
bot.hears('📋 Xizmatlar', (ctx) => {
    ctx.reply(
        '📋 <b>Xizmatlar</b>\n\n' +
            'Kerakli bo‘limni tanlang — batafsil ma’lumot ochiladi.',
        { ...html, ...servicesKeyboard() }
    );
});

bot.action('service_un', (ctx) => {
    ctx.answerCbQuery();
    ctx.editMessageText(
        '🌾 <b>Bug‘doyni un qilish</b>\n\n' +
            'Maxsus tegirmonda bug‘doyingizni <b>toza un</b> holatiga keltirib beramiz.',
        { ...html, ...Markup.inlineKeyboard([[Markup.button.callback('◀ Orqaga', 'back_services')]]) }
    );
});

bot.action('service_yem', (ctx) => {
    ctx.answerCbQuery();
    ctx.editMessageText(
        '🌽 <b>Yem qilish</b>\n\n' +
            'Bug‘doy va makkajo‘xori — chorva va parranda uchun <b>sifatli yem</b>.',
        { ...html, ...Markup.inlineKeyboard([[Markup.button.callback('◀ Orqaga', 'back_services')]]) }
    );
});

bot.action('service_sotuv', (ctx) => {
    ctx.answerCbQuery();
    ctx.editMessageText(
        '🛒 <b>Sotuvdagi un</b>\n\n' +
            'O‘z ishlab chiqarishimiz — ulgurji va chakana savdoda <b>doimiy mavjud</b>.',
        { ...html, ...Markup.inlineKeyboard([[Markup.button.callback('◀ Orqaga', 'back_services')]]) }
    );
});

bot.action('back_services', (ctx) => {
    ctx.answerCbQuery();
    ctx.editMessageText(
        '📋 <b>Xizmatlar</b>\n\n' + 'Kerakli bo‘limni tanlang.',
        { ...html, ...servicesKeyboard() }
    );
});

bot.action('delete_msg', (ctx) => {
    ctx.answerCbQuery({ text: 'Yopildi' }).catch(() => {});
    ctx.deleteMessage().catch(() => {});
});

// 2-TUGMA: Narxlar
bot.hears('💸 Narxlar', (ctx) => {
    ctx.reply(
        '💸 <b>Narxlar</b> <i>(taxminiy)</i>\n\n' +
            '🌾 Un qilish — <b>600</b> so‘m/kg\n' +
            '🌽 Yem qilish — <b>500</b> so‘m/kg\n' +
            '🛒 Tayyor un — <b>5 000</b> so‘m/kg\n\n' +
            "Buyurtma — <code>🛒 Buyurtma</code> yoki quyidagi tugmalar.",
        {
            ...html,
            ...Markup.inlineKeyboard([
                [
                    Markup.button.callback('🌾 Buyurtma · un', 'order_now'),
                    Markup.button.callback('🌽 Buyurtma · yem', 'order_now')
                ],
                [Markup.button.callback('🛒 Buyurtma · tayyor un', 'order_now')],
                [Markup.button.callback('✕ Yopish', 'delete_msg')]
            ])
        }
    );
});

// Inline tugmadagi buyurtmani ushlab olish (Sahnaga kirish)
bot.action('order_now', (ctx) => {
    ctx.answerCbQuery();
    ctx.scene.enter('order-wizard');
});

// 3-TUGMA: Buyurtma
bot.hears('🛒 Buyurtma', (ctx) => {
    ctx.scene.enter('order-wizard');
});

// 4-TUGMA: Aloqa
bot.hears('📞 Aloqa', (ctx) => {
    ctx.reply(
        '📞 <b>Aloqa</b>\n\n' +
            '☎️ <a href="tel:+998944362712">+998 94 436 27 12</a>\n' +
            '☎️ <a href="tel:+998940293229">+998 94 029 32 29</a>\n\n' +
            '🕐 <b>Ish vaqti:</b> 08:00 — 18:00\n' +
            '📅 <b>Dam olish:</b> juma',
        { ...html, disable_web_page_preview: true }
    );
});

// 5-TUGMA: Savollar
bot.hears('❓ Savollar', (ctx) => {
    ctx.reply(
        '❓ <b>Ko‘p so‘raladigan savollar</b>\n\n' +
            '⏱ <b>Qancha vaqtda tayyor?</b>\n' +
            'Navbatga qarab — odatda <b>3–7 kun</b>.\n\n' +
            '💳 <b>To‘lov?</b>\n' +
            'Naqd yoki <i>Click / Payme</i>.\n\n' +
            '✅ <b>Kafolat?</b>\n' +
            "Muammo bo‘lsa — biz bilan bog‘laning.",
        html
    );
});

// 6-TUGMA: To'lov
bot.hears('💳 To\u0027lov', (ctx) => {
    ctx.reply(
        '💳 <b>To‘lov</b>\n\n' +
            'Click yoki Payme orqali quyidagi kartaga o‘tkazing:\n\n' +
            '💳 <code>9860 0101 1521 1137</code>\n' +
            '👤 <b>Egasi:</b> Shavkatjonov Rakhmatillo\n\n' +
            '<i>Raqam ustiga bosing — nusxa olinadi.</i>',
        html
    );
});

// 7-TUGMA: Manzil
bot.hears('📍 Manzil', (ctx) => {
    ctx.reply(
        '📍 <b>Manzil</b>\n\n' +
            'Andijon viloyati, <b>Asaka</b>.\n\n' +
            '👇 Xarita orqali yo‘l toping:',
        html
    );
    ctx.replyWithLocation(40.659309, 72.241006);
});

// Botni xatolikni tutishi va ishga tushirish funksiyalari
bot.catch((err, ctx) => {
    console.error(`Ooops, encountered an error for ${ctx.updateType}`, err);
});

const botCommands = [
    { command: 'start', description: 'Boshlash va menyu' },
    { command: 'menu', description: 'Asosiy menyu' },
    { command: 'admin', description: 'Admin statistikasi' },
    { command: 'users', description: 'Foydalanuvchilar ro‘yxati (admin)' },
    { command: 'id', description: 'Mening Telegram IDim' }
];

// Bot ishga tushganda command menu-ni qayta o'rnatamiz
bot.launch()
    .then(async () => {
        // Avval default commandlarni tozalab, keyin qayta o'rnatamiz
        await bot.telegram.deleteMyCommands();
        await bot.telegram.setMyCommands(botCommands);
        // Private chatlar uchun ham alohida yozamiz (Telegram scope cache muammolari uchun)
        await bot.telegram.deleteMyCommands({ scope: { type: 'all_private_chats' } });
        await bot.telegram.setMyCommands(botCommands, { scope: { type: 'all_private_chats' } });
        console.log("Bot muvaffaqiyatli ishga tushdi / Bot has started 🎉");
    })
    .catch((err) => {
        console.log("Botni ishga tushirishda xatolik:", err);
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
