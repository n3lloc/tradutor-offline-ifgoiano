// ============================================================
// SMART READER — Full-Featured PDF Reader
// ============================================================

// --- STATE ---
let currentLibraryDocs = [];
let pdfDoc = null;
let pageNum = 1;
let pageRendering = false;
let pageNumPending = null;
let scale = 1.25;
let currentDocId = null;
let annotationsCache = [];
let annotationsCache2 = [];
let translationsCache = [];
let translationsCache2 = [];
let currentMode = 'text';   // 'text' | 'image'
let commentMode = false;
let dualPage = true;
let pendingAnnotation = null; // {x, y, page, relX, relY}
let activeRenderTask = null;
let activeRenderTask2 = null;

// --- STATUS BAR ---
function showStatus(text, persist = false) {
    let container = document.getElementById('reader-status-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'reader-status-container';
        container.style.cssText = 'position:fixed; bottom:20px; right:20px; z-index:1000; display:flex; flex-direction:column; gap:8px; align-items:flex-end; pointer-events:none;';
        document.body.appendChild(container);
    }
    
    const id = 'status-' + Math.random().toString(36).substr(2, 9);
    const div = document.createElement('div');
    div.id = id;
    div.style.cssText = 'background:rgba(15,23,42,0.88); color:#fff; padding:10px 16px; border-radius:10px; font-size:0.82rem; backdrop-filter:blur(6px); display:flex; align-items:center; gap:8px; max-width:280px; box-shadow:0 4px 12px rgba(0,0,0,0.2); transition: opacity 0.3s ease; pointer-events:auto;';
    div.innerHTML = `<span class="spinner" style="border-color:rgba(255,255,255,0.3);border-left-color:#fff;width:14px;height:14px;"></span> <span>${text}</span>`;
    container.appendChild(div);
    
    const hideFunc = () => {
        const el = document.getElementById(id);
        if (el) {
            el.style.opacity = '0';
            setTimeout(() => el.remove(), 300);
        }
    };

    if (!persist) {
        setTimeout(hideFunc, 3000);
    }

    return {
        id,
        update: (newText, done=false) => {
            const el = document.getElementById(id);
            if (!el) return;
            if (done) {
                el.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"></polyline></svg> <span>${newText}</span>`;
                setTimeout(hideFunc, 2500);
            } else {
                el.innerHTML = `<span class="spinner" style="border-color:rgba(255,255,255,0.3);border-left-color:#fff;width:14px;height:14px;"></span> <span>${newText}</span>`;
            }
        },
        hide: hideFunc
    };
}

// --- CUSTOM CONFIRM ---
function customConfirm(message) {
    return new Promise(resolve => {
        const modal = document.getElementById('confirm-modal');
        const msg = document.getElementById('confirm-message');
        const ok = document.getElementById('confirm-ok');
        const cancel = document.getElementById('confirm-cancel');
        msg.textContent = message;
        modal.style.display = 'flex';
        const cleanup = () => { modal.style.display = 'none'; };
        ok.onclick = () => { cleanup(); resolve(true); };
        cancel.onclick = () => { cleanup(); resolve(false); };
    });
}

// --- LIBRARY ---
function loadLibrary() {
    fetch('/api/library/list')
        .then(r => r.json())
        .then(data => {
            if (data.success) {
                currentLibraryDocs = data.documents;
                renderLibrary();
            }
        })
        .catch(err => console.error('Erro ao carregar biblioteca:', err));
}

function renderLibrary() {
    const list = document.getElementById('library-list');
    const title = document.getElementById('library-title');
    if (!list) return;
    list.innerHTML = '';

    if (currentLibraryDocs.length === 0) {
        if (title) title.style.display = 'none';
        return;
    }
    if (title) title.style.display = 'block';

    currentLibraryDocs.forEach(doc => {
        const card = document.createElement('div');
        card.style.cssText = 'background:#fff; border:1px solid var(--border-color); border-radius:10px; padding:0; box-shadow:0 1px 4px rgba(0,0,0,0.06); position:relative; cursor:pointer; transition:transform 0.15s, box-shadow 0.15s; overflow:hidden;';
        card.onmouseenter = () => { card.style.transform = 'translateY(-2px)'; card.style.boxShadow = '0 6px 18px rgba(0,0,0,0.1)'; };
        card.onmouseleave = () => { card.style.transform = ''; card.style.boxShadow = '0 1px 4px rgba(0,0,0,0.06)'; };

        // Thumbnail area
        const thumbDiv = document.createElement('div');
        thumbDiv.style.cssText = 'height:130px; background:#f1f5f9; display:flex; align-items:center; justify-content:center; position:relative; overflow:hidden;';
        const thumbCanvas = document.createElement('canvas');
        thumbCanvas.style.cssText = 'position:absolute; inset:0; width:100%; height:100%; object-fit:cover;';
        thumbDiv.appendChild(thumbCanvas);
        card.appendChild(thumbDiv);

        // Generate thumbnail
        generateThumbnail(doc.filepath, thumbCanvas);

        // Annotation badge
        if (doc.annotation_count > 0) {
            const badge = document.createElement('div');
            badge.style.cssText = 'position:absolute; top:8px; right:8px; background:#fbbf24; color:#78350f; border-radius:12px; padding:2px 8px; font-size:0.7rem; font-weight:700; display:flex; align-items:center; gap:3px;';
            badge.innerHTML = `<svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg> ${doc.annotation_count}`;
            thumbDiv.appendChild(badge);
        }

        // Delete btn
        const delBtn = document.createElement('button');
        delBtn.style.cssText = 'position:absolute; top:6px; left:6px; background:rgba(255,255,255,0.85); border:none; cursor:pointer; color:#ef4444; border-radius:50%; width:26px; height:26px; display:flex; align-items:center; justify-content:center; transition:color 0.15s, background 0.15s; backdrop-filter:blur(4px);';
        delBtn.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M3 6h18"></path><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>';
        delBtn.title = 'Excluir';
        delBtn.onmouseenter = () => { delBtn.style.color = '#dc2626'; delBtn.style.background = 'rgba(255,255,255,1)'; };
        delBtn.onmouseleave = () => { delBtn.style.color = '#ef4444'; delBtn.style.background = 'rgba(255,255,255,0.85)'; };
        delBtn.onclick = (e) => { e.stopPropagation(); deleteDoc(doc.id); };
        thumbDiv.appendChild(delBtn);

        // Info area
        const infoDiv = document.createElement('div');
        infoDiv.style.cssText = 'padding:10px 12px;';
        infoDiv.innerHTML = `
            <strong style="font-size:0.82rem; word-break:break-all; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; color:var(--text-main); line-height:1.4;">${doc.filename}</strong>
            <div style="font-size:0.72rem; color:#94a3b8; margin-top:4px;">Pág. ${doc.current_page}</div>
        `;
        card.appendChild(infoDiv);
        card.onclick = () => openReader(doc.id, doc.filepath, doc.current_page);
        list.appendChild(card);
    });
}

