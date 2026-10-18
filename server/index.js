const express = require('express');
const cors = require('cors');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { v4: uuidv4 } = require('uuid');
const { applyTableStyle } = require('./tableStyler');
const { normalizeMarkdown } = require('./markdownPreprocessor');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

const TEMPLATES_DIR = path.join(__dirname, 'templates');
const REFERENCE_DOCX_DIR = path.join(__dirname, 'reference');
const REFERENCE_DOCX = path.join(REFERENCE_DOCX_DIR, 'reference.docx');

function ensureDirectories() {
    for (const dir of [TEMPLATES_DIR, REFERENCE_DOCX_DIR]) {
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    }
}

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

let PANDOC_PATH = null;

function checkPandoc() {
    PANDOC_PATH = findPandoc();
    if (PANDOC_PATH) {
        try {
            const version = execSync(`"${PANDOC_PATH}" --version`, { encoding: 'utf8' });
            console.log('Pandoc found at:', PANDOC_PATH);
            console.log('Version:', version.split('\n')[0]);
            return true;
        } catch (e) {
            PANDOC_PATH = null;
            return false;
        }
    }
    console.warn('Pandoc not found. Install from: https://pandoc.org/');
    return false;
}

app.get('/health', (req, res) => {
    const ok = checkPandoc();
    let version = 'not found';
    if (ok && PANDOC_PATH) {
        try { version = execSync(`"${PANDOC_PATH}" --version`, { encoding: 'utf8' }).split('\n')[0]; } catch (e) {}
    }
    res.json({ status: ok ? 'ok' : 'degraded', pandoc: ok, version, pandocPath: PANDOC_PATH });
});

app.post('/convert', async (req, res) => {
    const startTime = Date.now();
    const tmpDir = path.join(os.tmpdir(), 'ae-docx-' + uuidv4());

    try {
        if (!PANDOC_PATH) {
            const found = checkPandoc();
            if (!found) {
                return res.status(500).json({ error: 'Pandoc not found. Please install Pandoc first: https://pandoc.org/installing.html' });
            }
        }

        const {
            content,
            title = 'AI对话导出',
            table_style = 'three-line',
            remove_hr = false,
            hard_line_breaks = false,
            disable_auto_numbering = false,
            toc = false
        } = req.body;

        if (!content || typeof content !== 'string') {
            return res.status(400).json({ error: 'Missing required field: content' });
        }

        fs.mkdirSync(tmpDir, { recursive: true });

        let processedContent = content;

        if (remove_hr) {
            processedContent = processedContent.replace(/^---\s*$/gm, '');
            processedContent = processedContent.replace(/^___\s*$/gm, '');
            processedContent = processedContent.replace(/^\*\*\*\s*$/gm, '');
        }

        if (hard_line_breaks) {
            processedContent = processedContent.replace(/\n(?!\n)/g, '  \n');
        }

        processedContent = normalizeMarkdown(processedContent);

        const mdFile = path.join(tmpDir, 'input.md');
        let frontMatter = '---\n';
        frontMatter += `title: "${title.replace(/"/g, '\\"')}"\n`;
        if (toc) frontMatter += 'toc: true\n';
        frontMatter += '...\n\n';
        fs.writeFileSync(mdFile, frontMatter + processedContent, 'utf8');

        const outputFile = path.join(tmpDir, 'output.docx');

        const pandocArgs = [
            `"${mdFile}"`,
            '-o', `"${outputFile}"`,
            '--from', 'markdown+tex_math_single_backslash+tex_math_dollars+pipe_tables+multiline_tables+grid_tables+fenced_code_blocks+backtick_code_blocks+table_captions',
            '--to', 'docx',
            '--wrap', 'preserve',
            '--lua-filter', `"${path.join(TEMPLATES_DIR, 'math-fix.lua')}"`,
            '--resource-path', `"${tmpDir}"`
        ];

        if (fs.existsSync(REFERENCE_DOCX)) {
            pandocArgs.push('--reference-doc', `"${REFERENCE_DOCX}"`);
        }

        const pandocCmd = `"${PANDOC_PATH}" ${pandocArgs.join(' ')}`;
        console.log('Running pandoc...');

        execSync(pandocCmd, {
            cwd: tmpDir,
            timeout: 120000,
            maxBuffer: 200 * 1024 * 1024,
            env: { ...process.env, LANG: 'zh_CN.UTF-8' }
        });

        if (!fs.existsSync(outputFile)) {
            throw new Error('Pandoc failed to generate output file');
        }

        try {
            applyTableStyle(outputFile, table_style);
            console.log(`Applied table style: ${table_style}`);
        } catch (styleErr) {
            console.warn('Table styling failed (non-fatal):', styleErr.message);
        }

        const stat = fs.statSync(outputFile);
        const timeMs = Date.now() - startTime;
        console.log(`Done: ${(stat.size / 1024).toFixed(1)}KB in ${timeMs}ms`);

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
        res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(title)}.docx"`);
        res.setHeader('X-Conversion-Time', `${timeMs}ms`);

        const stream = fs.createReadStream(outputFile);
        stream.pipe(res);
        stream.on('end', () => {
            cleanup(tmpDir);
        });
        stream.on('error', (err) => {
            console.error('Stream error:', err);
            cleanup(tmpDir);
        });

    } catch (error) {
        console.error('Conversion failed:', error.message);
        cleanup(tmpDir);

        if (error.message && error.message.includes('pandoc')) {
            return res.status(500).json({
                error: 'Document conversion failed',
                detail: error.message
            });
        }

        if (!res.headersSent) {
            res.status(500).json({ error: error.message || 'Conversion failed' });
        }
    }
});

function cleanup(tmpDir) {
    try {
        if (fs.existsSync(tmpDir)) {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        }
    } catch (e) {
        console.warn('Cleanup failed:', e.message);
    }
}

function initReferenceDocx() {
    if (fs.existsSync(REFERENCE_DOCX)) {
        console.log('Using reference.docx (宋体正文小四/标题四号)');
        return;
    }
    console.warn('reference.docx not found, run: node scripts/generate-reference-docx.js');
    console.warn('Font defaults will apply (may not be SimSun).');
}

ensureDirectories();
const pandocOk = checkPandoc();
if (pandocOk) initReferenceDocx();

if (!pandocOk) {
    console.log('');
    console.log('============================================================');
    console.log('  Pandoc not found!');
    console.log('  Install: https://pandoc.org/installing.html');
    console.log('  Or run:  winget install JohnMacFarlane.Pandoc');
    console.log('============================================================');
    console.log('');
}

app.listen(PORT, '0.0.0.0', () => {
    console.log(`ProTools Server running on http://localhost:${PORT}`);
    console.log(`  Pandoc: ${PANDOC_PATH || 'NOT FOUND'}`);
    console.log(`  POST /convert`);
    console.log(`  GET  /health`);
});