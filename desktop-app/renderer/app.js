/**
 * ProTools Desktop - 渲染进程逻辑
 * 侧边栏布局 + 文件上传 + 历史记录
 */
(function () {
    'use strict';

    const sp = window.superplugin;
    const $ = (id) => document.getElementById(id);

    // ===== DOM 元素 =====
    const els = {
        // 侧边栏
        navItems: document.querySelectorAll('.nav-item'),
        views: document.querySelectorAll('.view'),
        pandocDotSidebar: $('pandocDotSidebar'),
        pandocStatusSidebar: $('pandocStatusSidebar'),
        appVersion: $('appVersion'),

        // 转换页面
        uploadZone: $('uploadZone'),
        uploadInner: $('uploadInner'),
        fileInput: $('fileInput'),
        docTitle: $('docTitle'),
        markdownInput: $('markdownInput'),
        charCount: $('charCount'),
        fileNameDisplay: $('fileNameDisplay'),
        optionsToggle: $('optionsToggle'),
        optionsContent: $('optionsContent'),
        optRemoveHr: $('optRemoveHr'),
        optHardBreaks: $('optHardBreaks'),
        optDisableNumbering: $('optDisableNumbering'),
        optToc: $('optToc'),
        convertNote: $('convertNote'),
        btnConvert: $('btnConvert'),
        btnClear: $('btnClear'),
        resultBanner: $('resultBanner'),

        // 文档导入页面
        importZone: $('importZone'),
        importFileInput: $('importFileInput'),
        importQueue: $('importQueue'),
        btnImport: $('btnImport'),
        btnImportClear: $('btnImportClear'),
        importBanner: $('importBanner'),
        importResult: $('importResult'),
        importOutput: $('importOutput'),
        importChars: $('importChars'),
        importStats: $('importStats'),
        importSource: $('importSource'),
        btnSendToWord: $('btnSendToWord'),
        btnCopyMd: $('btnCopyMd'),
        btnSaveMd: $('btnSaveMd'),

        // 历史页面
        historyList: $('historyList'),
        historyCount: $('historyCount'),
        btnClearHistory: $('btnClearHistory'),

        // 状态页面
        pandocBadge: $('pandocBadge'),
        pandocDot: $('pandocDot'),
        pandocStatusText: $('pandocStatusText'),
        pandocVersion: $('pandocVersion'),
        pandocPath: $('pandocPath'),
        btnCheckPandoc: $('btnCheckPandoc'),
        btnInstallPandoc: $('btnInstallPandoc'),

        // MarkItDown 引擎状态
        mdEngineBadge: $('mdEngineBadge'),
        mdEngineDot: $('mdEngineDot'),
        mdEngineStatus: $('mdEngineStatus'),
        mdEngineVersion: $('mdEngineVersion'),
        mdEngineFormats: $('mdEngineFormats'),
        mdEnginePath: $('mdEnginePath'),
        btnCheckMdEngine: $('btnCheckMdEngine'),

        // 设置页面
        autoLaunchToggle: $('autoLaunchToggle'),
        minimizeToggle: $('minimizeToggle'),
        aboutVersion: $('aboutVersion'),
        btnRefreshDeps: $('btnRefreshDeps'),
        depRuntime: $('depRuntime'),
        depPandoc: $('depPandoc'),
        depSystem: $('depSystem'),
        depNpm: $('depNpm'),

        // 字体设置
        fontEnabledToggle: $('fontEnabledToggle'),
        fontSettingsBody: $('fontSettingsBody'),
        fontFamilySelect: $('fontFamilySelect'),
        fontFamilyEnSelect: $('fontFamilyEnSelect'),
        bodySizeInput: $('bodySizeInput'),
        h1SizeInput: $('h1SizeInput'),
        h2SizeInput: $('h2SizeInput'),
        h3SizeInput: $('h3SizeInput'),
        h4SizeInput: $('h4SizeInput'),
        h5SizeInput: $('h5SizeInput'),
        h6SizeInput: $('h6SizeInput'),
        btnSaveFontSettings: $('btnSaveFontSettings'),
        btnResetFontSettings: $('btnResetFontSettings'),

        footerText: $('footerText'),
    };

    let lastSavedPath = null;
    let currentFileName = null;
    let pandocReady = false;
    let cachedFontSettings = null;

    // 文档导入状态：队列里每一项对应一个待转换文件
    let importItems = [];
    let activeImportIndex = -1;
    let importBusy = false;
    let importBannerTimer = null;

    // ===== 侧边栏导航 =====
    function switchView(viewName) {
        els.navItems.forEach(btn => {
            btn.classList.toggle('active', btn.dataset.view === viewName);
        });
        els.views.forEach(view => {
            view.classList.toggle('active', view.id === 'view-' + viewName);
        });

        if (viewName === 'history') {
            loadHistory();
        }
        if (viewName === 'settings') {
            loadDependencies();
        }
        if (viewName === 'status') {
            checkMarkitdown();
        }
        if (viewName === 'import') {
            // 提前拉起转换组件，避免用户点击转换时再等 1~2 秒
            Promise.resolve(sp.markitdown.warm()).catch(() => {});
        }
    }

    // ===== 文件上传 =====
    async function openFilePicker() {
        const result = await sp.file.openMarkdown();
        if (result.success) {
            loadFileContent(result.content, result.fileName);
        }
    }

    function loadFileContent(content, fileName) {
        currentFileName = fileName;
        els.markdownInput.value = content;
        els.fileNameDisplay.textContent = '已加载: ' + fileName;
        els.fileNameDisplay.style.display = 'inline';
        updateCharCount();
        setFooter('已加载文件: ' + fileName);
    }

    // 拖拽上传
    function setupDragDrop() {
        els.uploadZone.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.stopPropagation();
            els.uploadZone.classList.add('dragover');
        });

        els.uploadZone.addEventListener('dragleave', (e) => {
            e.preventDefault();
            e.stopPropagation();
            els.uploadZone.classList.remove('dragover');
        });

        els.uploadZone.addEventListener('drop', async (e) => {
            e.preventDefault();
            e.stopPropagation();
            els.uploadZone.classList.remove('dragover');

            const files = e.dataTransfer.files;
            if (files.length === 0) return;

            const file = files[0];
            const ext = file.name.split('.').pop().toLowerCase();
            if (!['md', 'markdown', 'txt'].includes(ext)) {
                setFooter('不支持的文件类型，请上传 .md 或 .txt 文件');
                return;
            }

            const text = await file.text();
            loadFileContent(text, file.name);
        });
    }

    // ===== 转换功能 =====
    async function convertToWord() {
        const content = els.markdownInput.value.trim();
        if (!content) {
            setFooter('请输入或上传 Markdown 内容');
            els.markdownInput.focus();
            return;
        }

        // 检查 Pandoc
        if (!pandocReady) {
            const status = await sp.pandoc.check();
            if (!status.found) {
                setFooter('未找到 Pandoc，请先安装');
                switchView('status');
                return;
            }
            pandocReady = true;
        }

        const options = {
            content: content,
            title: els.docTitle.value.trim() || 'AI对话导出',
            sourceFileName: currentFileName,
            note: els.convertNote.value.trim(),
            table_style: document.querySelector('input[name="tableStyle"]:checked')?.value || 'three-line',
            remove_hr: els.optRemoveHr.checked,
            hard_line_breaks: els.optHardBreaks.checked,
            disable_auto_numbering: els.optDisableNumbering.checked,
            toc: els.optToc.checked,
            font_settings: getFontSettingsForConversion(),
        };

        // 加载状态
        els.btnConvert.classList.add('loading');
        els.btnConvert.disabled = true;
        els.btnConvert.querySelector('span').textContent = '转换中...';
        setFooter('正在转换...');

        try {
            const result = await sp.convert.save(options);

            if (result.success) {
                lastSavedPath = result.filePath;
                showResultBanner(true, result);
                setFooter('转换成功');
                els.convertNote.value = '';
                currentFileName = null;
            } else if (result.canceled) {
                setFooter('已取消保存');
            } else {
                showResultBanner(false, null, result.error);
                setFooter('转换失败: ' + (result.error || '未知错误'));
            }
        } catch (err) {
            showResultBanner(false, null, err.message);
            setFooter('转换失败: ' + err.message);
        } finally {
            els.btnConvert.classList.remove('loading');
            els.btnConvert.disabled = false;
            els.btnConvert.querySelector('span').textContent = '转换为 Word';
        }
    }

    function showResultBanner(success, result, error) {
        const banner = els.resultBanner;
        banner.style.display = 'flex';
        banner.className = 'result-banner ' + (success ? 'success' : 'error');

        if (success) {
            banner.innerHTML = `
                <div class="result-banner-icon">
                    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#22c55e" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
                </div>
                <div class="result-banner-body">
                    <h3>转换成功！</h3>
                    <p>${result.filePath}</p>
                    <p style="margin-top:4px">耗时 ${(result.timeMs / 1000).toFixed(1)}s · ${result.sizeKB} KB</p>
                </div>
                <div class="result-banner-actions">
                    <button class="btn btn-outline btn-sm" onclick="window._superplugin.openFolder()">打开文件夹</button>
                    <button class="btn btn-outline btn-sm" onclick="document.getElementById('resultBanner').style.display='none'">关闭</button>
                </div>
            `;
        } else {
            banner.innerHTML = `
                <div class="result-banner-icon">
                    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>
                </div>
                <div class="result-banner-body">
                    <h3>转换失败</h3>
                    <p>${error || '未知错误'}</p>
                </div>
                <div class="result-banner-actions">
                    <button class="btn btn-outline btn-sm" onclick="document.getElementById('resultBanner').style.display='none'">关闭</button>
                </div>
            `;
        }
    }

    window._superplugin = {
        openFolder: () => {
            if (lastSavedPath) sp.shell.showItemInFolder(lastSavedPath);
        }
    };

    function clearInput() {
        els.markdownInput.value = '';
        currentFileName = null;
        els.fileNameDisplay.style.display = 'none';
        els.resultBanner.style.display = 'none';
        updateCharCount();
        els.markdownInput.focus();
        setFooter('已清空');
    }

    function updateCharCount() {
        const len = els.markdownInput.value.length;
        els.charCount.textContent = len.toLocaleString() + ' 字符';
    }

    // ===== 选项折叠 =====
    function toggleOptions() {
        const expanded = els.optionsToggle.classList.toggle('expanded');
        els.optionsContent.classList.toggle('show', expanded);
    }

    // ===== Pandoc 状态 =====
    async function checkPandoc() {
        els.pandocBadge.textContent = '检查中...';
        els.pandocBadge.className = 'badge checking';
        els.pandocDot.className = 'status-dot';
        els.pandocStatusText.textContent = '检查中...';
        els.pandocDotSidebar.className = 'status-dot';
        els.pandocStatusSidebar.textContent = '检查中';

        try {
            const result = await sp.pandoc.check();
            updatePandocUI(result);
        } catch (err) {
            els.pandocBadge.textContent = '错误';
            els.pandocBadge.className = 'badge stopped';
            els.pandocStatusText.textContent = '检测失败';
            els.pandocStatusSidebar.textContent = '错误';
            els.pandocDot.className = 'status-dot stopped';
            els.pandocDotSidebar.className = 'status-dot stopped';
        }
    }

    function updatePandocUI(result) {
        if (result.found) {
            pandocReady = true;
            els.pandocBadge.textContent = '已安装';
            els.pandocBadge.className = 'badge running';
            els.pandocDot.className = 'status-dot running';
            els.pandocDotSidebar.className = 'status-dot running';
            els.pandocStatusText.textContent = '已安装';
            els.pandocStatusSidebar.textContent = '就绪';
            els.pandocVersion.textContent = result.version || '-';
            els.pandocPath.textContent = result.path || '-';
        } else {
            pandocReady = false;
            els.pandocBadge.textContent = '未安装';
            els.pandocBadge.className = 'badge warning';
            els.pandocDot.className = 'status-dot warning';
            els.pandocDotSidebar.className = 'status-dot warning';
            els.pandocStatusText.textContent = '未安装';
            els.pandocStatusSidebar.textContent = '未安装';
            els.pandocVersion.textContent = '-';
            els.pandocPath.textContent = '-';
        }
    }

    // ===== MarkItDown 状态 =====
    async function checkMarkitdown() {
        els.mdEngineBadge.textContent = '检查中...';
        els.mdEngineBadge.className = 'badge checking';
        els.mdEngineDot.className = 'status-dot';
        els.mdEngineStatus.textContent = '检查中...';

        try {
            const info = await sp.markitdown.status();
            if (info.available) {
                els.mdEngineBadge.textContent = '已就绪';
                els.mdEngineBadge.className = 'badge running';
                els.mdEngineDot.className = 'status-dot running';
                els.mdEngineStatus.textContent = info.ready ? '运行中' : '待调用';
                els.mdEngineVersion.textContent = info.version || '0.1.8';
                els.mdEngineFormats.textContent = info.formats.length
                    ? `${info.formats.length} 种（${info.formats.slice(0, 6).join(' ')} …）`
                    : 'PDF DOCX PPTX XLSX HTML CSV EPUB …';
                els.mdEnginePath.textContent = info.executable || '-';
            } else {
                els.mdEngineBadge.textContent = '不可用';
                els.mdEngineBadge.className = 'badge warning';
                els.mdEngineDot.className = 'status-dot warning';
                els.mdEngineStatus.textContent = '未找到运行组件';
                els.mdEngineVersion.textContent = '-';
                els.mdEngineFormats.textContent = '-';
                els.mdEnginePath.textContent = info.error || '-';
            }
        } catch (err) {
            els.mdEngineBadge.textContent = '错误';
            els.mdEngineBadge.className = 'badge stopped';
            els.mdEngineDot.className = 'status-dot stopped';
            els.mdEngineStatus.textContent = '检测失败';
        }
    }

    // ===== 历史记录 =====
    async function loadHistory() {
        try {
            const records = await sp.history.load();
            renderHistory(records);
        } catch (err) {
            setFooter('加载历史记录失败');
        }
    }

    function renderHistory(records) {
        els.historyCount.textContent = `共 ${records.length} 条记录`;

        if (records.length === 0) {
            els.historyList.innerHTML = `
                <div class="empty-state">
                    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.3"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                    <p>暂无转换记录</p>
                </div>
            `;
            return;
        }

        const html = records.map(r => {
            const date = new Date(r.timestamp);
            const dateStr = formatTime(date);
            const outputName = escapeHtml(r.outputFileName || r.title || '未命名文档');
            const sourceName = r.sourceFileName ? escapeHtml(r.sourceFileName) : null;
            const noteText = r.note ? escapeHtml(r.note) : '';

            // 注释区域：有注释显示注释+编辑按钮，无注释显示添加按钮
            let noteSection;
            if (noteText) {
                noteSection = `
                    <div class="history-item-note">
                        <span class="history-item-note-text">${noteText}</span>
                        <button class="note-btn" title="编辑注释" onclick="window._superplugin.editNote('${r.id}')">编辑</button>
                    </div>
                `;
            } else {
                noteSection = `
                    <div class="history-item-note empty">
                        <span class="history-item-note-text">暂无注释</span>
                        <button class="note-btn" title="添加注释" onclick="window._superplugin.editNote('${r.id}')">添加注释</button>
                    </div>
                `;
            }

            return `
                <div class="history-item" data-id="${r.id}">
                    <div class="history-item-icon">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                    </div>
                    <div class="history-item-body">
                        <div class="history-item-title">${outputName}</div>
                        <div class="history-item-meta">
                            <span><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>${dateStr}</span>
                            ${sourceName ? `<span><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/></svg>源: ${sourceName}</span>` : ''}
                        </div>
                        ${noteSection}
                    </div>
                    <div class="history-item-actions">
                        <button class="icon-btn danger" title="删除记录" onclick="window._superplugin.deleteHistory('${r.id}')">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                        </button>
                    </div>
                </div>
            `;
        }).join('');

        els.historyList.innerHTML = html;
    }

    // 编辑历史记录注释
    window._superplugin.editNote = (id) => {
        const item = document.querySelector(`.history-item[data-id="${id}"]`);
        if (!item) return;

        const noteSection = item.querySelector('.history-item-note');
        if (!noteSection) return;

        const currentTextEl = noteSection.querySelector('.history-item-note-text');
        const currentText = currentTextEl ? currentTextEl.textContent.trim() : '';
        const isPlaceholder = currentText === '暂无注释';
        const actualText = isPlaceholder ? '' : currentText;

        noteSection.className = 'history-item-note';
        noteSection.innerHTML = `
            <div style="flex:1;">
                <input type="text" class="history-item-note-edit" value="${escapeAttr(actualText)}" placeholder="输入注释内容...">
                <div class="history-item-note-actions">
                    <button class="note-btn primary" onclick="window._superplugin.saveNote('${id}')">保存</button>
                    <button class="note-btn" onclick="window._superplugin.cancelEdit()">取消</button>
                </div>
            </div>
        `;

        const input = noteSection.querySelector('.history-item-note-edit');
        if (input) {
            input.focus();
            input.select();
            input.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    window._superplugin.saveNote(id);
                } else if (e.key === 'Escape') {
                    e.preventDefault();
                    window._superplugin.cancelEdit();
                }
            });
        }
    };

    // 保存历史记录注释
    window._superplugin.saveNote = async (id) => {
        const item = document.querySelector(`.history-item[data-id="${id}"]`);
        if (!item) return;

        const input = item.querySelector('.history-item-note-edit');
        const note = input ? input.value.trim() : '';

        const result = await sp.history.updateNote(id, note);
        if (result.success) {
            await loadHistory();
            setFooter(note ? '注释已保存' : '注释已清空');
        } else {
            setFooter('保存注释失败');
        }
    };

    // 取消编辑注释
    window._superplugin.cancelEdit = () => {
        loadHistory();
    };

    // 删除历史记录
    window._superplugin.deleteHistory = async (id) => {
        await sp.history.delete(id);
        await loadHistory();
        setFooter('已删除记录');
    };

    async function clearAllHistory() {
        if (!confirm('确定要清空所有历史记录吗？此操作不可撤销。')) return;
        await sp.history.clear();
        await loadHistory();
        setFooter('已清空所有历史记录');
    }

    // ===== 工具函数 =====
    function setFooter(text) {
        els.footerText.textContent = text;
    }

    function formatTime(date) {
        const now = new Date();
        const diff = now - date;
        const minutes = Math.floor(diff / 60000);
        const hours = Math.floor(diff / 3600000);
        const days = Math.floor(diff / 86400000);

        if (minutes < 1) return '刚刚';
        if (minutes < 60) return minutes + ' 分钟前';
        if (hours < 24) return hours + ' 小时前';
        if (days < 7) return days + ' 天前';

        const y = date.getFullYear();
        const m = String(date.getMonth() + 1).padStart(2, '0');
        const d = String(date.getDate()).padStart(2, '0');
        const h = String(date.getHours()).padStart(2, '0');
        const min = String(date.getMinutes()).padStart(2, '0');
        return `${y}-${m}-${d} ${h}:${min}`;
    }

    function escapeHtml(str) {
        if (!str) return '';
        return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    function escapeAttr(str) {
        if (!str) return '';
        return str.replace(/'/g, "\\'").replace(/"/g, '&quot;');
    }

    // ===== 设置 =====
    async function loadSettings() {
        try {
            const autoLaunch = await sp.app.getAutoLaunch();
            els.autoLaunchToggle.checked = autoLaunch;
        } catch (err) {}

        const minimize = localStorage.getItem('minimizeToTray');
        if (minimize !== null) {
            els.minimizeToggle.checked = minimize === 'true';
        }
    }

    async function setAutoLaunch(enabled) {
        try {
            await sp.app.setAutoLaunch(enabled);
            setFooter(enabled ? '已开启开机自启' : '已关闭开机自启');
        } catch (err) {
            setFooter('设置失败: ' + err.message);
        }
    }

    async function loadAppInfo() {
        try {
            const info = await sp.app.getInfo();
            els.appVersion.textContent = 'v' + info.version;
            els.aboutVersion.textContent = info.version;
        } catch (err) {}
    }

    // ===== 依赖信息 =====
    async function loadDependencies() {
        // 显示加载状态
        els.depRuntime.innerHTML = '<div class="dep-loading">加载中...</div>';
        els.depPandoc.innerHTML = '<div class="dep-loading">加载中...</div>';
        els.depSystem.innerHTML = '<div class="dep-loading">加载中...</div>';
        els.depNpm.innerHTML = '<div class="dep-loading">加载中...</div>';

        try {
            const data = await sp.app.getDependencies();

            // 运行环境
            const r = data.runtime;
            els.depRuntime.innerHTML = `
                <div class="dep-row dep-row-head"><span class="dep-name">组件</span><span class="dep-version">版本</span><span class="dep-status">状态</span></div>
                <div class="dep-row"><span class="dep-name">Electron</span><span class="dep-version">${r.version}</span><span class="dep-status"><span class="dep-badge ok">运行中</span></span></div>
                <div class="dep-row"><span class="dep-name">Node.js</span><span class="dep-version">${r.node}</span><span class="dep-status"><span class="dep-badge ok">运行中</span></span></div>
                <div class="dep-row"><span class="dep-name">Chromium</span><span class="dep-version">${r.chromium}</span><span class="dep-status"><span class="dep-badge ok">运行中</span></span></div>
                <div class="dep-row"><span class="dep-name">架构</span><span class="dep-version">${r.arch}</span><span class="dep-status"></span></div>
                <div class="dep-row"><span class="dep-name">平台</span><span class="dep-version">${r.platform}</span><span class="dep-status"></span></div>
            `;

            // Pandoc
            const p = data.pandoc;
            const pStatus = p.version === '未安装' || p.version === '检测失败' ? 'miss' : 'ok';
            const pLabel = pStatus === 'ok' ? '已安装' : '缺失';
            els.depPandoc.innerHTML = `
                <div class="dep-row dep-row-head"><span class="dep-name">项目</span><span class="dep-version">值</span><span class="dep-status">状态</span></div>
                <div class="dep-row"><span class="dep-name">版本</span><span class="dep-version">${p.version}</span><span class="dep-status"><span class="dep-badge ${pStatus}">${pLabel}</span></span></div>
                <div class="dep-row"><span class="dep-name">路径</span><span class="dep-version" style="width:auto;flex:1;text-align:left;word-break:break-all;font-size:11px;">${escapeHtml(p.path)}</span><span class="dep-status"></span></div>
            `;

            // 系统信息
            const s = data.system;
            els.depSystem.innerHTML = `
                <div class="dep-row dep-row-head"><span class="dep-name">项目</span><span class="dep-version">值</span><span class="dep-status"></span></div>
                <div class="dep-row"><span class="dep-name">操作系统版本</span><span class="dep-version" style="width:auto;flex:1;text-align:left;">${s.os}</span><span class="dep-status"></span></div>
                <div class="dep-row"><span class="dep-name">总内存</span><span class="dep-version" style="width:auto;flex:1;text-align:left;">${s.totalMemory}</span><span class="dep-status"></span></div>
            `;

            // NPM 包
            if (data.npm.length === 0) {
                els.depNpm.innerHTML = '<div class="dep-loading">无依赖包</div>';
            } else {
                const rows = data.npm.map(item => {
                    const isInstalled = item.installed !== '-';
                    const isDev = item.type === 'devDependency';
                    let badge;
                    if (!isInstalled) {
                        badge = '<span class="dep-badge miss">未安装</span>';
                    } else if (isDev) {
                        badge = '<span class="dep-badge dev">dev</span>';
                    } else {
                        badge = '<span class="dep-badge ok">已安装</span>';
                    }
                    return `
                        <div class="dep-row">
                            <span class="dep-name">${escapeHtml(item.name)}</span>
                            <span class="dep-version">${item.required} → ${item.installed}</span>
                            <span class="dep-status">${badge}</span>
                        </div>
                    `;
                }).join('');

                els.depNpm.innerHTML = `
                    <div class="dep-row dep-row-head"><span class="dep-name">包名</span><span class="dep-version">要求 → 已安装</span><span class="dep-status">状态</span></div>
                    ${rows}
                `;
            }

            setFooter('依赖信息已加载');
        } catch (err) {
            const errHtml = '<div class="dep-loading">加载失败: ' + escapeHtml(err.message) + '</div>';
            els.depRuntime.innerHTML = errHtml;
            els.depPandoc.innerHTML = errHtml;
            els.depSystem.innerHTML = errHtml;
            els.depNpm.innerHTML = errHtml;
            setFooter('加载依赖信息失败');
        }
    }

    // ===== 字体设置 =====
    async function loadFontSettings() {
        try {
            const settings = await sp.font.getSettings();
            cachedFontSettings = settings;
            applyFontSettingsToUI(settings);
        } catch (err) {
            setFooter('加载字体设置失败');
        }
    }

    function applyFontSettingsToUI(settings) {
        els.fontEnabledToggle.checked = settings.enabled;
        els.fontSettingsBody.classList.toggle('disabled', !settings.enabled);
        els.fontFamilySelect.value = settings.fontFamily || '宋体';
        els.fontFamilyEnSelect.value = settings.fontFamilyEn || 'Times New Roman';
        els.bodySizeInput.value = settings.bodySize || 12;
        els.h1SizeInput.value = settings.h1Size || 22;
        els.h2SizeInput.value = settings.h2Size || 16;
        els.h3SizeInput.value = settings.h3Size || 14;
        els.h4SizeInput.value = settings.h4Size || 13;
        els.h5SizeInput.value = settings.h5Size || 12;
        els.h6SizeInput.value = settings.h6Size || 12;
    }

    function collectFontSettings() {
        return {
            enabled: els.fontEnabledToggle.checked,
            fontFamily: els.fontFamilySelect.value,
            fontFamilyEn: els.fontFamilyEnSelect.value,
            bodySize: parseInt(els.bodySizeInput.value) || 12,
            h1Size: parseInt(els.h1SizeInput.value) || 22,
            h2Size: parseInt(els.h2SizeInput.value) || 16,
            h3Size: parseInt(els.h3SizeInput.value) || 14,
            h4Size: parseInt(els.h4SizeInput.value) || 13,
            h5Size: parseInt(els.h5SizeInput.value) || 12,
            h6Size: parseInt(els.h6SizeInput.value) || 12,
        };
    }

    async function saveFontSettings() {
        const settings = collectFontSettings();
        const result = await sp.font.saveSettings(settings);
        if (result.success) {
            cachedFontSettings = settings;
            setFooter('字体设置已保存');
        } else {
            setFooter('保存失败: ' + (result.error || '未知错误'));
        }
    }

    async function resetFontSettings() {
        if (!confirm('确定恢复默认字体设置吗？')) return;
        const result = await sp.font.resetSettings();
        if (result.success) {
            cachedFontSettings = result.settings;
            applyFontSettingsToUI(result.settings);
            setFooter('已恢复默认字体设置');
        } else {
            setFooter('重置失败: ' + (result.error || '未知错误'));
        }
    }

    function getFontSettingsForConversion() {
        return cachedFontSettings;
    }

    // ===== 文档导入（MarkItDown） =====
    const IMPORT_SUPPORTED_EXTENSIONS = [
        'pdf', 'docx', 'pptx', 'xlsx', 'xls', 'html', 'htm', 'epub', 'ipynb', 'csv',
        'txt', 'md', 'markdown', 'json', 'xml', 'zip', 'msg', 'mp3', 'wav', 'm4a',
        'jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'tiff'
    ];

    function formatSizeKB(sizeKB) {
        if (!sizeKB) return '0 KB';
        return sizeKB >= 1024 ? (sizeKB / 1024).toFixed(1) + ' MB' : sizeKB + ' KB';
    }

    function importStatusText(item) {
        if (item.status === 'running') return '转换中…';
        if (item.status === 'done') return item.chars.toLocaleString() + ' 字符';
        if (item.status === 'error') return '失败';
        return formatSizeKB(item.sizeKB);
    }

    function renderImportQueue() {
        if (importItems.length === 0) {
            els.importQueue.style.display = 'none';
            els.importQueue.innerHTML = '';
            return;
        }
        els.importQueue.style.display = 'flex';
        els.importQueue.innerHTML = importItems.map((item, index) => {
            const classes = ['import-item', item.status, index === activeImportIndex ? 'active' : ''].join(' ');
            return `
                <div class="${classes}" data-index="${index}">
                    <span class="import-item-dot"></span>
                    <span class="import-item-name" title="${escapeAttr(item.path)}">${escapeHtml(item.name)}</span>
                    <span class="import-item-meta">${escapeHtml(importStatusText(item))}</span>
                    <button class="import-item-remove" data-remove="${index}" title="移除">×</button>
                </div>
            `;
        }).join('');
    }

    function addImportFiles(files) {
        const known = new Set(importItems.map((item) => item.path));
        let added = 0;
        for (const file of files) {
            if (!file || !file.path || known.has(file.path)) continue;
            importItems.push({
                path: file.path,
                name: file.name,
                sizeKB: file.sizeKB || 0,
                status: 'pending',
                markdown: '',
                chars: 0,
                images: 0,
                elapsedMs: 0,
                title: '',
                assetsDir: null,
                error: null
            });
            known.add(file.path);
            added += 1;
        }
        if (added > 0) {
            if (activeImportIndex < 0) activeImportIndex = 0;
            els.importBanner.style.display = 'none';
            els.importResult.style.display = 'none';
            renderImportQueue();
            setFooter(`已加入 ${added} 个文件，共 ${importItems.length} 个待转换`);
        }
    }

    async function pickImportFiles() {
        if (importBusy) return;
        const result = await sp.markitdown.pickFiles();
        if (!result.success || !result.files) return;
        addImportFiles(result.files);
    }

    async function convertImports() {
        if (importBusy) return;
        if (importItems.length === 0) {
            setFooter('请先选择要转换的文档');
            return;
        }

        const engine = await sp.markitdown.status();
        if (!engine.available) {
            showImportBanner(false, '未找到 MarkItDown 运行组件，请重新安装应用');
            return;
        }

        importBusy = true;
        els.btnImport.classList.add('loading');
        els.btnImport.disabled = true;
        els.btnImport.querySelector('span').textContent = '转换中...';
        els.importBanner.style.display = 'none';

        const queue = importItems.filter((item) => item.status !== 'done');
        let completed = 0;
        let lastError = null;

        for (const item of queue) {
            item.status = 'running';
            item.error = null;
            renderImportQueue();
            setFooter(`正在转换 ${item.name}...`);

            const result = await sp.markitdown.convert(item.path);
            if (result.success) {
                item.status = 'done';
                item.markdown = result.markdown;
                item.chars = result.chars;
                item.images = result.images;
                item.elapsedMs = result.elapsedMs;
                item.title = result.title;
                item.assetsDir = result.assetsDir;
                completed += 1;
            } else {
                item.status = 'error';
                item.error = result.error || '转换失败';
                lastError = `${item.name}：${item.error}`;
            }
            renderImportQueue();
        }

        importBusy = false;
        els.btnImport.classList.remove('loading');
        els.btnImport.disabled = false;
        els.btnImport.querySelector('span').textContent = '转换为 Markdown';

        const firstDone = importItems.findIndex((item) => item.status === 'done');
        if (firstDone >= 0) {
            activeImportIndex = firstDone;
            renderImportQueue();
            previewImport(firstDone);
            const item = importItems[firstDone];
            const suffix = completed > 1 ? `已转换 ${completed} 个文件，` : '';
            showImportBanner(true, `${suffix}用时 ${(item.elapsedMs / 1000).toFixed(2)} 秒`);
            setFooter('转换完成');
        } else {
            showImportBanner(false, lastError || '转换失败');
            setFooter('转换失败');
        }
    }

    function previewImport(index) {
        const item = importItems[index];
        if (!item || item.status !== 'done') {
            els.importResult.style.display = 'none';
            return;
        }
        els.importResult.style.display = 'block';
        els.importOutput.value = item.markdown;
        els.importOutput.scrollTop = 0;
        els.importChars.textContent = item.chars.toLocaleString() + ' 字符';
        const meta = [`${(item.elapsedMs / 1000).toFixed(2)} 秒`];
        if (item.images) meta.push(`图片 ${item.images} 张`);
        if (item.sizeKB) meta.push(`源文件 ${formatSizeKB(item.sizeKB)}`);
        els.importStats.textContent = meta.join(' · ');
        els.importSource.textContent = ' · ' + item.name;
    }

    function showImportBanner(success, message) {
        const banner = els.importBanner;
        banner.style.display = 'flex';
        banner.className = 'result-banner ' + (success ? 'success' : 'error');
        const icon = success
            ? '<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#22c55e" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>'
            : '<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>';
        banner.innerHTML = `
            <div class="result-banner-icon">${icon}</div>
            <div class="result-banner-body">
                <h3>${success ? '转换成功' : '转换失败'}</h3>
                <p>${escapeHtml(message || '')}</p>
            </div>
            <div class="result-banner-actions">
                <button class="btn btn-outline btn-sm" data-close-import-banner>关闭</button>
            </div>
        `;

        if (importBannerTimer) clearTimeout(importBannerTimer);
        if (success) {
            // 成功提示 6 秒后自动收起，避免长期占用首屏空间
            importBannerTimer = setTimeout(() => {
                els.importBanner.style.display = 'none';
            }, 6000);
        }
    }

    function sendActiveToWord() {
        const item = importItems[activeImportIndex];
        if (!item || item.status !== 'done') {
            setFooter('请先完成一次转换');
            return;
        }
        els.markdownInput.value = item.markdown;
        currentFileName = item.name;
        els.docTitle.value = item.title || item.name.replace(/\.[^.]+$/, '');
        els.fileNameDisplay.textContent = '来自: ' + item.name;
        els.fileNameDisplay.style.display = 'inline';
        updateCharCount();
        switchView('convert');
        els.markdownInput.scrollTop = 0;
        setFooter('已填入转换页，确认无误后点击「转换为 Word」');
    }

    async function copyActiveMarkdown() {
        const item = importItems[activeImportIndex];
        if (!item || !item.markdown) {
            setFooter('没有可复制的内容');
            return;
        }
        try {
            await navigator.clipboard.writeText(item.markdown);
            setFooter('Markdown 已复制到剪贴板');
        } catch (error) {
            setFooter('复制失败：' + error.message);
        }
    }

    async function saveActiveMarkdown() {
        const item = importItems[activeImportIndex];
        if (!item || !item.markdown) {
            setFooter('没有可保存的内容');
            return;
        }
        const result = await sp.markitdown.save({
            markdown: item.markdown,
            title: item.title || item.name,
            assetsDir: item.assetsDir
        });
        if (result.success) {
            const extra = result.assetsCopied ? `（含 ${result.assetsCopied} 张图片，已存入同名 .assets 目录）` : '';
            showImportBanner(true, `${result.filePath}${extra}`);
            setFooter('已保存 Markdown 文件');
        } else if (!result.canceled) {
            showImportBanner(false, result.error || '保存失败');
            setFooter('保存失败');
        }
    }

    function clearImports() {
        if (importBusy) return;
        importItems = [];
        activeImportIndex = -1;
        els.importOutput.value = '';
        els.importResult.style.display = 'none';
        els.importBanner.style.display = 'none';
        renderImportQueue();
        setFooter('已清空导入队列');
    }

    function setupImportDragDrop() {
        const zone = els.importZone;
        zone.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.stopPropagation();
            zone.classList.add('dragover');
        });
        zone.addEventListener('dragleave', (e) => {
            e.preventDefault();
            e.stopPropagation();
            zone.classList.remove('dragover');
        });
        zone.addEventListener('drop', (e) => {
            e.preventDefault();
            e.stopPropagation();
            zone.classList.remove('dragover');

            const dropped = Array.from(e.dataTransfer.files || []);
            if (dropped.length === 0) return;

            const accepted = [];
            const rejected = [];
            for (const file of dropped) {
                const ext = (file.name.split('.').pop() || '').toLowerCase();
                if (!file.path) {
                    rejected.push(file.name);
                } else if (IMPORT_SUPPORTED_EXTENSIONS.includes(ext)) {
                    accepted.push({ path: file.path, name: file.name, sizeKB: Math.round(file.size / 1024) });
                } else {
                    rejected.push(file.name);
                }
            }
            if (rejected.length) setFooter(`已跳过不支持的文件：${rejected.join('、')}`);
            if (accepted.length) addImportFiles(accepted);
        });
    }

    // ===== 事件绑定 =====
    function bindEvents() {
        // 侧边栏导航
        els.navItems.forEach(btn => {
            btn.addEventListener('click', () => switchView(btn.dataset.view));
        });

        // 文件上传
        els.uploadZone.addEventListener('click', openFilePicker);
        els.fileInput.addEventListener('change', async (e) => {
            const file = e.target.files[0];
            if (!file) return;
            const text = await file.text();
            loadFileContent(text, file.name);
        });

        // 文档导入
        els.importZone.addEventListener('click', pickImportFiles);
        els.importFileInput.addEventListener('change', (e) => {
            const picked = Array.from(e.target.files || [])
                .filter((file) => file.path)
                .map((file) => ({ path: file.path, name: file.name, sizeKB: Math.round(file.size / 1024) }));
            if (picked.length) addImportFiles(picked);
            e.target.value = '';
        });
        setupImportDragDrop();
        els.btnImport.addEventListener('click', convertImports);
        els.btnImportClear.addEventListener('click', clearImports);
        els.btnSendToWord.addEventListener('click', sendActiveToWord);
        els.btnCopyMd.addEventListener('click', copyActiveMarkdown);
        els.btnSaveMd.addEventListener('click', saveActiveMarkdown);

        els.importQueue.addEventListener('click', (e) => {
            const removeBtn = e.target.closest('[data-remove]');
            if (removeBtn) {
                if (importBusy) return;
                importItems.splice(Number(removeBtn.dataset.remove), 1);
                if (activeImportIndex >= importItems.length) activeImportIndex = importItems.length - 1;
                renderImportQueue();
                if (activeImportIndex >= 0) previewImport(activeImportIndex);
                else els.importResult.style.display = 'none';
                return;
            }
            const row = e.target.closest('[data-index]');
            if (row) {
                activeImportIndex = Number(row.dataset.index);
                renderImportQueue();
                previewImport(activeImportIndex);
            }
        });

        els.importBanner.addEventListener('click', (e) => {
            if (e.target.closest('[data-close-import-banner]')) {
                els.importBanner.style.display = 'none';
            }
        });

        // 拖拽
        setupDragDrop();

        // 转换
        els.btnConvert.addEventListener('click', convertToWord);
        els.btnClear.addEventListener('click', clearInput);
        els.optionsToggle.addEventListener('click', toggleOptions);
        els.markdownInput.addEventListener('input', updateCharCount);

        // 快捷键 Ctrl+Enter
        els.markdownInput.addEventListener('keydown', (e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                e.preventDefault();
                convertToWord();
            }
        });

        // 历史
        els.btnClearHistory.addEventListener('click', clearAllHistory);

        // Pandoc
        els.btnCheckPandoc.addEventListener('click', checkPandoc);
        els.btnInstallPandoc.addEventListener('click', () => {
            sp.shell.openExternal('https://pandoc.org/installing.html');
        });
        els.btnCheckMdEngine.addEventListener('click', checkMarkitdown);

        // 设置
        els.autoLaunchToggle.addEventListener('change', (e) => setAutoLaunch(e.target.checked));
        els.minimizeToggle.addEventListener('change', (e) => {
            localStorage.setItem('minimizeToTray', e.target.checked);
        });
        els.btnRefreshDeps.addEventListener('click', loadDependencies);

        // 字体设置
        els.fontEnabledToggle.addEventListener('change', (e) => {
            els.fontSettingsBody.classList.toggle('disabled', !e.target.checked);
        });
        els.btnSaveFontSettings.addEventListener('click', saveFontSettings);
        els.btnResetFontSettings.addEventListener('click', resetFontSettings);
    }

    // ===== 初始化 =====
    async function init() {
        bindEvents();
        await loadSettings();
        await loadAppInfo();
        await loadFontSettings();
        await checkPandoc();
        await checkMarkitdown();
        setFooter('就绪');
    }

    document.addEventListener('DOMContentLoaded', init);
})();
