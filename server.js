require('dotenv').config();
const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const path = require('path');
const deviceDetector = require('./middleware/deviceDetector');
const authMiddleware = require('./middleware/authMiddleware');
const telegramService = require('./services/telegramService');
const axios = require('axios');


const app = express();
const PORT = Number(process.env.PORT || 2222);

function normalizeOrderPayload(payload = {}) {
    // Бизнес-правила доставки
    const DELIVERY_MIN_ORDER = 40; // руб.
    const DELIVERY_FREE_FROM = 50; // руб.
    const DELIVERY_FEE = 6; // руб.

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
        totalAmount: 0,
        deliveryFee: 0
    };

    // Расчёт суммы позиций
    const itemsSubtotal = (orderData.items || []).reduce((sum, it) => {
        const qty = Number(it.quantity || 1);
        const price = Number(it.price || 0);
        return sum + qty * price;
    }, 0);

    const isDelivery = (orderData.type || '').includes('Доставка');
    if (isDelivery) {
        if (itemsSubtotal < DELIVERY_MIN_ORDER) {
            return { ok: false, errorMessage: `Минимальный заказ для доставки — ${DELIVERY_MIN_ORDER} руб.` };
        }
        orderData.deliveryFee = itemsSubtotal >= DELIVERY_FREE_FROM ? 0 : DELIVERY_FEE;
    } else {
        orderData.deliveryFee = 0;
    }

    orderData.totalAmount = Number((itemsSubtotal + (orderData.deliveryFee || 0)).toFixed(2));
    return { ok: true, orderData };
}

function makeTrackingId() {
    return `cafe180_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}


app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(express.static('public'));
app.use(deviceDetector);


app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Динамическая настройка путей для разных устройств
// Замените текущий блок на этот:
app.use((req, res, next) => {
    // Пропускаем админку и dev-пути
    if (req.url.startsWith('/admin') || req.url.startsWith('/.well-known/')) {
        // Восстанавливаем views в корень (где лежит папка admin/)
        app.set('views', path.join(__dirname, 'views'));
        return next();
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

// Сообщение в Telegram о попытке онлайн-оплаты (до открытия виджета).
app.post('/api/order/attempt', async (req, res) => {
    try {
        const payload = req.body || {};
        const normalized = normalizeOrderPayload(payload);
        if (!normalized.ok) {
            return res.status(400).json({ success: false, message: normalized.errorMessage || 'Некорректные данные заказа' });
        }
        const orderData = normalized.orderData;
        if ((orderData.paymentType || '') !== 'Картой') {
            return res.status(400).json({ success: false, message: 'Неверный способ оплаты' });
        }
        const ok = await telegramService.sendOnlinePaymentAttemptNotification(orderData);
        if (!ok) return res.status(502).json({ success: false, message: 'Не удалось отправить в Telegram' });
        return res.json({ success: true });
    } catch (err) {
        console.error('Ошибка /api/order/attempt:', err);
        return res.status(500).json({ success: false, message: 'Внутренняя ошибка сервера' });
    }
});

// Прием заказа с фронтенда и отправка уведомления в Telegram
app.post('/api/order', async (req, res) => {
    try {
        const payload = req.body || {};
        const normalized = normalizeOrderPayload(payload);
        if (!normalized.ok) {
            return res.status(400).json({ success: false, message: normalized.errorMessage || 'Некорректные данные заказа' });
        }
        const orderData = normalized.orderData;

        const trackingId = (payload.trackingId && String(payload.trackingId).includes('cafe180_')) ? String(payload.trackingId) : null;
        const fetchReceiptUrl = async () => {
            const shopId = process.env.BEPAID_SHOP_ID || '';
            const secret = process.env.BEPAID_SECRET_KEY || '';
            if (!shopId || !secret || !trackingId) return null;
            const auth = Buffer.from(`${shopId}:${secret}`).toString('base64');
            const url = `https://gateway.bepaid.by/v2/transactions/tracking_id/${encodeURIComponent(trackingId)}`;
            const resp = await axios.get(url, {
                headers: { 'Authorization': `Basic ${auth}`, 'Accept': 'application/json' },
                timeout: 15000
            });
            const txs = resp.data?.transactions || resp.data?.transaction || resp.data;
            const arr = Array.isArray(txs) ? txs : (txs ? [txs] : []);
            const first = arr[0]?.transaction || arr[0];
            return first?.receipt_url || null;
        };

        // Если заказ уже оплачен картой (успешный статус из виджета) —
        // сначала шлём сообщение "успешно оплачено", затем обычное "новый заказ".
        if ((orderData.paymentType || '') === 'Картой' && Boolean(payload.paid)) {
            const paidAmount = Number(orderData.totalAmount || 0);
            let receiptUrl = null;
            try { receiptUrl = await fetchReceiptUrl(); } catch (e) { /* ignore */ }
            if (receiptUrl) orderData.receiptUrl = receiptUrl;

            const okPaid = await telegramService.sendOnlinePaymentSuccessNotification({ amountByn: paidAmount, orderData });
            if (!okPaid) {
                return res.status(502).json({ success: false, message: 'Не удалось отправить уведомление об оплате в Telegram' });
            }
        }

        const okOrder = await telegramService.sendOrderNotification(orderData);
        if (!okOrder) {
            return res.status(502).json({ success: false, message: 'Не удалось отправить в Telegram' });
        }
        return res.json({ success: true });
    } catch (err) {
        console.error('Ошибка обработки /api/order:', err);
        return res.status(500).json({ success: false, message: 'Внутренняя ошибка сервера' });
    }
});



