/**
 * ProTools Desktop - Electron 主进程
 * 独立桌面应用，提供 文档 → Markdown 与 Markdown → Word 双向转换
 */
const { app, BrowserWindow, Tray, Menu, ipcMain, shell, nativeImage, dialog } = require('electron');
const path = require('path');
const fs = require('fs');

const serverApp = require('./server-app');
const sidecar = require('./sidecar');

// 应用名称决定 userData 目录（%APPDATA%\ProTools），必须在读取任何用户路径之前设置
app.setName('ProTools');

let mainWindow = null;
let tray = null;
let isQuitting = false;

const ICON_PATH = app.isPackaged
    ? path.join(process.resourcesPath, 'icon.ico')
    : path.join(__dirname, 'assets', 'icon.ico');

// ===== 单实例锁 =====
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
    app.quit();
} else {
    app.on('second-instance', () => {
        if (mainWindow) {
            if (mainWindow.isMinimized()) mainWindow.restore();
            mainWindow.show();
            mainWindow.focus();
        }
    });
}

// ===== 历史记录存储 =====
const HISTORY_FILE = path.join(app.getPath('userData'), 'conversion-history.json');
const MAX_HISTORY = 100;

// ===== 字体设置存储 =====
const FONT_SETTINGS_FILE = path.join(app.getPath('userData'), 'font-settings.json');

// ===== MarkItDown 导入缓存 =====
// 转换产生的内嵌图片先落到临时目录，保存 .md 时再随文档一起搬运。
const IMPORT_CACHE_DIR = path.join(require('os').tmpdir(), 'protools-markitdown-cache');
const IMPORT_CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

// ===== 旧版本（MTD）用户数据迁移 =====
// 更名后 userData 从 mtd-desktop 变为 ProTools，首次启动时把历史与字体设置带过来。
const LEGACY_USER_DATA_DIR = path.join(app.getPath('appData'), 'mtd-desktop');
const LEGACY_USER_FILES = ['conversion-history.json', 'font-settings.json'];

function migrateLegacyUserData() {
    try {
        const currentDir = app.getPath('userData');
        if (path.resolve(currentDir) === path.resolve(LEGACY_USER_DATA_DIR)) return;
        if (!fs.existsSync(LEGACY_USER_DATA_DIR)) return;

        for (const name of LEGACY_USER_FILES) {
            const source = path.join(LEGACY_USER_DATA_DIR, name);
            const target = path.join(currentDir, name);
            if (fs.existsSync(source) && !fs.existsSync(target)) {
                fs.mkdirSync(currentDir, { recursive: true });
                fs.copyFileSync(source, target);
                console.log(`已迁移旧版用户数据：${name}`);
            }
        }
    } catch (error) {
        console.warn('旧版用户数据迁移跳过:', error.message);
    }
}

function prepareImportCache() {
    try {
        fs.mkdirSync(IMPORT_CACHE_DIR, { recursive: true });
        const now = Date.now();
        for (const entry of fs.readdirSync(IMPORT_CACHE_DIR)) {
            const target = path.join(IMPORT_CACHE_DIR, entry);
            try {
                if (now - fs.statSync(target).mtimeMs > IMPORT_CACHE_MAX_AGE_MS) {
                    fs.rmSync(target, { recursive: true, force: true });
                }
            } catch (e) {}
        }
    } catch (e) {
        console.warn('Import cache init failed:', e.message);
    }
}

