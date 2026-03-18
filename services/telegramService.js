const os = require('os');
const TelegramBot = require('node-telegram-bot-api');

class TelegramService {
    constructor() {
        const hostname = os.hostname();
        const isLocal = hostname.includes('MRD01');

        if (isLocal) {
            // локальная среда
            this.token = process.env.TELEGRAM_BOT_TOKEN_MY || '';
            this.chatId = process.env.TELEGRAM_CHAT_ID_MY || '';
            console.log('✅ Локальная среда: используются TELEGRAM_BOT_TOKEN_MY и TELEGRAM_CHAT_ID_MY');
        } else {
            // серверная среда
            this.token = process.env.TELEGRAM_BOT_TOKEN || '';
            this.chatId = process.env.TELEGRAM_CHAT_ID || '';
        }

        

        if (!this.token || !this.chatId) {
            console.warn('⚠️ TELEGRAM_BOT_TOKEN или TELEGRAM_CHAT_ID не заданы. Используйте .env');
        }

        this.bot = new TelegramBot(this.token, { polling: false });
    }

    async sendOrderNotification(orderData) {
        try {
            const message = this.formatOrderMessage(orderData);
            await this.bot.sendMessage(this.chatId, message, { parse_mode: 'HTML' });
            return true;
        } catch (error) {
            console.error('Ошибка отправки в Telegram:', error);
            return false;
        }
    }

    async sendOnlinePaymentAttemptNotification(orderData) {
        try {
            const header = '🎉 КЛИЕНТ ПЫТАЕТСЯ ОПЛАТИТЬ ОНЛАЙН!\n⏳ Ожидайте 15 минут. Если оплата не совершена — звоните клиенту и уточняйте.';
            const message = this.formatOrderMessage(orderData, { header });
            await this.bot.sendMessage(this.chatId, message, { parse_mode: 'HTML' });
            return true;
        } catch (error) {
            console.error('Ошибка отправки в Telegram (attempt):', error);
            return false;
        }
    }

    async sendOnlinePaymentSuccessNotification({ amountByn, orderData }) {
        try {
            const message = this.formatPaymentSuccessMessage({ amountByn, orderData });
            await this.bot.sendMessage(this.chatId, message, { parse_mode: 'HTML' });
            return true;
        } catch (error) {
            console.error('Ошибка отправки в Telegram (paid):', error);
            return false;
        }
    }

    async sendSupportMessage(reportData) {
        try {
            const message = this.formatSupportMessage(reportData);
            await this.bot.sendMessage(this.chatId, message, { parse_mode: 'HTML' });
            return true;
        } catch (error) {
            console.error('Ошибка отправки обращения поддержки в Telegram:', error);
            return false;
        }
    }

    async sendCallbackRequest(callbackData = {}) {
        try {
            const message = this.formatCallbackMessage(callbackData);
            await this.bot.sendMessage(this.chatId, message, { parse_mode: 'HTML' });
            return true;
        } catch (error) {
            console.error('Ошибка отправки запроса перезвона в Telegram:', error);
            return false;
        }
    }

    formatOrderMessage(orderData, { header } = {}) {
        const {
            customerName,
            phone,
            email,
            city,
            address,
            type,
            deliveryType,
            preorderDay,
            preorderTime,
            paymentType,
            comment,
            items = [],
            totalAmount,
            deliveryFee = 0,
            receiptUrl
        } = orderData;

        const safeHeader = header ? this.escapeHtml(header) : '🎉 НОВЫЙ ЗАКАЗ!';
        let message = `<b>${safeHeader}</b>\n\n`;
        message += `<b>👤 Клиент:</b> ${customerName}\n`;
        message += `<b>📞 Телефон:</b> ${phone}\n`;
        if (email) message += `<b>📧 Email:</b> ${email}\n`;
        if (type) message += `<b>📝 Тип:</b> ${type}\n`;
        if (deliveryType) message += `<b>🚚 Доставка:</b> ${deliveryType}\n`;
        if (preorderDay || preorderTime) message += `<b>⏳ Предзаказ:</b> ${[preorderDay, preorderTime].filter(Boolean).join(' ')}\n`;
        if (paymentType) message += `<b>💳 Оплата:</b> ${paymentType}\n`;
        message += `\n<b>🏙️ Город:</b> ${city}\n`;
        if (address) message += `<b>📍 Адрес:</b> ${address}\n`;
        if (comment) message += `\n<b>💬 Комментарий:</b> ${comment}\n`;

        message += `\n<b>🛒 Позиции:</b>\n`;

        // Группируем начинки как подэлементы к предыдущему базовому блюду (у которого есть вес)
        const groups = [];
        let currentGroup = null;
        (items || []).forEach((it) => {
            const isBaseDish = Number(it.weight || 0) > 0;
            if (isBaseDish) {
                currentGroup = { base: it, toppings: [] };
                groups.push(currentGroup);
            } else if (currentGroup) {
                currentGroup.toppings.push(it);
            } else {
                // Начинка без базового блюда ранее — считаем отдельной позицией
                groups.push({ base: it, toppings: [] });
            }
        });

        groups.forEach((group, idx) => {
            const item = group.base;
            const baseQty = Number(item.quantity || 1);
            const basePrice = Number(item.price || 0);
            const baseTotalNum = basePrice * baseQty;
            const lineTotal = baseTotalNum.toFixed(2);
            const weightText = item.weight ? `, ${item.weight} г` : '';

            let toppingsText = '';
            let toppingsSum = 0;
            if (group.toppings.length > 0) {
                const list = group.toppings.map(t => {
                    const qty = Number(t.quantity || 1);
                    const price = Number(t.price || 0);
                    const unit = price.toFixed(2);
                    const extended = (price * qty).toFixed(2);
                    toppingsSum += price * qty;
                    return `➕ ${t.name} — ${qty} × ${unit} BYN = ${extended} BYN`;
                }).join('\n   ');
                toppingsText = `\n   ${list}`;
            }

            message += `${idx + 1}. ${item.name}${weightText} — ${item.quantity} × ${Number(item.price || 0).toFixed(2)} BYN = ${lineTotal} BYN${toppingsText}\n`;
            if (group.toppings.length > 0) {
                // Итог по группе: базовое блюдо + начинки
                const groupTotal = baseTotalNum + toppingsSum;
                message += ` 🟰 Общая цена с начинкой: ${groupTotal.toFixed(2)} BYN\n---------------------------------------\n`;
            }
        });

        if (Number(deliveryFee) > 0) {
            message += `\n<b>🚚 Доставка:</b> ${Number(deliveryFee).toFixed(2)} BYN`;
        } else if ((type || '').includes('Доставка')) {
            message += `\n<b>🚚 Доставка:</b> бесплатно`;
        }
        message += `\n<b>💰 Итого:</b> ${Number(totalAmount || 0).toFixed(2)} BYN\n`;
        if (receiptUrl) {
            const safeUrl = this.escapeHtml(String(receiptUrl));
            message += `<b>🧾 Чек bePaid:</b> <a href="${safeUrl}">Открыть чек</a>\n`;
            message += `<b>🏦 Кабинет bePaid:</b> <a href="https://merchant.bepaid.by/merchant/dwh/orders">Открыть транзакции</a>\n`;
            message += `<b>      Логин: <code>viking.buh@gmail.com</code></b>\n`;
            message += `<b>      Пароль: <code>gGl0#bid0</code></b>\n`;
        }
        message += `<b>⏰ Время заявки:</b> ${new Date().toLocaleString('ru-RU')}`;

        return message;
    }