function generateThumbnail(filepath, canvas) {
    const url = '/uploads/' + filepath;
    pdfjsLib.getDocument(url).promise.then(pdf => {
        pdf.getPage(1).then(page => {
            const vp = page.getViewport({ scale: 0.3 });
            canvas.width = vp.width;
            canvas.height = vp.height;
            page.render({ canvasContext: canvas.getContext('2d', { willReadFrequently: true }), viewport: vp });
        });
    }).catch(() => {}); // silently ignore thumbnail errors
}

function handleLibraryFiles(files) {
    if (files.length === 0) return;
    const file = files[0];
    const formData = new FormData();
    formData.append('file', file);

    const area = document.getElementById('library-drop-area');
    const uploadText = area.querySelector('.upload-text');
    const orig = uploadText.textContent;
    area.style.opacity = '0.6';
    area.style.pointerEvents = 'none';
    uploadText.textContent = 'Enviando...';

    fetch('/api/library/upload', { method: 'POST', body: formData })
        .then(r => r.json())
        .then(data => {
            area.style.opacity = '1';
            area.style.pointerEvents = '';
            uploadText.textContent = orig;
            if (data.success) {
                openReader(data.id, data.filepath, 1);
            } else {
                alert('Erro ao enviar: ' + (data.error || 'desconhecido'));
            }
        })
        .catch(err => {
            area.style.opacity = '1';
            area.style.pointerEvents = '';
            uploadText.textContent = orig;
            console.error(err);
        });
}

async function deleteDoc(id) {
    const ok = await customConfirm('Tem certeza que deseja excluir este PDF da biblioteca?');
    if (!ok) return;
    fetch('/api/library/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id })
    }).then(() => loadLibrary());
}

// --- READER ---
function openReader(docId, filepath, startPage) {
    const libraryView = document.getElementById('library-view');
    const readerView = document.getElementById('reader-view');
    if (!libraryView || !readerView) return;

    libraryView.style.display = 'none';
    readerView.style.display = 'block';
    document.body.classList.add('fullscreen-reader');

    currentDocId = docId;
    pageNum = startPage || 1;
    translationsCache = [];
    annotationsCache = [];

    populateReaderModelSelect();

    const url = '/uploads/' + filepath;
    pdfjsLib.getDocument(url).promise.then(pdfDoc_ => {
        pdfDoc = pdfDoc_;
        document.getElementById('page_count').textContent = pdfDoc.numPages;
        fetchAllForPage(pageNum);
    }).catch(err => {
        console.error('Erro ao carregar PDF:', err);
        exitReader();
    });
}

function exitReader() {
    document.body.classList.remove('fullscreen-reader');
    document.getElementById('reader-view').style.display = 'none';
    document.getElementById('library-view').style.display = 'block';
    pdfDoc = null;
    currentDocId = null;
    setMode('text');
    commentMode = false;
    const btnComment = document.getElementById('btn-mode-comment');
    if (btnComment) btnComment.classList.remove('r-mode-active');
    const tooltip = document.getElementById('translation-tooltip');
    if (tooltip) tooltip.style.display = 'none';
    hideFloatingTranslateBtn();
    loadLibrary();
}

function saveProgress() {
    if (currentDocId) {
        fetch('/api/library/save_progress', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: currentDocId, page: pageNum })
        });
    }
}

function fetchAllForPage(num) {
    Promise.all([
        fetch('/api/library/get_translations?doc_id=' + currentDocId + '&page_index=' + num).then(r => r.json()),
        fetch('/api/annotations/list?doc_id=' + currentDocId + '&page_index=' + num).then(r => r.json())
    ]).then(([transData, annData]) => {
        translationsCache = transData.translations || [];
        annotationsCache = annData.annotations || [];
        queueRenderPage(num);
    }).catch(() => {
        translationsCache = [];
        annotationsCache = [];
        queueRenderPage(num);
    });
}

function renderPage(num) {
    pageRendering = true;
    document.getElementById('page_num').textContent = num;
    saveProgress();

    pdfDoc.getPage(num).then(page => {
        const viewport = page.getViewport({ scale });
        const container = document.getElementById('pdf-container');
        const canvas = document.getElementById('pdf-canvas');
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        const textLayerDiv = document.getElementById('pdf-text-layer');
        const drawCanvas = document.getElementById('draw-canvas');
        const annLayer = document.getElementById('annotations-layer');

        // Set --scale-factor to fix pdf.js v3 warning
        container.style.setProperty('--scale-factor', scale);

        container.style.width = viewport.width + 'px';
        container.style.height = viewport.height + 'px';
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        drawCanvas.width = viewport.width;
        drawCanvas.height = viewport.height;

        if (activeRenderTask) {
            try { activeRenderTask.cancel(); } catch(e) {}
        }
        const renderTask = page.render({ canvasContext: ctx, viewport });
        activeRenderTask = renderTask;

        renderTask.promise.then(() => page.getTextContent()).then(textContent => {
            activeRenderTask = null;
            textLayerDiv.innerHTML = '';
            textLayerDiv.style.width = viewport.width + 'px';
            textLayerDiv.style.height = viewport.height + 'px';
            textLayerDiv.style.setProperty('--scale-factor', viewport.scale);

            const tl = pdfjsLib.renderTextLayer({
                textContentSource: textContent,
                container: textLayerDiv,
                viewport,
                textDivs: []
            });
            (tl.promise || Promise.resolve()).then(() => {
                applyHighlights();
                renderAnnotations(annLayer, viewport);
                updateCaptureOverlaysVisibility();
                pageRendering = false;
                if (pageNumPending !== null) {
                    const p = pageNumPending;
                    pageNumPending = null;
                    renderPage(p);
                }
            }).catch(() => { pageRendering = false; });
        }).catch(err => {
            if (err && err.name === 'RenderingCancelledException') {
                return;
            }
            console.error(err);
            pageRendering = false;
        });
    });

    // Render second page in dual mode
    if (dualPage && pdfDoc && num + 1 <= pdfDoc.numPages) {
        renderSecondPage(num + 1);
    } else {
        document.getElementById('pdf-container-2').style.display = 'none';
    }
}