function sanitizeFileName(name) {
    return String(name || '导入文档').replace(/[\\/:*?"<>|]/g, '_').trim() || '导入文档';
}

const DEFAULT_FONT_SETTINGS = {
    enabled: false,
    fontFamily: '宋体',
    fontFamilyEn: 'Times New Roman',
    bodySize: 12,
    h1Size: 22,
    h2Size: 16,
    h3Size: 14,
    h4Size: 13,
    h5Size: 12,
    h6Size: 12,
};

function loadHistory() {
    try {
        if (fs.existsSync(HISTORY_FILE)) {
            return JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'));
        }
    } catch (e) {}
    return [];
}

function saveHistory(records) {
    try {
        fs.writeFileSync(HISTORY_FILE, JSON.stringify(records.slice(0, MAX_HISTORY), null, 2), 'utf8');
    } catch (e) {}
}

function addHistoryRecord(record) {
    const records = loadHistory();
    records.unshift(record);
    saveHistory(records);
}

function deleteHistoryRecord(id) {
    const records = loadHistory();
    const filtered = records.filter(r => r.id !== id);
    saveHistory(filtered);
}

function clearHistory() {
    saveHistory([]);
}

// ===== 创建主窗口 =====
function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1100,
        height: 750,
        minWidth: 900,
        minHeight: 600,
        show: false,
        frame: true,
        resizable: true,
        icon: ICON_PATH,
        title: 'ProTools - 文档与 Word 互转',
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
        }
    });

    mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

    mainWindow.on('close', (event) => {
        if (!isQuitting) {
            event.preventDefault();
            mainWindow.hide();
        }
    });

    mainWindow.on('closed', () => {
        mainWindow = null;
    });
}

// ===== 系统托盘 =====
function createTray() {
    const iconImage = nativeImage.createFromPath(ICON_PATH);
    tray = new Tray(iconImage.isEmpty() ? nativeImage.createEmpty() : iconImage);

    const contextMenu = Menu.buildFromTemplate([
        {
            label: '显示主窗口',
            click: () => {
                if (mainWindow) { mainWindow.show(); mainWindow.focus(); }
            }
        },
        { type: 'separator' },
        {
            label: '退出',
            click: () => { isQuitting = true; app.quit(); }
        }
    ]);

    tray.setToolTip('ProTools - 文档与 Word 互转');
    tray.setContextMenu(contextMenu);

    tray.on('click', () => {
        if (mainWindow) {
            if (mainWindow.isVisible()) mainWindow.hide();
            else { mainWindow.show(); mainWindow.focus(); }
        }
    });

    tray.on('double-click', () => {
        if (mainWindow) { mainWindow.show(); mainWindow.focus(); }
    });
}

