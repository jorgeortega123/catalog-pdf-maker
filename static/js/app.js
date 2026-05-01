/**
 * PDF Catalog Generator v2
 */
class PDFCatalogApp {
    constructor() {
        this.data = {
            categories: [],
            colecciones: [],
            products: [],
            selectedCategory: null,
            selectedColeccion: null,
            productsPerPage: 4,
            currentOrderIds: [],    // array of product IDs in current display order
            originalOrderIds: []    // array of product IDs as they came from API
        };

        this.storageKeys = {
            productsPerPage: 'pdf_products_per_page',
            orders: 'pdf_order_',          // + categoryId
            titles: 'pdf_title_'           // + categoryId
        };

        this.init();
    }

    init() {
        this.loadSettings();
        this.bindEvents();
        this.loadCategories();
        this.loadColecciones();
    }

    // ── Settings ──────────────────────────────────

    loadSettings() {
        const ppp = localStorage.getItem(this.storageKeys.productsPerPage) || '4';
        this.data.productsPerPage = parseInt(ppp);

        document.querySelectorAll('.layout-option-compact').forEach(opt => {
            opt.classList.toggle('selected', parseInt(opt.dataset.products) === this.data.productsPerPage);
        });
    }

    // ── Events ────────────────────────────────────

    bindEvents() {
        // Category click
        document.getElementById('categories-grid').addEventListener('click', (e) => {
            const card = e.target.closest('.category-card-compact');
            if (card) {
                this.data.selectedColeccion = null;
                document.querySelectorAll('.coleccion-chip').forEach(c => c.classList.remove('selected'));
                this.selectCategory(card.dataset.id);
            }
        });

        // Coleccion click
        document.getElementById('colecciones-grid').addEventListener('click', (e) => {
            const chip = e.target.closest('.coleccion-chip');
            if (chip) {
                this.data.selectedCategory = null;
                document.querySelectorAll('.category-card-compact').forEach(c => c.classList.remove('selected'));
                this.selectColeccion(chip.dataset.title);
            }
        });

        // PDF file inputs - preview con PDF.js
        const self = this;
        ['cover-pdf', 'back-cover-pdf', 'background-pdf'].forEach(id => {
            document.getElementById(id).addEventListener('change', function () {
                const file = this.files[0];
                const previewId = id === 'background-pdf' ? 'background-preview' : id.replace('-pdf', '-preview');
                const preview = document.getElementById(previewId);
                if (!file) { preview.innerHTML = ''; return; }
                self.previewPDF(file, preview);
            });
        });

        // Products per page
        document.querySelectorAll('.layout-option-compact').forEach(option => {
            option.addEventListener('click', () => {
                document.querySelectorAll('.layout-option-compact').forEach(o => o.classList.remove('selected'));
                option.classList.add('selected');
                this.data.productsPerPage = parseInt(option.dataset.products);
                localStorage.setItem(this.storageKeys.productsPerPage, this.data.productsPerPage);
                this.updatePageEstimate();
            });
        });

        // Product table: move up/down
        document.getElementById('products-tbody').addEventListener('click', (e) => {
            const up = e.target.closest('.btn-move-up');
            const down = e.target.closest('.btn-move-down');
            if (up) this.moveProduct(up.closest('tr').dataset.id, -1);
            if (down) this.moveProduct(down.closest('tr').dataset.id, 1);
        });

        // Generate
        document.getElementById('generate-btn').addEventListener('click', () => this.generatePDF());

    }

    // ── Categories ────────────────────────────────

