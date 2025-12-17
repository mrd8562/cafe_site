// services/adminAuthService.js
const db = require('./db');

const getAdminByUsername = async (username) => {
    const [rows] = await db.execute(
        'SELECT admin_id, username, password FROM admins WHERE username = ?',
        [username]
    );
    return rows[0] || null;
};

const validateAdminPassword = async (username, password) => {
    const admin = await getAdminByUsername(username);
    if (!admin) return false;

    // В реальном проекте — сравнивайте хэши (например, bcrypt)
    // Сейчас просто сравниваем строки (для теста)
    return admin.password === password;
};

module.exports = {
    getAdminByUsername,
    validateAdminPassword
};