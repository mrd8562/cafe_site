function deviceDetector(req, res, next) {
    const userAgent = req.headers['user-agent'] || '';

    // Устанавливаем deviceType для ВСЕХ запросов, даже для статических файлов
    let deviceType = 'desktop';

    // 1. Параметр из URL (для принудительного переключения)
    if (req.query.device === 'mobile') {
        deviceType = 'mobile';
    }
    else if (req.query.device === 'desktop') {
        deviceType = 'desktop';
    }
    // 2. Определение для DevTools мобильного режима
    else if (userAgent.includes('Windows') && userAgent.includes('Mobile')) {
        deviceType = 'mobile';
    }
    // 3. Обычные мобильные устройства
    else if (/iPhone|iPad|iPod|Android|Mobile/i.test(userAgent)) {
        deviceType = 'mobile';
    }

    // ВСЕГДА устанавливаем deviceType, даже для статических файлов
    req.deviceType = deviceType;

    next();
}


module.exports = deviceDetector;