/**
 * PDF Catalog Generator - Modern Single Panel with localStorage
 */
class PDFCatalogApp {
    constructor() {
        this.data = {
            categories: [],
            products: [],
            selectedCategory: null,
            productsPerPage: 4,
            productsOrder: [],
            originalOrder: []
        };

        // Storage keys
        this.storageKeys = {
            coverUrl: 'pdf_cover_url',
            backgroundUrl: 'pdf_background_url',
            backCoverUrl: 'pdf_backcover_url',
            productsPerPage: 'pdf_products_per_page',
            productOrders: 'pdf_product_orders_',
            categoryTitles: 'pdf_category_title_'
        };

        this.init();
    }

    init() {
        this.loadFromStorage();
        this.bindEvents();
        this.loadCategories();
    }

    loadFromStorage() {
        const backgroundUrl = localStorage.getItem(this.storageKeys.backgroundUrl) || '';
        const productsPerPage = localStorage.getItem(this.storageKeys.productsPerPage) || '4';

        document.getElementById('background-url').value = backgroundUrl;
        this.data.productsPerPage = parseInt(productsPerPage);

        document.querySelectorAll('.layout-option-compact').forEach(opt => {
            opt.classList.toggle('selected', parseInt(opt.dataset.products) === this.data.productsPerPage);
        });

        if (backgroundUrl) this.loadPreview('background-url', backgroundUrl);
        this.updatePageEstimate();
    }

    saveToStorage(key, value) {
        localStorage.setItem(key, value);
    }

    loadPreview(inputId, url) {
        const previewId = inputId.replace('-url', '-preview');
        const preview = document.getElementById(previewId);

        if (!url) {
            preview.innerHTML = '';
            preview.classList.remove('has-image');
            return;
        }

        preview.innerHTML = '<div class="loading" style="padding: 1rem;">...</div>';

        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => {
            preview.innerHTML = `<img src="${url}" alt="Preview">`;
            preview.classList.add('has-image');
        };
        img.onerror = () => {
            preview.innerHTML = '<span style="color: var(--danger); font-size: 0.8rem;">No cargada</span>';
            preview.classList.remove('has-image');
        };
        img.src = url;
    }

    bindEvents() {
        document.getElementById('categories-grid').addEventListener('click', (e) => {
            const card = e.target.closest('.category-card-compact');
            if (card) this.selectCategory(card.dataset.id);
        });

        const bgInput = document.getElementById('background-url');
        bgInput.value = localStorage.getItem(this.storageKeys.backgroundUrl) || '';
        bgInput.addEventListener('input', () => {
            const url = bgInput.value;
            this.saveToStorage(this.storageKeys.backgroundUrl, url);
            this.loadPreview('background-url', url);
            this.updateGenerateButton();
        });

        ['cover-pdf', 'back-cover-pdf'].forEach(id => {
            const input = document.getElementById(id);
            input.addEventListener('change', () => {
                const file = input.files[0];
                const previewId = id.replace('-pdf', '-preview');
                const preview = document.getElementById(previewId);
                if (file) {
                    preview.innerHTML = `<span style="color: var(--primary); font-size: 0.8rem;">📄 ${file.name}</span>`;
                } else {
                    preview.innerHTML = '';
                }
            });
        });

        document.querySelectorAll('.layout-option-compact').forEach(option => {
            option.addEventListener('click', () => this.selectProductsPerPage(option));
        });

        document.getElementById('products-tbody').addEventListener('click', (e) => {
            if (e.target.closest('.btn-move-up')) this.moveProduct(e.target.closest('tr'), -1);
            if (e.target.closest('.btn-move-down')) this.moveProduct(e.target.closest('tr'), 1);
            if (e.target.closest('.btn-reset-order')) this.resetOrder();
        });

        document.getElementById('generate-btn').addEventListener('click', () => this.generatePDF());

        // Category title input
        const titleInput = document.getElementById('category-title-input');
        if (titleInput) {
            titleInput.addEventListener('input', () => {
                if (this.data.selectedCategory) {
                    const key = this.storageKeys.categoryTitles + this.data.selectedCategory;
                    this.saveToStorage(key, titleInput.value);
                }
            });
        }
    }

    async loadCategories() {
        try {
            const response = await fetch('/api/categories');
            if (!response.ok) throw new Error('Error cargando categorías');
            const categories = await response.json();
            this.data.categories = categories;
            this.renderCategories();
        } catch (error) {
            this.showError('No se pudieron cargar las categorías');
        }
    }