function renderSecondPage(num) {
    const c2 = document.getElementById('pdf-container-2');
    const canvas2 = document.getElementById('pdf-canvas-2');
    const textLayerDiv2 = document.getElementById('pdf-text-layer-2');
    const drawCanvas2 = document.getElementById('draw-canvas-2');
    const annLayer2 = document.getElementById('annotations-layer-2');
    
    c2.style.display = 'block';
    
    // Fetch annotations/translations for the second page
    Promise.all([
        fetch('/api/library/get_translations?doc_id=' + currentDocId + '&page_index=' + num).then(r => r.json()),
        fetch('/api/annotations/list?doc_id=' + currentDocId + '&page_index=' + num).then(r => r.json())
    ]).then(([transData, annData]) => {
        translationsCache2 = transData.translations || [];
        const anns2 = annData.annotations || [];
        
        pdfDoc.getPage(num).then(page => {
            const viewport = page.getViewport({ scale });
            c2.style.setProperty('--scale-factor', scale);
            
            canvas2.width = viewport.width;
            canvas2.height = viewport.height;
            drawCanvas2.width = viewport.width;
            drawCanvas2.height = viewport.height;
            c2.style.width = viewport.width + 'px';
            c2.style.height = viewport.height + 'px';
            
            if (activeRenderTask2) {
                try { activeRenderTask2.cancel(); } catch(e) {}
            }
            const renderTask = page.render({ canvasContext: canvas2.getContext('2d', { willReadFrequently: true }), viewport });
            activeRenderTask2 = renderTask;
            
            renderTask.promise.then(() => page.getTextContent()).then(textContent => {
                activeRenderTask2 = null;
                textLayerDiv2.innerHTML = '';
                textLayerDiv2.style.width = viewport.width + 'px';
                textLayerDiv2.style.height = viewport.height + 'px';
                textLayerDiv2.style.setProperty('--scale-factor', viewport.scale);

                const tl = pdfjsLib.renderTextLayer({
                    textContentSource: textContent,
                    container: textLayerDiv2,
                    viewport,
                    textDivs: []
                });
                (tl.promise || Promise.resolve()).then(() => {
                    applyHighlightsForLayer(textLayerDiv2, translationsCache2);
                    renderAnnotationsForLayer(annLayer2, viewport, anns2, num);
                    updateCaptureOverlaysVisibility();
                });
            }).catch(err => {
                if (err && err.name === 'RenderingCancelledException') {
                    return;
                }
                console.error(err);
            });
        });
    }).catch(console.error);
}

function queueRenderPage(num) {
    if (pageRendering) {
        pageNumPending = num;
    } else {
        renderPage(num);
    }
}

function prevPage() {
    if (pageNum <= 1) return;
    pageNum -= dualPage ? 2 : 1;
    if (pageNum < 1) pageNum = 1;
    fetchAllForPage(pageNum);
}

function nextPage() {
    if (!pdfDoc || pageNum >= pdfDoc.numPages) return;
    pageNum += dualPage ? 2 : 1;
    if (pageNum > pdfDoc.numPages) pageNum = pdfDoc.numPages;
    fetchAllForPage(pageNum);
}

// --- ZOOM ---
function zoomIn() {
    scale = Math.min(scale + 0.25, 4.0);
    updateZoomLabel();
    queueRenderPage(pageNum);
}

function zoomOut() {
    scale = Math.max(scale - 0.25, 0.5);
    updateZoomLabel();
    queueRenderPage(pageNum);
}

function updateZoomLabel() {
    const lbl = document.getElementById('zoom_percent') || document.getElementById('zoom-label');
    if (lbl) lbl.textContent = Math.round(scale * 100) + '%';
}

// --- DUAL PAGE ---
function toggleDualPage() {
    dualPage = !dualPage;
    const btn = document.getElementById('btn-dual');
    if (btn) btn.classList.toggle('active', dualPage);
    queueRenderPage(pageNum);
}

// --- KEYBOARD & MOUSE ZOOM ---
document.addEventListener('keydown', e => {
    if (!document.body.classList.contains('fullscreen-reader')) return;
    if (e.target.tagName === 'TEXTAREA' || e.target.tagName === 'INPUT') return;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') nextPage();
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') prevPage();
    else if (e.key === '+' || e.key === '=') zoomIn();
    else if (e.key === '-') zoomOut();
});

document.addEventListener('wheel', e => {
    if (!document.body.classList.contains('fullscreen-reader')) return;
    if (e.ctrlKey) {
        e.preventDefault();
        if (e.deltaY < 0) zoomIn();
        else zoomOut();
    }
}, { passive: false });

// --- MODE ---
function setMode(mode) {
    currentMode = mode;
    commentMode = (mode === 'comment');
    const drawCanvas = document.getElementById('draw-canvas');
    const drawCanvas2 = document.getElementById('draw-canvas-2');
    const textLayer = document.getElementById('pdf-text-layer');
    const textLayer2 = document.getElementById('pdf-text-layer-2');

    document.getElementById('btn-mode-text').classList.toggle('r-mode-active', mode === 'text');
    document.getElementById('btn-mode-image').classList.toggle('r-mode-active', mode === 'image');
    const btnComment = document.getElementById('btn-mode-comment');
    if (btnComment) btnComment.classList.toggle('r-mode-active', mode === 'comment');

    if (mode === 'image') {
        if (drawCanvas) drawCanvas.style.display = 'block';
        if (drawCanvas2) drawCanvas2.style.display = 'block';
        if (textLayer) textLayer.style.pointerEvents = 'none';
        if (textLayer2) textLayer2.style.pointerEvents = 'none';
        setupDrawCanvas();
    } else {
        if (drawCanvas) {
            drawCanvas.style.display = 'none';
            drawCanvas.getContext('2d', { willReadFrequently: true }).clearRect(0, 0, drawCanvas.width, drawCanvas.height);
        }
        if (drawCanvas2) {
            drawCanvas2.style.display = 'none';
            drawCanvas2.getContext('2d', { willReadFrequently: true }).clearRect(0, 0, drawCanvas2.width, drawCanvas2.height);
        }
        if (textLayer) textLayer.style.pointerEvents = (mode === 'text') ? '' : 'none';
        if (textLayer2) textLayer2.style.pointerEvents = (mode === 'text') ? '' : 'none';
    }
}