// Сессии (обязательно для хранения состояния админа)
app.use(session({
    secret: process.env.SESSION_SECRET || 'your-secret-key',
    resave: false,
    saveUninitialized: true,
    cookie: { secure: false } // true если HTTPS
}));

// Моковая база админов (в реальном проекте — из БД)
// const ADMINS = [
//     { username: 'admin', password: 'secret123' } // Замените на хэшированный пароль!
// ];



const adminService = require('./services/adminService');

// ... остальной код ...

// 👇 Сначала — маршруты, которые НЕ требуют авторизации
app.get('/admin/login', (req, res) => {
    res.render('admin/login');
});

// server.js — после подключения db и adminAuthService

const adminAuthService = require('./services/adminAuthService');

app.post('/admin/login', async (req, res) => {
    const { username, password } = req.body;

    try {
        const isValid = await adminAuthService.validateAdminPassword(username, password);

        if (isValid) {
            // Получим полную информацию об админе (можно расширить)
            const admin = await adminAuthService.getAdminByUsername(username);
            req.session.admin = {
                id: admin.admin_id,
                username: admin.username
            };
            return res.redirect('/admin');
        }

        res.render('admin/login', { error: 'Неверный логин или пароль' });
    } catch (err) {
        console.error('Ошибка входа:', err);
        res.render('admin/login', { error: 'Ошибка сервера' });
    }
});

app.get('/admin/logout', (req, res) => {
    req.session.destroy(() => {
        res.redirect('/admin/login');
    });
});

// 👇 Только ПОСЛЕ этого — защищаем остальные /admin/* маршруты
app.use('/admin', authMiddleware.authenticateAdmin);

// 👇 Защищённые маршруты
app.get('/admin', async (req, res) => {
    try {
        // Получаем меню
        const menu = adminService.getMenu();

        // Моковые данные (позже заменим на реальные из БД)
        const data = {
            username: req.session.admin.username, // ← берём из сессии
            menu: menu,
            ordersToday: 12,
            galleryCount: 24,
            promotions: [
                { id: 1, title: "Скидка 20% по четвергам", active: true },
                { id: 2, title: "Бесплатная доставка от 40 руб.", active: true }
            ],
            recentOrders: [
                {
                    time: "14:35",
                    name: "Анна",
                    phone: "+375 29 123-45-67",
                    total: 38.50,
                    type: "Доставка",
                    status: "Новый",
                    statusClass: "new"
                },
                {
                    time: "13:20",
                    name: "Иван",
                    phone: "+375 33 987-65-43",
                    total: 52.00,
                    type: "Самовывоз",
                    status: "Готовится",
                    statusClass: "process"
                },
                {
                    time: "12:15",
                    name: "Мария",
                    phone: "+375 44 555-55-55",
                    total: 29.90,
                    type: "Доставка",
                    status: "Выполнен",
                    statusClass: "done"
                }
            ]
        };

        res.render('admin/dashboard', data);

    } catch (err) {
        console.error('Ошибка рендера dashboard:', err);
        res.status(500).send('Ошибка сервера');
    }
});

app.get('/admin/menu', (req, res) => {
    const menu = adminService.getMenu();
    res.render('admin/menu', { menu });
});

// ... остальные /admin/* маршруты ...

app.post('/admin/menu/add', (req, res) => {
    const newItem = {
        name: req.body.name,
        price: parseFloat(req.body.price),
        category: req.body.category
    };
    adminService.addMenuItem(newItem);
    res.redirect('/admin/menu');
});

app.post('/admin/menu/update/:id', (req, res) => {
    const id = parseInt(req.params.id);
    const updatedItem = {
        name: req.body.name,
        price: parseFloat(req.body.price),
        category: req.body.category
    };
    adminService.updateMenuItem(id, updatedItem);
    res.redirect('/admin/menu');
});

app.get('/admin/menu/delete/:id', (req, res) => {
    const id = parseInt(req.params.id);
    adminService.deleteMenuItem(id);
    res.redirect('/admin/menu');
});





app.listen(PORT, () => {
    console.log(`🚀 Сервер запущен на http://localhost:${PORT}`);
});