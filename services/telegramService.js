const TelegramBot = require('node-telegram-bot-api');

class TelegramService {
    constructor() {
        if (!process.env.TELEGRAM_BOT_TOKEN || !process.env.TELEGRAM_CHAT_ID) {
            console.warn('⚠️ TELEGRAM_BOT_TOKEN или TELEGRAM_CHAT_ID не заданы. Используйте .env');
        }
        this.token = process.env.TELEGRAM_BOT_TOKEN || '';
        this.chatId = process.env.TELEGRAM_CHAT_ID || '';
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

    formatOrderMessage(orderData) {
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
            totalAmount
        } = orderData;

        let message = `<b>🎉 НОВЫЙ ЗАКАЗ!</b>\n\n`;
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
        items.forEach((item, index) => {
            const lineTotal = (Number(item.price || 0) * Number(item.quantity || 1)).toFixed(2);
            const weightText = item.weight ? `, ${item.weight} г` : '';
            const toppingsText = Array.isArray(item.toppings) && item.toppings.length > 0
                ? `\n   ➕ ${item.toppings.map(t => `${t.name}${Number(t.quantity || 1) > 1 ? ` (${t.quantity})` : ''}`).join(', ')}`
                : '';
            message += `${index + 1}. ${item.name}${weightText} — ${item.quantity} × ${Number(item.price || 0).toFixed(2)} ₽ = ${lineTotal} ₽${toppingsText}\n`;
        });

        message += `\n<b>💰 Итого:</b> ${Number(totalAmount || 0).toFixed(2)} ₽\n`;
        message += `<b>⏰ Время заявки:</b> ${new Date().toLocaleString('ru-RU')}`;

        return message;
    }
}

module.exports = new TelegramService();