// --- IMAGE MODE (OCR + translate) ---
let drawStart = null;
function setupDrawCanvas() {
    const setupFor = (dcId, pdfId, pageOffset) => {
        const dc = document.getElementById(dcId);
        const pdfCanvas = document.getElementById(pdfId);
        if (!dc) return;

        const clearCanvas = () => {
            const ctx = dc.getContext('2d', { willReadFrequently: true });
            ctx.clearRect(0, 0, dc.width, dc.height);
        };
        clearCanvas();

        dc.onmousedown = e => {
            const rect = dc.getBoundingClientRect();
            drawStart = { x: e.clientX - rect.left, y: e.clientY - rect.top };
        };

        dc.onmousemove = e => {
            if (!drawStart) return;
            const rect = dc.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;
            const ctx = dc.getContext('2d', { willReadFrequently: true });
            
            ctx.clearRect(0, 0, dc.width, dc.height);
            ctx.globalCompositeOperation = 'source-over';
            ctx.fillStyle = 'rgba(0,0,0,0.4)';
            ctx.fillRect(0, 0, dc.width, dc.height);

            const w = x - drawStart.x, h = y - drawStart.y;
            
            ctx.globalCompositeOperation = 'destination-out';
            ctx.fillStyle = '#000';
            ctx.fillRect(drawStart.x, drawStart.y, w, h);
            
            ctx.globalCompositeOperation = 'source-over';
            ctx.strokeStyle = '#3b82f6';
            ctx.lineWidth = 2;
            ctx.setLineDash([5, 5]);
            ctx.strokeRect(drawStart.x, drawStart.y, w, h);
        };

        dc.onmouseup = e => {
            if (!drawStart) return;
            const rect = dc.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;
            
            const sx = Math.min(drawStart.x, x);
            const sy = Math.min(drawStart.y, y);
            const sw = Math.abs(x - drawStart.x);
            const sh = Math.abs(y - drawStart.y);
            drawStart = null;

            if (sw < 10 || sh < 10) {
                clearCanvas();
                return;
            }
            clearCanvas();

            const targetPage = pageNum + pageOffset;
            const overlayId = 'capture-overlay-' + Date.now();
            const overlay = document.createElement('div');
            overlay.id = overlayId;
            overlay.className = 'capture-overlay-temp';
            overlay.dataset.page = targetPage;
            overlay.style.cssText = `position:absolute; left:${sx}px; top:${sy}px; width:${sw}px; height:${sh}px; background:rgba(156, 163, 175, 0.4); border:2px solid #9ca3af; z-index:40; pointer-events:none; border-radius:4px; display:flex; align-items:center; justify-content:center;`;
            overlay.innerHTML = `
                <div style="display:flex; flex-direction:column; align-items:center; gap:8px; color:#fff; font-weight:bold; font-size: 14px; text-shadow:0 1px 4px rgba(0,0,0,0.5);">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="animation:spin 1s linear infinite;"><path d="M12 2v4m0 12v4M4.93 4.93l2.83 2.83m8.48 8.48l2.83 2.83M2 12h4m12 0h4M4.93 19.07l2.83-2.83m8.48-8.48l2.83-2.83"></path></svg>
                    <span>Processando...</span>
                </div>
            `;
            dc.parentElement.appendChild(overlay);

            if (!document.getElementById('spin-anim')) {
                const style = document.createElement('style');
                style.id = 'spin-anim';
                style.innerHTML = `@keyframes spin { 100% { transform: rotate(360deg); } }`;
                document.head.appendChild(style);
            }

            const tmp = document.createElement('canvas');
            tmp.width = sw;
            tmp.height = sh;
            tmp.getContext('2d', { willReadFrequently: true }).drawImage(pdfCanvas, sx, sy, sw, sh, 0, 0, sw, sh);
            const base64 = tmp.toDataURL('image/png').split(',')[1];
            const readerSelect = document.getElementById('reader-model-select');
            const transModel = readerSelect ? readerSelect.value : 'translategemma:4b';
            const ocrSelect = document.getElementById('reader-ocr-select');
            const ocrModel = ocrSelect ? ocrSelect.value : 'qwen2.5vl:7b';

            const statusToast = showStatus('Extraindo texto da imagem (1/2)...', true);
            const midX = rect.left + sx + sw / 2;
            const midY = rect.top + sy + sh + window.scrollY;


            fetch('/api/ocr_chunk_image', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ image_base64: base64, ocr_model: ocrModel })
            }).then(r => r.json()).then(data => {
                if (!data.success) {
                    statusToast.hide();
                    showTooltip(midX, midY, `<div style="color:#ef4444;">Erro OCR: ${data.error}</div>`, null);
                    return;
                }
                
                statusToast.update('Traduzindo texto extraído (2/2)...', false);
                const snippetText = data.extracted_text;
                
                fetch('/api/translate_chunk_markdown', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ text: snippetText, translate_model: transModel, context_translate: '4096' })
                }).then(r => r.json()).then(transData => {
                    if (transData.success) {
                        statusToast.update('Tradução concluída!', true);
                        const boxData = {
                            type: 'image_box',
                            text: snippetText,
                            relX: sx / pdfCanvas.width,
                            relY: sy / pdfCanvas.height,
                            relW: sw / pdfCanvas.width,
                            relH: sh / pdfCanvas.height
                        };
                        fetch('/api/library/save_translation', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ doc_id: currentDocId, page_index: targetPage, original_text: JSON.stringify(boxData), translated_text: transData.translation })
                        }).then(r => r.json()).then(saveData => {
                            if (targetPage === pageNum) {
                                translationsCache.push({ id: saveData.id, original_text: JSON.stringify(boxData), translated_text: transData.translation });
                                applyHighlightsForLayer(document.getElementById('pdf-text-layer'), translationsCache);
                            } else if (targetPage === pageNum + 1) {
                                translationsCache2.push({ id: saveData.id, original_text: JSON.stringify(boxData), translated_text: transData.translation });
                                applyHighlightsForLayer(document.getElementById('pdf-text-layer-2'), translationsCache2);
                            }
                            const htmlContent = formatTooltipHtml('Tradução feita com o Modo Captura', transData.translation);
                            showTooltip(midX, midY, htmlContent, saveData.id);
                        });
                    } else {
                        statusToast.hide();
                        showTooltip(midX, midY, `<div style="color:#ef4444;">Erro: ${transData.error}</div>`, null);
                    }
                }).catch(e => {
                    statusToast.hide();
                    showTooltip(midX, midY, `<div style="color:#ef4444;">Erro de rede: ${e}</div>`, null);
                }).finally(() => {
                    const sp = document.getElementById(overlayId); if(sp) sp.remove();
                    clearCanvas();
                    dc.style.pointerEvents = '';
                });
            }).catch(e => {
                statusToast.hide();
                showTooltip(midX, midY, `<div style="color:#ef4444;">Erro de rede (OCR): ${e}</div>`, null);
                const sp = document.getElementById(overlayId); if(sp) sp.remove();
                clearCanvas();
                dc.style.pointerEvents = '';
            });
        };
    };

    setupFor('draw-canvas', 'pdf-canvas', 0);
    setupFor('draw-canvas-2', 'pdf-canvas-2', 1);
}

// --- TEXT MODE SELECTION ---
let currentSelectionRect = null;
let currentSelectionText = '';
let currentSelectionPage = null;

