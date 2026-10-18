/**
 * ProTools 服务器 + 转换引擎封装
 * 支持 HTTP 服务器模式 + 直接调用转换模式
 */
const express = require('express');
const cors = require('cors');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { v4: uuidv4 } = require('uuid');

let app = null;
let server = null;
let PANDOC_PATH = null;

/**
 * 获取 server 资源目录路径
 */
function getServerPath() {
    if (process.env.ELECTRON_DEV_SERVER_PATH) {
        return process.env.ELECTRON_DEV_SERVER_PATH;
    }
    const { app } = require('electron');
    if (app && app.isPackaged) {
        return path.join(process.resourcesPath, 'server');
    }
    return path.join(__dirname, '..', 'server');
}

function getTemplatesDir() {
    return path.join(getServerPath(), 'templates');
}

function getReferenceDocx() {
    return path.join(getServerPath(), 'reference', 'reference.docx');
}

let _tableStyler = null;
let _markdownPreprocessor = null;
let _fontStyler = null;

function getTableStyler() {
    if (!_tableStyler) {
        _tableStyler = require(path.join(getServerPath(), 'tableStyler'));
    }
    return _tableStyler;
}

function getMarkdownPreprocessor() {
    if (!_markdownPreprocessor) {
        _markdownPreprocessor = require(path.join(getServerPath(), 'markdownPreprocessor'));
    }
    return _markdownPreprocessor;
}

function getFontStyler() {
    if (!_fontStyler) {
        _fontStyler = require(path.join(getServerPath(), 'fontStyler'));
    }
    return _fontStyler;
}

/**
 * 查找 Pandoc
 */
function findPandoc() {
    const homeDir = os.homedir();
    const candidates = [
        'pandoc', 'pandoc.exe',
        path.join('C:', 'Program Files', 'Pandoc', 'pandoc.exe'),
        path.join('C:', 'Program Files (x86)', 'Pandoc', 'pandoc.exe'),
        path.join(homeDir, 'AppData', 'Local', 'Pandoc', 'pandoc.exe'),
        path.join(homeDir, 'AppData', 'Local', 'Microsoft', 'WinGet', 'Packages', 'JohnMacFarlane.Pandoc_Microsoft.Winget.Source_8wekyb3d8bbwe', 'pandoc.exe'),
    ];

    const pathDirs = (process.env.PATH || '').split(path.delimiter);
    for (const dir of pathDirs) {
        for (const name of ['pandoc.exe', 'pandoc']) {
            const p = path.join(dir, name);
            if (fs.existsSync(p)) return p;
        }
    }

    for (const candidate of candidates) {
        if (fs.existsSync(candidate)) return candidate;
        try {
            execSync(`"${candidate}" --version`, { encoding: 'utf8', timeout: 3000 });
            return candidate;
        } catch (e) {}
    }

    try {
        const result = execSync('where pandoc 2>nul', { encoding: 'utf8', timeout: 5000 });
        const first = result.trim().split('\n')[0];
        if (first && fs.existsSync(first.trim())) return first.trim();
    } catch (e) {}

    return null;
}

function checkPandoc() {
    PANDOC_PATH = findPandoc();
    if (PANDOC_PATH) {
        try {
            const version = execSync(`"${PANDOC_PATH}" --version`, { encoding: 'utf8' });
            return { found: true, path: PANDOC_PATH, version: version.split('\n')[0] };
        } catch (e) {
            PANDOC_PATH = null;
        }
    }
    return { found: false, path: null, version: null };
}

function getPandocStatus() {
    if (PANDOC_PATH) {
        try {
            const version = execSync(`"${PANDOC_PATH}" --version`, { encoding: 'utf8' }).split('\n')[0];
            return { found: true, path: PANDOC_PATH, version };
        } catch (e) {}
    }
    return checkPandoc();
}

/**
 * 核心转换函数（直接调用，不走 HTTP）
 * @param {Object} options - 转换选项
 * @returns {Promise<{success, outputFile, timeMs}>}
 */