// ===== IPC 处理 =====
function setupIPC() {
    // 直接转换 + 保存对话框
    ipcMain.handle('convert:save', async (event, options) => {
        try {
            // 先执行转换到临时文件
            const result = await serverApp.convertToDocx(options);

            // 弹出保存对话框
            const defaultName = (options.title || 'AI对话导出').replace(/[\\/:*?"<>|]/g, '_') + '.docx';
            const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
                title: '保存 Word 文档',
                defaultPath: defaultName,
                filters: [
                    { name: 'Word 文档', extensions: ['docx'] }
                ]
            });

            if (canceled || !filePath) {
                // 用户取消，清理临时文件
                if (result.tmpDir) serverApp.cleanup(result.tmpDir);
                else if (fs.existsSync(result.outputFile)) {
                    try { fs.unlinkSync(result.outputFile); } catch(e) {}
                }
                return { success: false, canceled: true };
            }

            // 复制到用户选择的路径
            fs.copyFileSync(result.outputFile, filePath);

            // 清理临时文件
            if (result.tmpDir) serverApp.cleanup(result.tmpDir);
            else if (fs.existsSync(result.outputFile)) {
                try { fs.unlinkSync(result.outputFile); } catch(e) {}
            }

            return {
                success: true,
                filePath,
                timeMs: result.timeMs,
                sizeKB: Math.round(fs.statSync(filePath).size / 1024)
            };
        } catch (error) {
            return { success: false, error: error.message };
        }
    });

    // 转换并自动记录历史
    ipcMain.handle('convert:saveWithHistory', async (event, options) => {
        try {
            const result = await serverApp.convertToDocx(options);

            const defaultName = (options.title || 'AI对话导出').replace(/[\\/:*?"<>|]/g, '_') + '.docx';
            const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
                title: '保存 Word 文档',
                defaultPath: defaultName,
                filters: [{ name: 'Word 文档', extensions: ['docx'] }]
            });

            if (canceled || !filePath) {
                if (result.tmpDir) serverApp.cleanup(result.tmpDir);
                else if (fs.existsSync(result.outputFile)) {
                    try { fs.unlinkSync(result.outputFile); } catch(e) {}
                }
                return { success: false, canceled: true };
            }

            fs.copyFileSync(result.outputFile, filePath);

            if (result.tmpDir) serverApp.cleanup(result.tmpDir);
            else if (fs.existsSync(result.outputFile)) {
                try { fs.unlinkSync(result.outputFile); } catch(e) {}
            }

            const sizeKB = Math.round(fs.statSync(filePath).size / 1024);

            // 记录历史 - 只保存时间、文件名、输出文件名，不保存内容
            const historyRecord = {
                id: Date.now().toString(),
                timestamp: new Date().toISOString(),
                sourceFileName: options.sourceFileName || null,
                outputFileName: path.basename(filePath),
                note: options.note || '',
            };
            addHistoryRecord(historyRecord);

            return { success: true, filePath, timeMs: result.timeMs, sizeKB };
        } catch (error) {
            return { success: false, error: error.message };
        }
    });

    // 更新历史记录注释
    ipcMain.handle('history:updateNote', (event, id, note) => {
        const records = loadHistory();
        const record = records.find(r => r.id === id);
        if (record) {
            record.note = note || '';
            saveHistory(records);
            return { success: true };
        }
        return { success: false, error: '记录不存在' };
    });

    // 打开文件对话框 - 上传 Markdown 文件
    ipcMain.handle('file:openMarkdown', async () => {
        try {
            const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
                title: '选择 Markdown 文件',
                filters: [
                    { name: 'Markdown 文件', extensions: ['md', 'markdown', 'txt'] },
                    { name: '所有文件', extensions: ['*'] }
                ],
                properties: ['openFile']
            });

            if (canceled || !filePaths || filePaths.length === 0) {
                return { success: false, canceled: true };
            }

            const filePath = filePaths[0];
            const content = fs.readFileSync(filePath, 'utf8');
            const fileName = path.basename(filePath);

            return {
                success: true,
                filePath: filePath,
                fileName: fileName,
                content: content
            };
        } catch (error) {
            return { success: false, error: error.message };
        }
    });

    // 历史记录管理
    ipcMain.handle('history:load', () => {
        return loadHistory();
    });

    ipcMain.handle('history:delete', (event, id) => {
        deleteHistoryRecord(id);
        return { success: true };
    });

    ipcMain.handle('history:clear', () => {
        clearHistory();
        return { success: true };
    });

    // 检查文件是否仍然存在
    ipcMain.handle('file:exists', (event, filePath) => {
        try {
            return fs.existsSync(filePath);
        } catch (e) {
            return false;
        }
    });

    // 打开文件（用系统默认程序）
    ipcMain.handle('shell:openPath', (event, filePath) => {
        shell.openPath(filePath);
    });

    // 检查 Pandoc
    ipcMain.handle('pandoc:check', () => {
        return serverApp.checkPandoc();
    });

    // 打开外部链接
    ipcMain.handle('shell:openExternal', (event, url) => {
        shell.openExternal(url);
    });

    // 在文件夹中显示文件
    ipcMain.handle('shell:showItemInFolder', (event, p) => {
        shell.showItemInFolder(p);
    });

    // 设置开机自启
    ipcMain.handle('app:setAutoLaunch', (event, enabled) => {
        app.setLoginItemSettings({ openAtLogin: enabled });
        return { success: true };
    });

    ipcMain.handle('app:getAutoLaunch', () => {
        return app.getLoginItemSettings().openAtLogin;
    });

    // 获取应用信息
    ipcMain.handle('app:getInfo', () => {
        return {
            version: app.getVersion(),
            name: app.getName(),
            path: app.getAppPath(),
            isPackaged: app.isPackaged
        };
    });

    // 获取所有依赖信息
    ipcMain.handle('app:getDependencies', () => {
        const result = {
            runtime: { name: 'Electron', version: process.versions.electron, node: process.versions.node, chromium: process.versions.chromium, arch: process.arch, platform: process.platform },
            pandoc: null,
            npm: [],
            system: { os: require('os').release(), totalMemory: Math.round(require('os').totalmem() / 1024 / 1024 / 1024 * 10) / 10 + ' GB' },
        };

        // Pandoc 信息
        try {
            const pandocInfo = serverApp.checkPandoc();
            if (pandocInfo && pandocInfo.found) {
                result.pandoc = { version: pandocInfo.version || '未知', path: pandocInfo.path || '未知' };
            } else {
                result.pandoc = { version: '未安装', path: '-' };
            }
        } catch (e) {
            result.pandoc = { version: '检测失败', path: '-' };
        }

        // NPM 依赖
        try {
            const pkgPath = path.join(__dirname, 'package.json');
            const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
            const deps = pkg.dependencies || {};
            const devDeps = pkg.devDependencies || {};

            for (const [name, version] of Object.entries(deps)) {
                let installed = '-';
                try {
                    const depPkgPath = path.join(__dirname, 'node_modules', name, 'package.json');
                    if (fs.existsSync(depPkgPath)) {
                        const depPkg = JSON.parse(fs.readFileSync(depPkgPath, 'utf8'));
                        installed = depPkg.version;
                    }
                } catch (e) {}
                result.npm.push({ name, required: version, installed, type: 'dependency' });
            }

            for (const [name, version] of Object.entries(devDeps)) {
                let installed = '-';
                try {
                    const depPkgPath = path.join(__dirname, 'node_modules', name, 'package.json');
                    if (fs.existsSync(depPkgPath)) {
                        const depPkg = JSON.parse(fs.readFileSync(depPkgPath, 'utf8'));
                        installed = depPkg.version;
                    }
                } catch (e) {}
                result.npm.push({ name, required: version, installed, type: 'devDependency' });
            }
        } catch (e) {}

        return result;
    });

    // 读取字体设置
    ipcMain.handle('font:getSettings', () => {
        try {
            if (fs.existsSync(FONT_SETTINGS_FILE)) {
                const saved = JSON.parse(fs.readFileSync(FONT_SETTINGS_FILE, 'utf8'));
                return { ...DEFAULT_FONT_SETTINGS, ...saved };
            }
        } catch (e) {}
        return { ...DEFAULT_FONT_SETTINGS };
    });

    // 保存字体设置
    ipcMain.handle('font:saveSettings', (event, settings) => {
        try {
            fs.writeFileSync(FONT_SETTINGS_FILE, JSON.stringify(settings, null, 2), 'utf8');
            return { success: true };
        } catch (e) {
            return { success: false, error: e.message };
        }
    });

    // 重置字体设置
    ipcMain.handle('font:resetSettings', () => {
        try {
            fs.writeFileSync(FONT_SETTINGS_FILE, JSON.stringify(DEFAULT_FONT_SETTINGS, null, 2), 'utf8');
            return { success: true, settings: { ...DEFAULT_FONT_SETTINGS } };
        } catch (e) {
            return { success: false, error: e.message };
        }
    });

    // 最小化到托盘
    ipcMain.handle('window:minimizeToTray', () => {
        if (mainWindow) mainWindow.hide();
    });

    // ===== MarkItDown 文档导入 =====
    ipcMain.handle('markitdown:status', () => sidecar.status());

    ipcMain.handle('markitdown:warm', async () => {
        try {
            const info = await sidecar.start();
            return { success: true, version: info.version };
        } catch (error) {
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('markitdown:pickFiles', async () => {
        try {
            const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
                title: '选择要转换的文档',
                properties: ['openFile', 'multiSelections'],
                filters: [
                    {
                        name: '支持的文档',
                        extensions: [
                            'pdf', 'docx', 'pptx', 'xlsx', 'xls', 'html', 'htm', 'epub', 'ipynb',
                            'csv', 'txt', 'md', 'markdown', 'json', 'xml', 'zip', 'msg',
                            'mp3', 'wav', 'm4a', 'jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'tiff'
                        ]
                    },
                    { name: '所有文件', extensions: ['*'] }
                ]
            });
            if (canceled || !filePaths || filePaths.length === 0) {
                return { success: false, canceled: true };
            }
            return {
                success: true,
                files: filePaths.map((filePath) => {
                    let sizeKB = 0;
                    try { sizeKB = Math.round(fs.statSync(filePath).size / 1024); } catch (e) {}
                    return { path: filePath, name: path.basename(filePath), sizeKB };
                })
            };
        } catch (error) {
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('markitdown:convert', async (event, filePath) => {
        const started = Date.now();
        try {
            if (typeof filePath !== 'string' || !fs.existsSync(filePath)) {
                return { success: false, error: '文件不存在或路径无效' };
            }
            const stat = fs.statSync(filePath);
            if (stat.isDirectory()) {
                return { success: false, error: '暂不支持文件夹，请选择具体文件' };
            }
            if (stat.size === 0) {
                return { success: false, error: '文件内容为空' };
            }

            const cacheId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
            const assetsDir = path.join(IMPORT_CACHE_DIR, cacheId, 'assets');
            const result = await sidecar.convert(filePath, { assetsDir, assetRef: 'assets' });

            return {
                success: true,
                markdown: result.markdown,
                title: result.title || path.basename(filePath, path.extname(filePath)),
                chars: result.chars,
                images: result.images || 0,
                elapsedMs: result.elapsed_ms || (Date.now() - started),
                sourceName: path.basename(filePath),
                sourcePath: filePath,
                sizeKB: Math.round(stat.size / 1024),
                assetsDir: fs.existsSync(assetsDir) ? assetsDir : null
            };
        } catch (error) {
            return { success: false, error: error.message || '转换失败' };
        }
    });

    ipcMain.handle('markitdown:save', async (event, payload) => {
        try {
            const markdown = payload && typeof payload.markdown === 'string' ? payload.markdown : '';
            if (!markdown) return { success: false, error: '没有可保存的内容' };

            const defaultName = sanitizeFileName(payload.title) + '.md';
            const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
                title: '保存 Markdown 文档',
                defaultPath: defaultName,
                filters: [{ name: 'Markdown 文件', extensions: ['md'] }]
            });
            if (canceled || !filePath) return { success: false, canceled: true };

            const stem = path.basename(filePath, path.extname(filePath));
            let content = markdown;
            let assetsCopied = 0;

            const assetsDir = payload.assetsDir;
            if (typeof assetsDir === 'string' && fs.existsSync(assetsDir)) {
                const images = fs.readdirSync(assetsDir);
                if (images.length > 0) {
                    const destDir = path.join(path.dirname(filePath), stem + '.assets');
                    fs.cpSync(assetsDir, destDir, { recursive: true });
                    content = content.split('](assets/').join(`](${stem}.assets/`);
                    assetsCopied = images.length;
                }
            }

            fs.writeFileSync(filePath, content, 'utf8');
            const sizeKB = Math.round(fs.statSync(filePath).size / 1024);
            return { success: true, filePath, sizeKB, assetsCopied };
        } catch (error) {
            return { success: false, error: error.message };
        }
    });
}

// ===== 应用生命周期 =====
app.whenReady().then(async () => {
    migrateLegacyUserData();
    createWindow();
    createTray();
    setupIPC();
    prepareImportCache();

    // 启动时检测 Pandoc
    serverApp.checkPandoc();

    setTimeout(() => {
        if (mainWindow) mainWindow.show();
    }, 300);
});

app.on('before-quit', (event) => {
    if (!isQuitting) {
        event.preventDefault();
        isQuitting = true;
        sidecar.stop();
        app.quit();
    }
});

app.on('window-all-closed', (event) => {
    event.preventDefault();
});

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
    } else {
        mainWindow?.show();
    }
});