document.addEventListener('mouseup', function (e) {
    if (!document.body.classList.contains('fullscreen-reader')) return;
    if (currentMode !== 'text') return;

    const selection = window.getSelection();
    if (selection && selection.toString().trim().length > 3) {
        e.preventDefault();
    }

    const textLayer = document.getElementById('pdf-text-layer');
    const textLayer2 = document.getElementById('pdf-text-layer-2');
    if ((!textLayer || !textLayer.contains(e.target)) && (!textLayer2 || !textLayer2.contains(e.target))) {
        setTimeout(() => {
            const sel = window.getSelection();
            if (!sel || sel.isCollapsed) hideFloatingTranslateBtn();
        }, 100);
        return;
    }

    if (selection.rangeCount > 0 && !selection.isCollapsed) {
        currentSelectionText = selection.toString().trim();
        if (currentSelectionText.length > 3) {
            const range = selection.getRangeAt(0);
            const rect = range.getBoundingClientRect();
            currentSelectionRect = rect;
            
            if (textLayer2 && textLayer2.contains(selection.anchorNode)) {
                currentSelectionPage = pageNum + 1;
            } else {
                currentSelectionPage = pageNum;
            }
            
            showFloatingTranslateBtn(rect.left + rect.width / 2, rect.bottom + window.scrollY);
        }
    } else {
        hideFloatingTranslateBtn();
    }
});

function getSelectedModelName() {
    const sel = document.getElementById('reader-model-select');
    if (!sel || !sel.value) return 'Traduzir';
    const txt = sel.options[sel.selectedIndex]?.text || sel.value;
    return 'Traduzir com ' + txt.replace(/ \(.*\)$/, '');
}

function showFloatingTranslateBtn(x, y) {
    let btn = document.getElementById('floating-translate-btn');
    if (!btn) {
        btn = document.createElement('button');
        btn.id = 'floating-translate-btn';
        btn.style.cssText = 'position:fixed; z-index:800; background:#1e293b; color:#fff; border:none; padding:7px 14px; border-radius:20px; font-size:0.82rem; cursor:pointer; display:flex; align-items:center; gap:6px; box-shadow:0 4px 12px rgba(0,0,0,0.25); transition:background 0.15s; font-family:inherit;';
        btn.onmouseenter = () => btn.style.background = '#334155';
        btn.onmouseleave = () => btn.style.background = '#1e293b';
        document.body.appendChild(btn);
        btn.onclick = doTranslateText;
    }
    btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 5h12M9 3v2m1.048 9.5A18.022 18.022 0 0 1 6.412 9m6.088 9h7M11 21l5-10 5 10M12.751 17.5h6.498"></path></svg> ${getSelectedModelName()}`;
    btn.style.left = Math.max(10, x - 80) + 'px';
    btn.style.top = (y + 10) + 'px';
    btn.style.display = 'flex';
}

function hideFloatingTranslateBtn() {
    const btn = document.getElementById('floating-translate-btn');
    if (btn) btn.style.display = 'none';
}

function doTranslateText() {
    hideFloatingTranslateBtn();
    if (!currentSelectionText) return;

    const textToTranslate = currentSelectionText;
    const rect = currentSelectionRect;
    const targetPage = currentSelectionPage || pageNum;
    window.getSelection().removeAllRanges();

    const statusToast = showStatus('Traduzindo o texto...', true);

    const readerSelect = document.getElementById('reader-model-select');
    const model = readerSelect ? readerSelect.value : 'translategemma:4b';

    const midX = rect.left + rect.width / 2;
    const midY = rect.bottom + window.scrollY;

    fetch('/api/translate_chunk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: textToTranslate, model, context_translate: '4096' })
    }).then(r => r.json()).then(data => {
        if (data.success) {
            statusToast.update('Tradução concluída!', true);
            fetch('/api/library/save_translation', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    doc_id: currentDocId,
                    page_index: targetPage,
                    original_text: textToTranslate,
                    translated_text: data.translation
                })
            }).then(r => r.json()).then(saveData => {
                const newTrans = {
                    id: saveData.id,
                    original_text: textToTranslate,
                    translated_text: data.translation
                };
                if (targetPage === pageNum) {
                    translationsCache.push(newTrans);
                    applyHighlightsForLayer(document.getElementById('pdf-text-layer'), translationsCache);
                } else if (targetPage === pageNum + 1) {
                    translationsCache2.push(newTrans);
                    applyHighlightsForLayer(document.getElementById('pdf-text-layer-2'), translationsCache2);
                }
                const htmlContent = formatTooltipHtml('Texto Traduzido', data.translation);
                showTooltip(midX, midY, htmlContent, saveData.id);
            });
        } else {
            statusToast.hide();
            showTooltip(midX, midY, '<span style="color:#ef4444;">Erro ao traduzir.</span>', null);
        }
    }).catch(err => {
        statusToast.hide();
        console.error(err);
    });
}

// --- HIGHLIGHTS ---
function applyHighlights() {
    applyHighlightsForLayer(document.getElementById('pdf-text-layer'), translationsCache);
    if (dualPage) applyHighlightsForLayer(document.getElementById('pdf-text-layer-2'), translationsCache2);
}

function applyHighlightsForLayer(textLayer, transCache) {
    if (!textLayer) return;
    
    // Remove old image boxes
    const oldBoxes = textLayer.parentElement.querySelectorAll('.image-translation-box');
    oldBoxes.forEach(b => b.remove());

    const spans = Array.from(textLayer.getElementsByTagName('span'));

    // Reset old highlights
    spans.forEach(s => {
        if (s.dataset.highlighted) {
            s.style.backgroundColor = '';
            s.style.cursor = '';
            s.onclick = null;
            delete s.dataset.highlighted;
        }
    });

    // Create a precise map of character index to span element
    let fullText = '';
    let spanMap = []; // maps character index to span index
    spans.forEach((span, idx) => {
        const text = span.textContent;
        for (let i = 0; i < text.length; i++) {
            if (text[i].trim() !== '') {
                fullText += text[i].toLowerCase();
                spanMap.push(idx);
            }
        }
    });

    transCache.forEach(t => {
        if (t.original_text && t.original_text.startsWith('{"type":"image_box"')) {
            try {
                const data = JSON.parse(t.original_text);
                const box = document.createElement('div');
                box.className = 'image-translation-box';
                const layerParent = textLayer.parentElement;
                const vpWidth = layerParent.offsetWidth;
                const vpHeight = layerParent.offsetHeight;
                
                const bx = data.relX * vpWidth;
                const by = data.relY * vpHeight;
                const bw = data.relW * vpWidth;
                const bh = data.relH * vpHeight;
                
                box.style.cssText = `position:absolute; left:${bx}px; top:${by}px; width:${bw}px; height:${bh}px; border:2px dashed rgba(234,179,8,0.6); background:rgba(234,179,8,0.1); cursor:pointer; z-index:5; pointer-events:auto; border-radius:4px;`;
                const tr = t.translated_text;
                box.onclick = e => {
                    e.stopPropagation();
                    const r = box.getBoundingClientRect();
                    const htmlContent = formatTooltipHtml('Tradução feita com o Modo Captura', tr);
                    showTooltip(r.left + r.width / 2, r.bottom + window.scrollY, htmlContent, t.id);
                };
                layerParent.appendChild(box);
            } catch(e) { console.error(e) }
            return;
        }

        const orig = t.original_text.replace(/\s+/g, '').toLowerCase();
        if (orig.length < 5) return; // Too short to safely match globally

        // Find all occurrences in the full text string
        let startIndex = 0;
        while ((startIndex = fullText.indexOf(orig, startIndex)) !== -1) {
            const endIndex = startIndex + orig.length - 1;
            const startSpanIdx = spanMap[startIndex];
            const endSpanIdx = spanMap[endIndex];
            
            const matchSpans = [];
            for (let i = startSpanIdx; i <= endSpanIdx; i++) {
                if (spans[i].textContent.trim().length > 0) {
                    matchSpans.push(spans[i]);
                }
            }

            if (matchSpans.length > 0) {
                const tr = t.translated_text;
                matchSpans.forEach(s => {
                    s.style.backgroundColor = 'rgba(251,191,36,0.35)'; // light yellow
                    s.style.cursor = 'pointer';
                    s.style.borderRadius = '2px';
                    s.dataset.highlighted = 'true';
                    s.onclick = e => {
                        e.stopPropagation();
                        const r = s.getBoundingClientRect();
                        const htmlContent = formatTooltipHtml('Texto Traduzido', tr);
                        showTooltip(r.left + r.width / 2, r.bottom + window.scrollY, htmlContent, t.id);
                    };
                });
            }
            startIndex += orig.length;
        }
    });
}