    async loadCategories() {
        try {
            const res = await fetch('/api/categories');
            if (!res.ok) throw new Error();
            this.data.categories = await res.json();
            this.renderCategories();
        } catch {
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

    // ── Select Category & Load Products ───────────

    async selectCategory(categoryId) {
        document.querySelectorAll('.category-card-compact').forEach(card => {
            card.classList.toggle('selected', card.dataset.id === categoryId);
        });

        const tbody = document.getElementById('products-tbody');
        tbody.innerHTML = `<tr><td colspan="6" class="empty-state"><div class="loading">Cargando productos...</div></td></tr>`;

        try {
            const res = await fetch(`/api/products/${categoryId}`);
            if (!res.ok) throw new Error('Error cargando productos');
            const data = await res.json();

            this.data.products = data.products || [];
            this.data.selectedCategory = categoryId;

            // Original order = IDs as they came from API
            this.data.originalOrderIds = this.data.products.map(p => p.id);

            // Check saved order in localStorage
            const savedKey = this.storageKeys.orders + categoryId;
            const savedRaw = localStorage.getItem(savedKey);
            let useSaved = false;

            if (savedRaw) {
                try {
                    const savedIds = JSON.parse(savedRaw);
                    const productIds = new Set(this.data.products.map(p => p.id));
                    if (savedIds.length === this.data.products.length && savedIds.every(id => productIds.has(id))) {
                        this.data.currentOrderIds = savedIds;
                        useSaved = true;
                    }
                } catch { /* ignore */ }
            }

            if (!useSaved) {
                this.data.currentOrderIds = [...this.data.originalOrderIds];
            }

            // Load title
            const cat = this.data.categories.find(c => c.categoryId === categoryId || c.id === categoryId);
            document.getElementById('category-title-input').value = cat ? `Catálogo ${cat.title} - Jandrea` : '';

            this.renderProductsTable();
            this.updateResetButton();
            this.updateGenerateButton();

        } catch (error) {
            this.showError(error.message);
            tbody.innerHTML = `<tr><td colspan="6" class="empty-state" style="color:var(--danger);">${error.message}</td></tr>`;
        }
    }

    // ── Colecciones ───────────────────────────────

    async loadColecciones() {
        try {
            const res = await fetch('/api/colecciones');
            if (!res.ok) throw new Error();
            this.data.colecciones = await res.json();
            this.renderColecciones();
        } catch {
            document.getElementById('colecciones-grid').innerHTML = '<div class="empty-state" style="grid-column:1/-1;text-align:center;color:var(--text-light);padding:1rem;">No se pudieron cargar las colecciones</div>';
        }
    }

    renderColecciones() {
        const grid = document.getElementById('colecciones-grid');
        if (!this.data.colecciones.length) {
            grid.innerHTML = '<div class="empty-state" style="grid-column:1/-1;text-align:center;color:var(--text-light);padding:1rem;">No hay colecciones</div>';
            return;
        }
        grid.innerHTML = this.data.colecciones.map(col => {
            const title = col.title || col.word || 'Sin título';
            const word = col.word || '';
            const type = col.type || '';
            return `
                <div class="coleccion-chip" data-title="${title}" data-word="${word}">
                    <div class="coleccion-title">${title}</div>
                    ${word ? `<div class="coleccion-type">Tag: ${word}</div>` : ''}
                    ${type ? `<div class="coleccion-type">${type}</div>` : ''}
                </div>
            `;
        }).join('');
    }

    async selectColeccion(title) {
        document.querySelectorAll('.coleccion-chip').forEach(chip => {
            chip.classList.toggle('selected', chip.dataset.title === title);
        });

        const tbody = document.getElementById('products-tbody');
        tbody.innerHTML = `<tr><td colspan="6" class="empty-state"><div class="loading">Cargando productos de colección...</div></td></tr>`;

        try {
            const res = await fetch('/api/colecciones/productos', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ title })
            });
            if (!res.ok) throw new Error('Error cargando productos de colección');
            const data = await res.json();

            this.data.products = data.products || [];
            this.data.selectedColeccion = title;
            this.data.selectedCategory = null;

            this.data.originalOrderIds = this.data.products.map(p => p.id);

            const savedKey = this.storageKeys.orders + 'col_' + title;
            const savedRaw = localStorage.getItem(savedKey);
            let useSaved = false;

            if (savedRaw) {
                try {
                    const savedIds = JSON.parse(savedRaw);
                    const productIds = new Set(this.data.products.map(p => p.id));
                    if (savedIds.length === this.data.products.length && savedIds.every(id => productIds.has(id))) {
                        this.data.currentOrderIds = savedIds;
                        useSaved = true;
                    }
                } catch { /* ignore */ }
            }

            if (!useSaved) {
                this.data.currentOrderIds = [...this.data.originalOrderIds];
            }

            document.getElementById('category-title-input').value = `Catálogo ${title} - Jandrea`;

            this.renderProductsTable();
            this.updateResetButton();
            this.updateGenerateButton();

        } catch (error) {
            this.showError(error.message);
            tbody.innerHTML = `<tr><td colspan="6" class="empty-state" style="color:var(--danger);">${error.message}</td></tr>`;
        }
    }

    // ── Products Table ────────────────────────────

    getProductById(id) {
        return this.data.products.find(p => p.id === id);
    }

    renderProductsTable() {
        const tbody = document.getElementById('products-tbody');

        if (!this.data.currentOrderIds.length) {
            tbody.innerHTML = `<tr><td colspan="6" class="empty-state">Selecciona una categoría</td></tr>`;
            return;
        }

        const lastIndex = this.data.currentOrderIds.length - 1;

        tbody.innerHTML = this.data.currentOrderIds.map((id, index) => {
            const product = this.getProductById(id);
            if (!product) return '';

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
            <tr data-id="${id}" draggable="true">
                <td><input type="number" class="order-input" value="${index + 1}" min="1" max="${lastIndex + 1}" readonly></td>
                <td><img src="${image}" alt="${title}" class="product-thumbnail"
                    onerror="this.src='data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%2245%22 height=%2245%22%3E%3Crect fill=%22%23ddd%22 width=%2245%22 height=%2245%22/%3E%3C/svg%3E'"></td>
                <td><div style="font-weight:500;">${title}</div></td>
                <td><span style="font-weight:600;color:var(--primary);">$${price.toFixed(2)}</span></td>
                <td><span style="font-size:0.85rem;color:var(--text-light);">${measurements}</span></td>
                <td>
                    <div class="action-buttons">
                        <button class="btn-action btn-move-up" ${index === 0 ? 'disabled' : ''}>↑</button>
                        <button class="btn-action btn-move-down" ${index === lastIndex ? 'disabled' : ''}>↓</button>
                    </div>
                </td>
            </tr>`;
        }).join('');

        document.getElementById('total-products').innerHTML = `<strong>${this.data.currentOrderIds.length}</strong> productos`;
        this.updatePageEstimate();
        this.setupDragAndDrop();
    }

    // ── Move Product ──────────────────────────────

    moveProduct(productId, direction) {
        const ids = this.data.currentOrderIds;
        const idx = ids.indexOf(productId);
        if (idx === -1) return;

        const newIdx = idx + direction;
        if (newIdx < 0 || newIdx >= ids.length) return;

        // Swap
        [ids[idx], ids[newIdx]] = [ids[newIdx], ids[idx]];

        this.saveOrder();
        this.renderProductsTable();
        this.updateResetButton();
    }

    // ── Drag & Drop ───────────────────────────────

    setupDragAndDrop() {
        const tbody = document.getElementById('products-tbody');
        let draggedId = null;

        tbody.querySelectorAll('tr[draggable="true"]').forEach(row => {
            row.addEventListener('dragstart', () => {
                draggedId = row.dataset.id;
                row.classList.add('dragging');
            });
            row.addEventListener('dragend', () => {
                row.classList.remove('dragging');
                draggedId = null;
            });
            row.addEventListener('dragover', (e) => {
                e.preventDefault();
                if (!draggedId || draggedId === row.dataset.id) return;
                const rect = row.getBoundingClientRect();
                const mid = rect.top + rect.height / 2;
                // Get current DOM order as our new order
                const allRows = Array.from(tbody.querySelectorAll('tr[draggable="true"]'));
                const draggedRow = tbody.querySelector(`tr[data-id="${draggedId}"]`);
                if (e.clientY < mid) {
                    row.parentNode.insertBefore(draggedRow, row);
                } else {
                    row.parentNode.insertBefore(draggedRow, row.nextSibling);
                }
            });
            row.addEventListener('drop', () => {
                // Read final DOM order
                const newOrder = Array.from(tbody.querySelectorAll('tr[draggable="true"]')).map(r => r.dataset.id);
                this.data.currentOrderIds = newOrder;
                this.saveOrder();
                this.renderProductsTable();
                this.updateResetButton();
            });
        });
    }

    // ── Order Persistence ─────────────────────────

    saveOrder() {
        const key = this.data.selectedColeccion
            ? this.storageKeys.orders + 'col_' + this.data.selectedColeccion
            : this.data.selectedCategory
                ? this.storageKeys.orders + this.data.selectedCategory
                : null;
        if (key) {
            localStorage.setItem(key, JSON.stringify(this.data.currentOrderIds));
        }
    }

    updateResetButton() {
        let btn = document.getElementById('reset-order-btn');
        const changed = this._orderChanged();

        if (changed && !btn) {
            const header = document.querySelector('.products-header');
            btn = document.createElement('button');
            btn.id = 'reset-order-btn';
            btn.textContent = 'Restaurar orden';
            btn.style.cssText = 'margin-left:auto;padding:0.4rem 0.8rem;background:var(--warning);color:#fff;border:none;border-radius:var(--radius-sm);cursor:pointer;font-size:0.8rem;font-weight:600;';
            btn.addEventListener('click', () => this.resetOrder());
            header.appendChild(btn);
        } else if (!changed && btn) {
            btn.remove();
        }
    }

    _orderChanged() {
        const curr = this.data.currentOrderIds;
        const orig = this.data.originalOrderIds;
        if (curr.length !== orig.length) return true;
        return curr.some((id, i) => id !== orig[i]);
    }

    resetOrder() {
        this.data.currentOrderIds = [...this.data.originalOrderIds];
        this.saveOrder();
        this.renderProductsTable();
        this.updateResetButton();
    }

    // ── Generate PDF ──────────────────────────────

    updateGenerateButton() {
        const hasSelection = this.data.selectedCategory || this.data.selectedColeccion;
        document.getElementById('generate-btn').disabled = !hasSelection || !this.data.products.length;
    }

    async updatePageEstimate() {
        const total = Math.ceil(this.data.products.length / this.data.productsPerPage) + 2;
        document.getElementById('estimated-pages').innerHTML = `~<strong>${total}</strong> páginas`;
    }

    async generatePDF() {
        const coverPdf = document.getElementById('cover-pdf').files[0];
        const backCoverPdf = document.getElementById('back-cover-pdf').files[0];
        const backgroundPdf = document.getElementById('background-pdf').files[0];
        const customTitle = document.getElementById('category-title-input').value;

        // Build productsOrder from currentOrderIds
        const productsOrder = this.data.currentOrderIds.map((id, i) => ({
            id: id,
            position: i + 1
        }));

        const formData = new FormData();
        formData.append('categoryId', this.data.selectedCategory || '');
        formData.append('productsPerPage', this.data.productsPerPage);
        formData.append('products', JSON.stringify(productsOrder));
        formData.append('categoryTitle', customTitle);
        // Send full product data for collections (no categoryId to filter on backend)
        if (this.data.selectedColeccion) {
            const orderedProducts = this.data.currentOrderIds.map(id => this.getProductById(id)).filter(Boolean);
            formData.append('productsData', JSON.stringify(orderedProducts));
        }
        if (coverPdf) formData.append('cover_pdf', coverPdf);
        if (backCoverPdf) formData.append('back_cover_pdf', backCoverPdf);
        if (backgroundPdf) formData.append('background_pdf', backgroundPdf);

        this.showLoading('Generando PDF...', 'Procesando productos y portadas');

        try {
            this.updateProgress(20);
            await this.delay(300);

            const response = await fetch('/api/generate-pdf', { method: 'POST', body: formData });
            this.updateProgress(60);

            if (!response.ok) {
                const err = await response.json();
                throw new Error(err.detail || 'Error generando PDF');
            }

            this.updateProgress(90);

            const blob = await response.blob();
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            const name = customTitle || 'Catálogo';
            const rand = Math.floor(Math.random() * 900) + 100;
            a.download = `${name} - ${rand}.pdf`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);

            this.updateProgress(100);
            await this.delay(500);
            this.hideLoading();
            this.showToast('PDF generado exitosamente', 'success');
        } catch (error) {
            this.hideLoading();
            this.showToast(error.message, 'error');
        }
    }

    // ── UI Helpers ────────────────────────────────

    async previewPDF(file, previewEl) {
        previewEl.innerHTML = '<div class="loading" style="padding:0.5rem;font-size:0.8rem;">Cargando...</div>';
        try {
            const arrayBuffer = await file.arrayBuffer();
            const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
            previewEl.innerHTML = '';
            for (let i = 1; i <= pdf.numPages; i++) {
                const page = await pdf.getPage(i);
                const viewport = page.getViewport({ scale: 0.3 });
                const canvas = document.createElement('canvas');
                canvas.width = viewport.width;
                canvas.height = viewport.height;
                canvas.style.cssText = 'border:1px solid var(--border);border-radius:4px;display:block;';
                const ctx = canvas.getContext('2d');
                await page.render({ canvasContext: ctx, viewport }).promise;
                previewEl.appendChild(canvas);
            }
            const info = document.createElement('div');
            info.style.cssText = 'width:100%;text-align:center;font-size:0.75rem;color:var(--text-light);padding-top:4px;';
            info.textContent = `${pdf.numPages} página${pdf.numPages > 1 ? 's' : ''}`;
            previewEl.appendChild(info);
        } catch (e) {
            previewEl.innerHTML = '<span style="color:var(--danger);font-size:0.8rem;">Error al previsualizar</span>';
        }
    }

    showLoading(title, message) {
        document.getElementById('loading-title').textContent = title;
        document.getElementById('loading-message').textContent = message;
        document.getElementById('progress-fill').style.width = '0%';
        document.getElementById('loading-overlay').style.display = 'flex';
    }

    updateProgress(p) { document.getElementById('progress-fill').style.width = p + '%'; }

    hideLoading() {
        setTimeout(() => { document.getElementById('loading-overlay').style.display = 'none'; }, 300);
    }

    showToast(message, type = 'success') {
        const toast = document.getElementById('toast');
        toast.textContent = message;
        toast.className = `toast-modern ${type}`;
        toast.style.display = 'flex';
        setTimeout(() => { toast.style.display = 'none'; }, 4000);
    }

    showError(message) { this.showToast(message, 'error'); }

    delay(ms) { return new Promise(r => setTimeout(r, ms)); }
}

document.addEventListener('DOMContentLoaded', () => { new PDFCatalogApp(); });
