require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
const deviceDetector = require('./middleware/deviceDetector');
const telegramService = require('./services/telegramService');


const app = express();
const PORT = Number(process.env.PORT || 2222);


app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(express.static('public'));
app.use(deviceDetector);


app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Динамическая настройка путей для разных устройств
app.use((req, res, next) => {

    // Пропуск девтула
    if (req.url.startsWith('/.well-known/')) { 
        return res.status(204).end();
    }

    if (req.deviceType === 'mobile') {
        res.locals.staticBase = '/mobile';
        res.locals.viewPath = 'mobile';
        app.set('views', path.join(__dirname, 'views', 'mobile'));
    } else {
        res.locals.staticBase = '/desktop';
        res.locals.viewPath = 'desktop';
        app.set('views', path.join(__dirname, 'views', 'desktop'));
    }

    next();
});

app.get('/', (req, res) => {
    res.render('index', {
        title: 'КАФЕ-БАР 180 градусов | Новополоцк',
        deviceType: req.deviceType
    });
});

// Прием заказа с фронтенда и отправка уведомления в Telegram
app.post('/api/order', async (req, res) => {
    try {
        const payload = req.body || {};

        // Прокидываем все поля, ожидаемые фронтом, и готовим items для сервиса
        const orderData = {
            customerName: payload.name || '',
            phone: payload.phone || '',
            email: payload.email || '',
            city: payload.city || 'Новополоцк',
            address: payload.address || '',
            type: payload.type || '',
            deliveryType: payload.deliveryType || '',
            preorderDay: payload.preorderDay || null,
            preorderTime: payload.preorderTime || null,
            paymentType: payload.paymentType || '',
            comment: payload.comment || '',
            acceptedPolicy: Boolean(payload.acceptedPolicy),
            items: Array.isArray(payload.items) ? payload.items.map((order) => {
                // структура из app.min.js: { dish: { name, price, weight, quantity, imageUrl }, toppings: [{name, quantity}] }
                if (order && order.dish) {
                    return {
                        name: order.dish.name,
                        quantity: Number(order.dish.quantity || 1),
                        price: Number(order.dish.price || 0),
                        weight: order.dish.weight,
                        imageUrl: order.dish.imageUrl,
                        toppings: Array.isArray(order.toppings) ? order.toppings.map(t => ({
                            name: t.name,
                            quantity: Number(t.quantity || 1),
                            price: Number(t.price || 0)
                        })) : []
                    };
                }
                // запасной вариант упрощенной структуры
                return {
                    name: order?.name || order?.title || 'Позиция',
                    quantity: Number(order?.quantity || order?.count || 1),
                    price: Number((order?.price || order?.cost || 0).toString().replace(/[^\d.]/g, '')),
                    toppings: []
                };
            }) : [],
            totalAmount: (() => {
                const str = payload.total?.toString() || '0';
                // Удаляем все нецифровые символы кроме точек и запятых
                let cleaned = str.replace(/[^\d.,]/g, '');
                // Если есть несколько точек, оставляем только первую
                if ((cleaned.match(/\./g) || []).length > 1) {
                    const parts = cleaned.split('.');
                    cleaned = parts[0] + '.' + parts.slice(1).join('');
                }
                // Заменяем запятую на точку
                cleaned = cleaned.replace(',', '.');
                return Number(cleaned) || 0;
            })()
        };

        const ok = await telegramService.sendOrderNotification(orderData);
        if (!ok) {
            return res.status(502).json({ success: false, message: 'Не удалось отправить в Telegram' });
        }
        return res.json({ success: true });
    } catch (err) {
        console.error('Ошибка обработки /api/order:', err);
        return res.status(500).json({ success: false, message: 'Внутренняя ошибка сервера' });
    }
});

app.listen(PORT, () => {
    console.log(`🚀 Сервер запущен на http://localhost:${PORT}`);
});