// --- TOOLTIP (draggable + scrollable) ---
let highestTooltipZIndex = 700;

function formatTooltipHtml(title, markdownText) {
    let safeText = (markdownText || "").trim();
    safeText = safeText.replace(/^( {4,})/gm, '');
    let processedText = safeText
        .replace(/^[ \t]*[•◦▪▫►✓][ \t]*/gm, '- ')
        .replace(/\\section\{([^}]+)\}/g, '# $1')
        .replace(/\\subsection\{([^}]+)\}/g, '## $1')
        .replace(/\\subsubsection\{([^}]+)\}/g, '### $1')
        .replace(/\\textbf\{([^}]+)\}/g, '**$1**')
        .replace(/\\textit\{([^}]+)\}/g, '*$1*')
        .replace(/<\/?(?:div|span|p|html|body|main|section|article|aside|footer|header|nav|style|script)[^>]*>/gi, '');
        
    return `<div style="margin-bottom:6px;font-size:0.75rem;color:#94a3b8;">${title}:</div><div class="markdown-body" style="font-size:0.85rem; padding-top: 6px;">${renderMarkdownWithMath(processedText)}</div>`;
}

function showTooltip(x, y, html, id) {
    const tId = 'tooltip-' + (id || Date.now());
    let tooltip = document.getElementById(tId);
    
    if (!tooltip) {
        highestTooltipZIndex++;
        tooltip = document.createElement('div');
        tooltip.id = tId;
        tooltip.className = 'translation-tooltip';
        tooltip.style.cssText = `display:none; flex-direction:column; position:fixed; background:#fff; border:1px solid #e2e8f0; box-shadow:0 8px 30px rgba(0,0,0,0.14); border-radius:10px; width:800px; max-width:95vw; min-width:320px; z-index:${highestTooltipZIndex}; font-size:0.92rem; color:#334155; line-height:1.55; resize:both; overflow:hidden; max-height:80vh; min-height:100px; padding-bottom: 6px;`;
        tooltip.innerHTML = `
            <div class="tooltip-header" style="display:flex; justify-content:space-between; align-items:center; padding:10px 14px 8px; border-bottom:1px solid #f1f5f9; cursor:grab; user-select:none; background:#fafafa; border-radius:10px 10px 0 0; flex-shrink: 0;">
                <strong style="color:#10b981; font-size:0.75rem; text-transform:uppercase; letter-spacing:0.5px;">Tradução</strong>
                <div style="display:flex; gap:8px; align-items:center;">
                    ${id ? `
                    <button onclick="window.deleteTranslation(${id})" style="background:none;border:none;cursor:pointer;color:#ef4444;padding:2px;line-height:1;display:flex;align-items:center;justify-content:center;" onmouseenter="this.style.color='#b91c1c'" onmouseleave="this.style.color='#ef4444'" title="Excluir Tradução">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                            <polyline points="3 6 5 6 21 6"></polyline>
                            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                            <line x1="10" y1="11" x2="10" y2="17"></line>
                            <line x1="14" y1="11" x2="14" y2="17"></line>
                        </svg>
                    </button>
                    ` : ''}
                    <button onclick="this.closest('.translation-tooltip').remove()" style="background:none;border:none;cursor:pointer;color:#94a3b8;padding:2px;line-height:1;display:flex;align-items:center;justify-content:center;" onmouseenter="this.style.color='#334155'" onmouseleave="this.style.color='#94a3b8'">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                    </button>
                </div>
            </div>
            <div class="tooltip-content" style="padding:12px 14px; flex-grow:1; overflow-y:auto; overflow-x:auto; word-break:break-word;"></div>
        `;
        document.body.appendChild(tooltip);
        
        // Bring to front on click
        tooltip.addEventListener('mousedown', () => {
            highestTooltipZIndex++;
            tooltip.style.zIndex = highestTooltipZIndex;
        });
        
        makeDraggable(tooltip, tooltip.querySelector('.tooltip-header'));
    } else {
        highestTooltipZIndex++;
        tooltip.style.zIndex = highestTooltipZIndex;
    }
    
    tooltip.querySelector('.tooltip-content').innerHTML = html;
    if (window.renderMathInElement) {
        try {
            renderMathInElement(tooltip.querySelector('.tooltip-content'), {
                delimiters: [
                    {left: '$$', right: '$$', display: true},
                    {left: '$', right: '$', display: false},
                    {left: '\\(', right: '\\)', display: false},
                    {left: '\\[', right: '\\]', display: true},
                    {left: '\\begin{equation}', right: '\\end{equation}', display: true},
                    {left: '\\begin{equation*}', right: '\\end{equation*}', display: true},
                    {left: '\\begin{align}', right: '\\end{align}', display: true},
                    {left: '\\begin{align*}', right: '\\end{align*}', display: true}
                ]
            });
        } catch(e) { console.error(e) }
    }
    tooltip.style.display = 'flex';

    // Position within viewport adaptively based on its new dimensions
    const rect = tooltip.getBoundingClientRect();
    const px = Math.max(10, Math.min(x - rect.width / 2, window.innerWidth - rect.width - 10));
    const py = Math.max(10, Math.min(y + 12, window.innerHeight - rect.height - 10));
    tooltip.style.left = px + 'px';
    tooltip.style.top = py + 'px';
}