    renderCategories() {
        const grid = document.getElementById('categories-grid');
        grid.innerHTML = this.data.categories.map(cat => `
            <div class="category-card-compact" data-id="${cat.categoryId || cat.id}">
                <img src="${cat.img || ''}" alt="${cat.title}"
                    onerror="this.src='data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%22100%22 height=%2280%22%3E%3Crect fill=%22%23ddd%22 width=%22100%22 height=%2280%22/%3E%3Ctext fill=%22%23666%22 x=%2250%25%22 y=%2250%25%22 dominant-baseline=%22middle%22 text-anchor=%22middle%22 font-size=%2212%22%3E${cat.title}%3C/text%3E%3C/svg%3E'">
                <div class="category-card-title">${cat.title}</div>
            </div>
        `).join('');
    }

    async selectCategory(categoryId) {
        try {
            document.querySelectorAll('.category-card-compact').forEach(card => {
                card.classList.toggle('selected', card.dataset.id === categoryId);
            });

            const tbody = document.getElementById('products-tbody');
            tbody.innerHTML = `
                <tr>
                    <td colspan="6" class="empty-state">
                        <div class="loading">Cargando productos...</div>
                    </td>
                </tr>
            `;

            const response = await fetch(`/api/products/${categoryId}`);
            if (!response.ok) throw new Error('Error cargando productos');
            const data = await response.json();

            this.data.products = data.products || [];
            this.data.selectedCategory = categoryId;

            // Original order from API
            const apiOrder = this.data.products.map((p, i) => ({
                id: p.id,
                position: i + 1
            }));
            this.data.originalOrder = apiOrder.map(o => ({ ...o }));

            // Check if saved order exists in localStorage
            const savedKey = this.storageKeys.productOrders + categoryId;
            const savedRaw = localStorage.getItem(savedKey);

            if (savedRaw) {
                try {
                    const saved = JSON.parse(savedRaw);
                    // Verify all product IDs still match
                    const productIds = new Set(this.data.products.map(p => p.id));
                    if (saved.every(o => productIds.has(o.id)) && saved.length === this.data.products.length) {
                        this.data.productsOrder = saved;
                    } else {
                        this.data.productsOrder = apiOrder;
                        localStorage.setItem(savedKey, JSON.stringify(apiOrder));
                    }
                } catch {
                    this.data.productsOrder = apiOrder;
                }
            } else {
                this.data.productsOrder = apiOrder;
            }

            // Load custom title
            const titleInput = document.getElementById('category-title-input');
            if (titleInput) {
                const cat = this.data.categories.find(c =>
                    c.categoryId === categoryId || c.id === categoryId
                );
                const savedTitle = localStorage.getItem(this.storageKeys.categoryTitles + categoryId) || '';
                titleInput.value = savedTitle || (cat ? cat.title : '');
            }

            if (this.data.products.length === 0) {
                tbody.innerHTML = `
                    <tr>
                        <td colspan="6" class="empty-state">
                            <div style="color: var(--warning);">
                                ⚠️ Esta categoría no tiene productos disponibles
                            </div>
                        </td>
                    </tr>
                `;
                document.getElementById('total-products').textContent = '0 productos';
                document.getElementById('estimated-pages').textContent = '~0 páginas';
                this.updateGenerateButton();
            } else {
                this.renderProductsTable();
                this.updateGenerateButton();
            }

            this.updateResetButton();
        } catch (error) {
            this.showError('Error: ' + error.message);
            document.querySelectorAll('.category-card-compact').forEach(card => card.classList.remove('selected'));
        }
    }

    selectProductsPerPage(option) {
        document.querySelectorAll('.layout-option-compact').forEach(o => o.classList.remove('selected'));
        option.classList.add('selected');
        this.data.productsPerPage = parseInt(option.dataset.products);
        this.saveToStorage(this.storageKeys.productsPerPage, this.data.productsPerPage);
        this.updatePageEstimate();
    }