    formatPaymentSuccessMessage({ amountByn, orderData }) {
        const name = this.escapeHtml(orderData?.customerName || '—');
        const phone = this.escapeHtml(orderData?.phone || '—');
        const city = this.escapeHtml(orderData?.city || 'Новополоцк');
        const address = this.escapeHtml(orderData.address);
        const receiptUrl = orderData?.receiptUrl ? this.escapeHtml(String(orderData.receiptUrl)) : '';
        const amount = Number(amountByn || 0).toFixed(2);

        let text = `<b>✅ УСПЕШНО ОПЛАЧЕНО ${amount} BYN!!!</b>\n`;
        text += `<b>👤 Клиент:</b> ${name}\n`;
        text += `<b>📞 Телефон:</b> ${phone}\n`;
        text += `<b>🏙️ Город:</b> ${city}\n`;
        if (address) text += `<b>📍 Адрес:</b> ${address}\n`;
        if (receiptUrl) text += `<b>🧾 Чек bePaid:</b> <a href="${receiptUrl}">Открыть чек</a>`;
        if (receiptUrl) text += `\n`;
        text += `<b>🏦 Кабинет bePaid:</b> <a href="https://merchant.bepaid.by/merchant/dwh/orders">Открыть транзакции</a>\n`;
        text += `<b>      Логин: <code>viking.buh@gmail.com</code></b>\n`;
        text += `<b>      Пароль: <code>gGl0#bid0</code></b>`;
        return text;
    }

    formatSupportMessage(reportData = {}) {
        const {
            name,
            phone,
            message,
            page,
            source,
            deviceType,
            ip,
            userAgent,
            timestamp
        } = reportData;

        const submittedAt = timestamp ? new Date(timestamp) : new Date();

        let text = `<b>⚠️ Новое обращение в поддержку</b>\n\n`;
        text += `<b>👤 Имя:</b> ${this.escapeHtml(name || '—')}\n`;
        text += `<b>📞 Телефон:</b> ${this.escapeHtml(phone || '—')}\n`;
        text += `<b>⏰ Время:</b> ${submittedAt.toLocaleString('ru-RU')}\n`;
        if (page) {
            text += `<b>📄 Страница:</b> ${this.escapeHtml(page)}\n`;
        }
        if (source || deviceType) {
            text += `<b>📱 Устройство:</b> ${this.escapeHtml(source || deviceType || '')}\n`;
        }
        if (ip) {
            text += `<b>🌐 IP:</b> ${this.escapeHtml(ip)}\n`;
        }
        if (userAgent) {
            text += `<b>🧭 Браузер:</b> ${this.escapeHtml(userAgent)}\n`;
        }

        text += `\n<b>💬 Сообщение:</b>\n${this.escapeHtml(message || '')}`;
        return text;
    }

    formatCallbackMessage(data = {}) {
        const {
            phone,
            phoneDigits,
            city,
            company,
            page,
            source,
            deviceType,
            timestamp
        } = data;

        const submittedAt = timestamp ? new Date(timestamp) : new Date();

        let text = `<b>📞 Новая заявка на звонок</b>\n\n`;
        text += `<b>📞 Телефон:</b> ${this.escapeHtml(phone || '—')}\n`;
        if (phoneDigits) {
            text += `<b>🔢 Номер (цифры):</b> ${this.escapeHtml(phoneDigits)}\n`;
        }
        if (page) {
            text += `<b>📄 Страница:</b> ${this.escapeHtml(page)}\n`;
        }
        if (source || deviceType) {
            text += `<b>📱 Источник:</b> ${this.escapeHtml(source || deviceType || '')}\n`;
        }
        text += `<b>⏰ Время:</b> ${submittedAt.toLocaleString('ru-RU')}`;

        return text;
    }

    escapeHtml(value = '') {
        return String(value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
    }
}

module.exports = new TelegramService();