function makeDraggable(el, handle) {
    let ox = 0, oy = 0, sx = 0, sy = 0;
    handle.onmousedown = e => {
        e.preventDefault();
        sx = e.clientX; sy = e.clientY;
        ox = el.offsetLeft; oy = el.offsetTop;
        document.onmousemove = me => {
            el.style.left = (ox + me.clientX - sx) + 'px';
            el.style.top = (oy + me.clientY - sy) + 'px';
        };
        document.onmouseup = () => {
            document.onmousemove = null;
            document.onmouseup = null;
            handle.style.cursor = 'grab';
        };
        handle.style.cursor = 'grabbing';
    };
}

// --- ANNOTATIONS (COMMENTS) ---

function updateAnnotationText(id, newText, newX = null, newY = null) {
    const ann = annotationsCache.find(a => a.id === id) || annotationsCache2.find(a => a.id === id);
    if (ann) {
        let changed = false;
        if (newText !== null && ann.content !== newText.trim()) {
            ann.content = newText.trim();
            changed = true;
        }
        if (newX !== null && newY !== null && (ann.x !== newX || ann.y !== newY)) {
            ann.x = newX;
            ann.y = newY;
            changed = true;
        }
        if (changed) {
            fetch('/api/annotations/update', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id, content: ann.content, x: ann.x, y: ann.y })
            });
        }
    }
}

function renderAnnotations(layer, viewport) {
    renderAnnotationsForLayer(layer, viewport, annotationsCache, pageNum);
}

function renderAnnotationsForLayer(layer, viewport, annCache, pageIdx) {
    if (!layer) return;
    layer.innerHTML = '';
    annCache.forEach(ann => {
        const pin = document.createElement('div');
        // Use relative coordinates stored as fractions
        const vp = viewport || { width: parseInt(layer.parentElement.querySelector('canvas').width), height: parseInt(layer.parentElement.querySelector('canvas').height) };
        const px = ann.x * vp.width;
        const py = ann.y * vp.height;

        pin.style.cssText = `position:absolute; left:${px}px; top:${py}px; transform:translate(0%, -100%); cursor:pointer; z-index:10; pointer-events:auto;`;
        pin.innerHTML = `<div style="background:#fbbf24; border-radius:50% 50% 50% 0; width:22px; height:22px; display:flex; align-items:center; justify-content:center; box-shadow:0 2px 6px rgba(0,0,0,0.2); border:2px solid #f59e0b;">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="white" stroke="none"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>
        </div>`;
        pin.title = ann.content || '(sem texto)';
        
        let isDragging = false;
        let hasMoved = false;
        let startX, startY, initX, initY;
        
        pin.onmousedown = e => {
            isDragging = true;
            hasMoved = false;
            startX = e.clientX;
            startY = e.clientY;
            initX = ann.x * vp.width;
            initY = ann.y * vp.height;
            document.body.style.userSelect = 'none';
            e.stopPropagation();
        };
        
        const moveHandler = e => {
            if (!isDragging) return;
            const dx = e.clientX - startX;
            const dy = e.clientY - startY;
            if (Math.abs(dx) > 3 || Math.abs(dy) > 3) hasMoved = true;
            pin.style.left = (initX + dx) + 'px';
            pin.style.top = (initY + dy) + 'px';
        };
        
        const upHandler = e => {
            if (!isDragging) return;
            isDragging = false;
            document.body.style.userSelect = '';
            if (hasMoved) {
                const dx = e.clientX - startX;
                const dy = e.clientY - startY;
                const newX = (initX + dx) / vp.width;
                const newY = (initY + dy) / vp.height;
                updateAnnotationText(ann.id, null, newX, newY);
            } else {
                showAnnotationPopup(ann, initX, initY, layer.parentElement);
            }
        };
        
        window.addEventListener('mousemove', moveHandler);
        window.addEventListener('mouseup', upHandler);
        
        // Remove listeners when pin is removed to avoid leaks
        pin.addEventListener('DOMNodeRemoved', () => {
            window.removeEventListener('mousemove', moveHandler);
            window.removeEventListener('mouseup', upHandler);
        });

        layer.appendChild(pin);
    });
}