    renderProductsTable() {
        const tbody = document.getElementById('products-tbody');

        if (!this.data.products.length) {
            tbody.innerHTML = `<tr><td colspan="6" class="empty-state">No hay productos</td></tr>`;
            document.getElementById('total-products').textContent = '0 productos';
            return;
        }

        const sortedProducts = [...this.data.products].sort((a, b) => {
            const posA = this.data.productsOrder.find(p => p.id === a.id)?.position || 999;
            const posB = this.data.productsOrder.find(p => p.id === b.id)?.position || 999;
            return posA - posB;
        });

        tbody.innerHTML = sortedProducts.map((product, index) => {
            const price = product.variants?.[0]?.price || product.price || 0;
            const image = product.variants?.[0]?.images?.[0]?.src || '';
            const title = product.title || 'Sin título';
            const v = product.variants?.[0] || {};
            const measurements = [
                v.sizes_x ? `${v.sizes_x}mm` : null,
                v.sizes_y ? `${v.sizes_y}mm` : null,
                v.sizes_z ? `${v.sizes_z}mm` : null
            ].filter(Boolean).join(' × ') || 'N/A';

            return `
            <tr data-id="${product.id}" draggable="true">
                <td>
                    <input type="number" class="order-input" value="${index + 1}" min="1" max="${sortedProducts.length}">
                </td>
                <td>
                    <img src="${image}" alt="${title}" class="product-thumbnail"
                        onerror="this.src='data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%2245%22 height=%2245%22%3E%3Crect fill=%22%23ddd%22 width=%2245%22 height=%2245%22/%3E%3C/svg%3E'">
                </td>
                <td>
                    <div style="font-weight: 500;">${title}</div>
                </td>
                <td>
                    <span style="font-weight: 600; color: var(--primary);">$${price.toFixed(2)}</span>
                </td>
                <td>
                    <span style="font-size: 0.85rem; color: var(--text-light);">${measurements}</span>
                </td>
                <td>
                    <div class="action-buttons">
                        <button class="btn-action btn-move-up" ${index === 0 ? 'disabled' : ''}>↑</button>
                        <button class="btn-action btn-move-down" ${index === sortedProducts.length - 1 ? 'disabled' : ''}>↓</button>
                    </div>
                </td>
            </tr>
            `;
        }).join('');

        document.getElementById('total-products').innerHTML = `<strong>${sortedProducts.length}</strong> productos`;
        this.setupDragAndDrop();
        this.updatePageEstimate();
    }

    setupDragAndDrop() {
        const tbody = document.getElementById('products-tbody');
        let draggedRow = null;

        tbody.querySelectorAll('tr[draggable="true"]').forEach(row => {
            row.addEventListener('dragstart', () => {
                draggedRow = row;
                row.classList.add('dragging');
            });

            row.addEventListener('dragend', () => {
                row.classList.remove('dragging');
                draggedRow = null;
            });

            row.addEventListener('dragover', (e) => {
                e.preventDefault();
                if (draggedRow && draggedRow !== row) {
                    const rect = row.getBoundingClientRect();
                    if (e.clientY < rect.top + rect.height / 2) {
                        row.parentNode.insertBefore(draggedRow, row);
                    } else {
                        row.parentNode.insertBefore(draggedRow, row.nextSibling);
                    }
                    this.updateOrderFromTable();
                }
            });

            row.addEventListener('drop', () => {
                this.updateOrderFromTable();
            });
        });
    }

    moveProduct(row, direction) {
        const tbody = row.parentNode;
        const rows = Array.from(tbody.querySelectorAll('tr[draggable="true"]'));
        const currentIndex = rows.indexOf(row);
        const newIndex = currentIndex + direction;

        if (newIndex < 0 || newIndex >= rows.length) return;

        // Swap positions in DOM
        if (direction === -1) {
            // Move up: insert before the row above
            tbody.insertBefore(row, rows[newIndex]);
        } else {
            // Move down: insert after the row below
            if (rows[newIndex].nextSibling) {
                tbody.insertBefore(row, rows[newIndex].nextSibling);
            } else {
                tbody.appendChild(row);
            }
        }

        this.updateOrderFromTable();
        this.renderProductsTable();
    }

    updateOrderFromTable() {
        const rows = document.querySelectorAll('#products-tbody tr[draggable="true"]');
        rows.forEach((row, index) => {
            const productId = row.dataset.id;
            const input = row.querySelector('.order-input');
            if (input) input.value = index + 1;

            const existing = this.data.productsOrder.find(p => p.id === productId);
            if (existing) {
                existing.position = index + 1;
            }
        });

        // Save order to localStorage
        if (this.data.selectedCategory) {
            const key = this.storageKeys.productOrders + this.data.selectedCategory;
            this.saveToStorage(key, JSON.stringify(this.data.productsOrder));
        }

        this.updateResetButton();
    }

    resetOrder() {
        this.data.productsOrder = this.data.originalOrder.map(o => ({ ...o }));
        if (this.data.selectedCategory) {
            const key = this.storageKeys.productOrders + this.data.selectedCategory;
            this.saveToStorage(key, JSON.stringify(this.data.productsOrder));
        }
        this.renderProductsTable();
        this.updateResetButton();
    }

