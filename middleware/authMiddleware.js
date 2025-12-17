// middleware/authMiddleware.js

const authenticateAdmin = (req, res, next) => {
    // req.path будет: /login, /, /menu и т.д.
    if (req.path === '/login' || req.path === '/logout') {
        return next(); // Пропускаем login/logout
    }

    if (!req.session?.admin) {
        return res.redirect('/admin/login');
    }

    next();
};

module.exports = { authenticateAdmin };