function showAnnotationPopup(ann, px, py, container) {
    let popup = document.getElementById('ann-popup');
    if (!popup) {
        popup = document.createElement('div');
        popup.id = 'ann-popup';
        popup.style.cssText = 'position:absolute; background:#fff; border:1px solid #e2e8f0; border-radius:8px; padding:12px; width:220px; z-index:900; box-shadow:0 6px 20px rgba(0,0,0,0.12); font-size:0.85rem; color:#334155;';
        document.body.appendChild(popup); // Append to body so it doesn't get clipped
    }
    
    // Position globally relative to container
    const rect = container.getBoundingClientRect();
    popup.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
            <strong style="font-size:0.75rem; color:#f59e0b; text-transform:uppercase;">Comentário</strong>
            <div style="display:flex; align-items:center; gap:4px;">
                <button onclick="deleteAnnotation(${ann.id}); document.getElementById('ann-popup').style.display='none'" style="background:none;border:none;cursor:pointer;color:#ef4444;padding:4px;display:flex;" title="Excluir">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                </button>
                <button onclick="document.getElementById('ann-popup').style.display='none'" style="background:none;border:none;cursor:pointer;color:#94a3b8;padding:4px;display:flex;" title="Fechar">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                </button>
            </div>
        </div>
        <div id="ann-content-${ann.id}" contenteditable="true" style="min-height:20px; padding:4px 0; border:none; outline:none; font-size:0.9rem;" onblur="updateAnnotationText(${ann.id}, this.innerText)">${ann.content || ''}</div>
    `;
    popup.style.display = 'block';
    popup.style.left = (rect.left + px) + 'px';
    popup.style.top = (rect.top + py + 5 + window.scrollY) + 'px';
    
    setTimeout(() => {
        const div = document.getElementById(`ann-content-${ann.id}`);
        if (div) {
            div.focus();
            const selection = window.getSelection();
            const range = document.createRange();
            range.selectNodeContents(div);
            range.collapse(false);
            selection.removeAllRanges();
            selection.addRange(range);
        }
    }, 50);
}

window.deleteAnnotation = function (id) {
    fetch('/api/annotations/delete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) })
        .then(() => {
            annotationsCache = annotationsCache.filter(a => a.id !== id);
            annotationsCache2 = annotationsCache2.filter(a => a.id !== id);
            document.getElementById('ann-popup').style.display = 'none';
            renderAnnotations(document.getElementById('annotations-layer'), null);
            renderAnnotations(document.getElementById('annotations-layer-2'), null);
        });
};

window.deleteTranslation = function(id) {
    fetch('/api/library/delete_translation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id })
    })
    .then(r => r.json())
    .then(data => {
        if (data.success) {
            translationsCache = translationsCache.filter(t => t.id !== id);
            translationsCache2 = translationsCache2.filter(t => t.id !== id);
            const tooltip = document.getElementById('tooltip-' + id);
            if (tooltip) tooltip.remove();
            applyHighlightsForLayer(document.getElementById('pdf-text-layer'), translationsCache);
            if (dualPage) {
                applyHighlightsForLayer(document.getElementById('pdf-text-layer-2'), translationsCache2);
            }
        } else {
            alert('Erro ao excluir tradução: ' + (data.error || 'Desconhecido'));
        }
    })
    .catch(err => {
        console.error(err);
        alert('Erro ao excluir tradução.');
    });
};

// Click on pdf-container for comment mode
document.addEventListener('click', e => {
    if (!document.body.classList.contains('fullscreen-reader')) return;
    if (!commentMode) return;
    const container = document.getElementById('pdf-container');
    const container2 = document.getElementById('pdf-container-2');
    
    let activeContainer = null;
    let targetPage = pageNum;
    if (container && container.contains(e.target)) activeContainer = container;
    else if (container2 && container2.contains(e.target)) {
        activeContainer = container2;
        targetPage = pageNum + 1;
    }
    
    if (!activeContainer) return;
    // Ignore clicks on existing pins
    if (e.target.closest('#annotations-layer div') || e.target.closest('#annotations-layer-2 div')) return;

    // Handle comment mode clicks on active container
    const rect = activeContainer.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const relX = x / activeContainer.offsetWidth;
    const relY = y / activeContainer.offsetHeight;
    
    // Immediately create a new annotation and show inline editor
    fetch('/api/annotations/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            doc_id: currentDocId,
            page_index: targetPage,
            x: relX,
            y: relY,
            content: ''
        })
    }).then(r => r.json()).then(data => {
        if (data.success) {
            const ann = {
                id: data.id,
                doc_id: currentDocId,
                page_index: targetPage,
                x: relX,
                y: relY,
                content: ''
            };
            if (targetPage === pageNum) {
                annotationsCache.push(ann);
                renderAnnotationsForLayer(document.getElementById('annotations-layer'), null, annotationsCache, pageNum);
            } else {
                annotationsCache2.push(ann);
                renderAnnotationsForLayer(document.getElementById('annotations-layer-2'), null, annotationsCache2, pageNum + 1);
            }
            showAnnotationPopup(ann, x, y, activeContainer);
        }
    });
});

let commentPreview = null;
document.addEventListener('mousemove', e => {
    if (!commentMode || !document.body.classList.contains('fullscreen-reader')) {
        if (commentPreview) commentPreview.style.display = 'none';
        return;
    }
    const container = document.getElementById('pdf-container');
    const container2 = document.getElementById('pdf-container-2');
    if ((container && container.contains(e.target)) || (container2 && container2.contains(e.target))) {
        if (!commentPreview) {
            commentPreview = document.createElement('div');
            commentPreview.style.cssText = 'position:fixed; pointer-events:none; z-index:9999; display:flex;';
            commentPreview.innerHTML = `<div style="background:#fbbf24; opacity:0.8; border-radius:50% 50% 50% 0; width:22px; height:22px; display:flex; align-items:center; justify-content:center; border:2px solid #f59e0b; box-shadow:0 2px 6px rgba(0,0,0,0.2);"><svg width="11" height="11" viewBox="0 0 24 24" fill="white" stroke="none"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg></div>`;
            document.body.appendChild(commentPreview);
        }
        commentPreview.style.display = 'flex';
        // Offset slightly to align the bottom-left of the pin to the cursor point
        commentPreview.style.left = e.clientX + 'px';
        commentPreview.style.top = (e.clientY - 22) + 'px';
    } else {
        if (commentPreview) commentPreview.style.display = 'none';
    }
});

if (typeof marked !== 'undefined') {
    marked.use({ breaks: false });
}

// --- KEYBOARD SHORTCUTS ---

document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
        const annPopup = document.getElementById('ann-popup');
        if (annPopup && annPopup.style.display !== 'none') {
            annPopup.style.display = 'none';
        }
        const helpModal = document.getElementById('help-modal');
        if (helpModal && helpModal.style.display !== 'none') {
            helpModal.style.display = 'none';
        }
    }
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) return;
    if (!document.body.classList.contains('fullscreen-reader')) return;
    
    if (e.key === '1') setMode('text');
    if (e.key === '2') setMode('image');
    if (e.key === '3') setMode('comment');
    if (e.key.toLowerCase() === 'q') prevPage();
    if (e.key.toLowerCase() === 'e') nextPage();
});

function updateCaptureOverlaysVisibility() {
    document.querySelectorAll('.capture-overlay-temp').forEach(o => {
        const p = parseInt(o.dataset.page);
        const isDual = document.body.classList.contains('dual-page-reader');
        if (p === pageNum || (isDual && p === pageNum + 1)) {
            o.style.display = 'flex';
        } else {
            o.style.display = 'none';
        }
    });
}

// --- MODEL SELECT IN READER ---
function populateReaderModelSelect() {
    const selTrans = document.getElementById('reader-model-select');
    const mainSelTrans = document.getElementById('translation-model-select');
    
    if (selTrans && mainSelTrans && mainSelTrans.options.length > 0) {
        selTrans.innerHTML = '';
        Array.from(mainSelTrans.options).forEach(o => selTrans.appendChild(o.cloneNode(true)));
        if (mainSelTrans.value) selTrans.value = mainSelTrans.value;
        
        selTrans.onchange = () => {
            const btn = document.getElementById('floating-translate-btn');
            if (btn && btn.style.display !== 'none') {
                btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 5h12M9 3v2m1.048 9.5A18.022 18.022 0 0 1 6.412 9m6.088 9h7M11 21l5-10 5 10M12.751 17.5h6.498"></path></svg> ${getSelectedModelName()}`;
            }
        };
    }
    
    const selOcr = document.getElementById('reader-ocr-select');
    const mainSelOcr = document.getElementById('ocr-model-select');
    if (selOcr && mainSelOcr && mainSelOcr.options.length > 0) {
        selOcr.innerHTML = '';
        Array.from(mainSelOcr.options).forEach(o => selOcr.appendChild(o.cloneNode(true)));
        if (mainSelOcr.value) selOcr.value = mainSelOcr.value;
    }
}

// --- INIT ---
document.addEventListener('DOMContentLoaded', () => {
    loadLibrary();
});