async function convertToDocx(options) {
    const {
        content,
        title = 'AI对话导出',
        table_style = 'three-line',
        remove_hr = false,
        hard_line_breaks = false,
        disable_auto_numbering = false,
        toc = false,
        font_settings = null,
        outputPath = null  // 如果指定，直接保存到该路径
    } = options;

    if (!content || typeof content !== 'string') {
        throw new Error('内容不能为空');
    }

    // 确保 Pandoc 可用
    if (!PANDOC_PATH) {
        const status = checkPandoc();
        if (!status.found) {
            throw new Error('未找到 Pandoc，请先安装 Pandoc：https://pandoc.org/installing.html');
        }
    }

    const startTime = Date.now();
    const tmpDir = path.join(os.tmpdir(), 'ae-docx-' + uuidv4());
    fs.mkdirSync(tmpDir, { recursive: true });

    try {
        let processedContent = content;

        if (remove_hr) {
            processedContent = processedContent.replace(/^---\s*$/gm, '');
            processedContent = processedContent.replace(/^___\s*$/gm, '');
            processedContent = processedContent.replace(/^\*\*\*\s*$/gm, '');
        }

        if (hard_line_breaks) {
            processedContent = processedContent.replace(/\n(?!\n)/g, '  \n');
        }

        const { normalizeMarkdown } = getMarkdownPreprocessor();
        processedContent = normalizeMarkdown(processedContent);

        const mdFile = path.join(tmpDir, 'input.md');
        let frontMatter = '---\n';
        frontMatter += `title: "${title.replace(/"/g, '\\"')}"\n`;
        if (toc) frontMatter += 'toc: true\n';
        frontMatter += '...\n\n';
        fs.writeFileSync(mdFile, frontMatter + processedContent, 'utf8');

        const outputFile = path.join(tmpDir, 'output.docx');
        const templatesDir = getTemplatesDir();
        const referenceDocx = getReferenceDocx();

        const pandocArgs = [
            `"${mdFile}"`,
            '-o', `"${outputFile}"`,
            '--from', 'markdown+tex_math_single_backslash+tex_math_dollars+pipe_tables+multiline_tables+grid_tables+fenced_code_blocks+backtick_code_blocks+table_captions',
            '--to', 'docx',
            '--wrap', 'preserve',
            '--lua-filter', `"${path.join(templatesDir, 'math-fix.lua')}"`,
            '--resource-path', `"${tmpDir}"`
        ];

        if (fs.existsSync(referenceDocx)) {
            pandocArgs.push('--reference-doc', `"${referenceDocx}"`);
        }

        const pandocCmd = `"${PANDOC_PATH}" ${pandocArgs.join(' ')}`;

        execSync(pandocCmd, {
            cwd: tmpDir,
            timeout: 120000,
            maxBuffer: 200 * 1024 * 1024,
            env: { ...process.env, LANG: 'zh_CN.UTF-8' }
        });

        if (!fs.existsSync(outputFile)) {
            throw new Error('Pandoc 未能生成输出文件');
        }

        // 应用表格样式
        try {
            const { applyTableStyle } = getTableStyler();
            applyTableStyle(outputFile, table_style, require('adm-zip'));
        } catch (styleErr) {
            console.warn('Table styling failed (non-fatal):', styleErr.message);
        }

        // 应用字体设置
        if (font_settings && font_settings.enabled) {
            try {
                const { applyFontStyle } = getFontStyler();
                applyFontStyle(outputFile, font_settings, require('adm-zip'));
            } catch (fontErr) {
                console.warn('Font styling failed (non-fatal):', fontErr.message);
            }
        }

        const timeMs = Date.now() - startTime;

        // 如果指定了输出路径，复制到目标位置
        if (outputPath) {
            fs.copyFileSync(outputFile, outputPath);
            cleanup(tmpDir);
            return { success: true, outputFile: outputPath, timeMs };
        }

        // 否则返回临时文件路径（调用方负责处理）
        return { success: true, outputFile, timeMs, tmpDir };
    } catch (error) {
        cleanup(tmpDir);
        throw error;
    }
}

function cleanup(tmpDir) {
    try {
        if (fs.existsSync(tmpDir)) {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        }
    } catch (e) {}
}

/**
 * Express 服务器（保留向后兼容，Chrome 扩展仍可用）
 */
function createExpressApp() {
    const expressApp = express();
    expressApp.use(cors());
    expressApp.use(express.json({ limit: '50mb' }));
    expressApp.use(express.urlencoded({ extended: true, limit: '50mb' }));

    expressApp.get('/health', (req, res) => {
        const pandocStatus = getPandocStatus();
        res.json({
            status: pandocStatus.found ? 'ok' : 'degraded',
            pandoc: pandocStatus.found,
            version: pandocStatus.version,
            pandocPath: pandocStatus.path,
            desktop: true
        });
    });

    expressApp.post('/convert', async (req, res) => {
        try {
            const result = await convertToDocx(req.body);
            const stat = fs.statSync(result.outputFile);

            res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
            res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(req.body.title || '导出文档')}.docx"`);
            res.setHeader('X-Conversion-Time', `${result.timeMs}ms`);

            const stream = fs.createReadStream(result.outputFile);
            stream.pipe(res);
            stream.on('end', () => {
                if (result.tmpDir) cleanup(result.tmpDir);
            });
            stream.on('error', () => {
                if (result.tmpDir) cleanup(result.tmpDir);
            });
        } catch (error) {
            console.error('Conversion failed:', error.message);
            if (!res.headersSent) {
                res.status(500).json({ error: error.message || 'Conversion failed' });
            }
        }
    });

    return expressApp;
}

function startServer(port = 3000) {
    return new Promise((resolve, reject) => {
        try {
            if (server) {
                return resolve({ alreadyRunning: true, port });
            }
            const pandocStatus = checkPandoc();
            app = createExpressApp();
            server = app.listen(port, '0.0.0.0', () => {
                console.log(`ProTools Server running on http://localhost:${port}`);
                resolve({ success: true, port, pandoc: pandocStatus });
            });
            server.on('error', (err) => reject(err));
        } catch (err) {
            reject(err);
        }
    });
}

function stopServer() {
    return new Promise((resolve) => {
        if (server) {
            server.close(() => {
                server = null;
                app = null;
                resolve({ success: true });
            });
        } else {
            resolve({ success: true, alreadyStopped: true });
        }
    });
}

function getServerStatus() {
    return {
        running: !!server,
        port: server ? server.address()?.port : null,
        pandoc: getPandocStatus()
    };
}

module.exports = {
    startServer,
    stopServer,
    getServerStatus,
    checkPandoc,
    getPandocStatus,
    getServerPath,
    convertToDocx,
    cleanup
};