    updateResetButton() {
        let resetBtn = document.getElementById('reset-order-btn');
        const isDifferent = this._orderChanged();

        if (isDifferent && !resetBtn) {
            const header = document.querySelector('.products-header');
            if (header) {
                resetBtn = document.createElement('button');
                resetBtn.id = 'reset-order-btn';
                resetBtn.className = 'btn-reset-order';
                resetBtn.textContent = 'Restaurar orden original';
                resetBtn.style.cssText = 'margin-left:auto;padding:0.4rem 0.8rem;background:var(--warning);color:#fff;border:none;border-radius:var(--radius-sm);cursor:pointer;font-size:0.8rem;font-weight:600;';
                header.appendChild(resetBtn);
                resetBtn.addEventListener('click', () => this.resetOrder());
            }
        } else if (!isDifferent && resetBtn) {
            resetBtn.remove();
        }
    }

    _orderChanged() {
        if (this.data.productsOrder.length !== this.data.originalOrder.length) return true;
        return this.data.productsOrder.some((o, i) =>
            o.id !== this.data.originalOrder[i].id || o.position !== this.data.originalOrder[i].position
        );
    }

    async updatePageEstimate() {
        const productsPerPage = this.data.productsPerPage || 4;
        const totalPages = Math.ceil(this.data.products.length / productsPerPage) + 2;
        document.getElementById('estimated-pages').innerHTML = `~<strong>${totalPages}</strong> páginas`;
    }

    updateGenerateButton() {
        const btn = document.getElementById('generate-btn');
        const hasCategory = !!this.data.selectedCategory;
        const hasProducts = this.data.products.length > 0;
        btn.disabled = !(hasCategory && hasProducts);
    }

    async generatePDF() {
        const backgroundUrl = document.getElementById('background-url').value;
        const coverPdf = document.getElementById('cover-pdf').files[0];
        const backCoverPdf = document.getElementById('back-cover-pdf').files[0];
        const titleInput = document.getElementById('category-title-input');
        const customTitle = titleInput ? titleInput.value : '';

        const formData = new FormData();
        formData.append('categoryId', this.data.selectedCategory);
        formData.append('productsPerPage', this.data.productsPerPage);
        formData.append('backgroundUrl', backgroundUrl);
        formData.append('products', JSON.stringify(this.data.productsOrder));
        formData.append('categoryTitle', customTitle);
        if (coverPdf) formData.append('cover_pdf', coverPdf);
        if (backCoverPdf) formData.append('back_cover_pdf', backCoverPdf);

        this.showLoading('Generando PDF...', 'Procesando productos y portadas');

        try {
            this.updateProgress(20);
            await this.delay(300);

            const response = await fetch('/api/generate-pdf', {
                method: 'POST',
                body: formData
            });

            this.updateProgress(60);
            await this.delay(300);

            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.detail || 'Error generando PDF');
            }

            this.updateProgress(90);
            await this.delay(200);

            const blob = await response.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;

            const categoryName = (customTitle || this.data.categories.find(c =>
                c.categoryId === this.data.selectedCategory || c.id === this.data.selectedCategory
            )?.title || 'catalogo');

            a.download = `catalogo_${categoryName.toLowerCase().replace(/\s+/g, '_')}_${Date.now()}.pdf`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            window.URL.revokeObjectURL(url);

            this.updateProgress(100);
            await this.delay(500);

            this.hideLoading();
            this.showToast('PDF generado exitosamente', 'success');

        } catch (error) {
            this.hideLoading();
            this.showToast(error.message, 'error');
        }
    }

    showLoading(title, message) {
        document.getElementById('loading-title').textContent = title;
        document.getElementById('loading-message').textContent = message;
        document.getElementById('progress-fill').style.width = '0%';
        document.getElementById('loading-overlay').style.display = 'flex';
    }

    updateProgress(percent) {
        document.getElementById('progress-fill').style.width = percent + '%';
    }

    hideLoading() {
        setTimeout(() => {
            document.getElementById('loading-overlay').style.display = 'none';
        }, 300);
    }

    showToast(message, type = 'success') {
        const toast = document.getElementById('toast');
        toast.textContent = message;
        toast.className = `toast-modern ${type}`;
        toast.style.display = 'flex';
        setTimeout(() => { toast.style.display = 'none'; }, 4000);
    }

    showError(message) {
        this.showToast(message, 'error');
    }

    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

document.addEventListener('DOMContentLoaded', () => {
    new PDFCatalogApp();
});
