// Пример: работа с меню (в реальности — запросы к БД)
let menuItems = [
    { id: 1, name: 'Пицца Маргарита', price: 15.99, category: 'Пиццы' },
    { id: 2, name: 'Салат Цезарь', price: 8.50, category: 'Салаты' }
];

const getMenu = () => menuItems;

const addMenuItem = (item) => {
    item.id = menuItems.length + 1;
    menuItems.push(item);
    return item;
};

const updateMenuItem = (id, updatedItem) => {
    const index = menuItems.findIndex(item => item.id === id);
    if (index !== -1) {
        menuItems[index] = { ...menuItems[index], ...updatedItem };
        return menuItems[index];
    }
    return null;
};

const deleteMenuItem = (id) => {
    const index = menuItems.findIndex(item => item.id === id);
    if (index !== -1) {
        return menuItems.splice(index, 1)[0];
    }
    return null;
};

module.exports = {
    getMenu,
    addMenuItem,
    updateMenuItem,
    deleteMenuItem
};