/**
 * ProTools Desktop - MarkItDown 侧车进程管理
 *
 * MarkItDown 是 Python 库，这里以「常驻子进程 + JSON Lines 协议」的方式接入：
 * 首次转换时才启动进程并加载模型，之后复用；空闲 5 分钟后自动退出，避免长期占用内存。
 * 转换串行执行（单用户桌面场景足够），超时或进程崩溃时统一拒绝在途请求并允许下次重启。
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const REQUEST_TIMEOUT_MS = 120 * 1000;
const STARTUP_TIMEOUT_MS = 60 * 1000;
const IDLE_TIMEOUT_MS = 5 * 60 * 1000;

let childProcess = null;
let reader = null;
let readyInfo = null;
let startupPromise = null;
let pending = new Map();
let sequence = 0;
let idleTimer = null;
let lastError = null;

/**
 * 解析侧车可执行文件路径。
 * 打包后位于 resources/sidecar，开发态回落到仓库内的构建产物。
 * @returns {string|null}
 */
function resolveExecutable() {
    const candidates = [];

    if (process.env.PROTOOLS_SIDECAR_PATH) {
        candidates.push(process.env.PROTOOLS_SIDECAR_PATH);
    }
    // 兼容更名前的环境变量，避免旧脚本失效
    if (process.env.MTD_SIDECAR_PATH) {
        candidates.push(process.env.MTD_SIDECAR_PATH);
    }

    try {
        const { app } = require('electron');
        if (app && app.isPackaged) {
            candidates.push(path.join(process.resourcesPath, 'sidecar', 'markitdown-sidecar.exe'));
        }
    } catch (error) {
        // 非 Electron 环境下直接走开发态路径，便于单独用 Node 调试
    }

    candidates.push(
        path.join(__dirname, '..', 'markitdown-sidecar', 'dist', 'markitdown-sidecar', 'markitdown-sidecar.exe')
    );

    for (const candidate of candidates) {
        try {
            if (candidate && fs.existsSync(candidate)) return candidate;
        } catch (error) {
            // 忽略无权限等异常，继续尝试下一个候选路径
        }
    }
    return null;
}

function touchIdleTimer() {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
        if (pending.size === 0) stop();
    }, IDLE_TIMEOUT_MS);
    if (idleTimer.unref) idleTimer.unref();
}

function rejectAll(reason) {
    for (const [, entry] of pending) {
        clearTimeout(entry.timer);
        entry.reject(reason instanceof Error ? reason : new Error(String(reason)));
    }
    pending.clear();
}

function handleFrame(frame) {
    if (frame.type === 'ready') {
        readyInfo = {
            version: frame.version || null,
            protocol: frame.protocol || null,
            formats: Array.isArray(frame.formats) ? frame.formats : [],
        };
        return;
    }

    if (frame.type === 'pong') {
        const entry = pending.get(String(frame.id));
        if (entry) {
            clearTimeout(entry.timer);
            pending.delete(String(frame.id));
            entry.resolve(frame);
        }
        return;
    }

    const id = String(frame.id);
    const entry = pending.get(id);
    if (!entry) return;
    clearTimeout(entry.timer);
    pending.delete(id);

    if (frame.type === 'error') {
        const error = new Error(frame.message || '转换失败');
        error.code = frame.code || 'convert_failed';
        entry.reject(error);
        return;
    }
    entry.resolve(frame);
}

/**
 * 启动侧车进程（幂等）。重复调用返回同一个 Promise。
 * @returns {Promise<{version: string|null, formats: string[]}>}
 */
function start() {
    if (childProcess && readyInfo) return Promise.resolve(readyInfo);
    if (startupPromise) return startupPromise;

    const executable = resolveExecutable();
    if (!executable) {
        const error = new Error('未找到 MarkItDown 运行组件，请重新安装应用');
        error.code = 'sidecar_missing';
        lastError = error.message;
        return Promise.reject(error);
    }

    startupPromise = new Promise((resolve, reject) => {
        let settled = false;
        const timer = setTimeout(() => {
            if (settled) return;
            settled = true;
            lastError = 'MarkItDown 组件启动超时';
            stop();
            reject(new Error(lastError));
        }, STARTUP_TIMEOUT_MS);

        childProcess = spawn(executable, [], {
            windowsHide: true,
            stdio: ['pipe', 'pipe', 'pipe'],
        });

        reader = readline.createInterface({ input: childProcess.stdout });
        reader.on('line', (line) => {
            const text = line.trim();
            if (!text) return;
            let frame;
            try {
                frame = JSON.parse(text);
            } catch (error) {
                console.warn('[markitdown] 无法解析的响应帧:', text.slice(0, 200));
                return;
            }
            // ready 帧是启动完成的信号，需要同时兑现 startupPromise
            if (frame.type === 'ready' && !settled) {
                settled = true;
                clearTimeout(timer);
                handleFrame(frame);
                startupPromise = null;
                touchIdleTimer();
                resolve(readyInfo);
                return;
            }
            handleFrame(frame);
        });

        childProcess.stderr.on('data', (chunk) => {
            const text = String(chunk).trim();
            if (text) console.log('[markitdown]', text);
        });

        childProcess.on('error', (error) => {
            lastError = error.message;
            if (!settled) {
                settled = true;
                clearTimeout(timer);
                startupPromise = null;
                reject(error);
            }
            rejectAll(error);
            childProcess = null;
            readyInfo = null;
        });

        childProcess.on('exit', (code) => {
            if (!settled) {
                settled = true;
                clearTimeout(timer);
                startupPromise = null;
                reject(new Error(`MarkItDown 组件异常退出（code=${code}）`));
            }
            rejectAll(new Error(`MarkItDown 组件已退出（code=${code}）`));
            childProcess = null;
            reader = null;
            readyInfo = null;
        });
    });

    return startupPromise;
}

/**
 * 把一个本地文件转换为 Markdown。
 * @param {string} filePath 源文件绝对路径
 * @param {{assetsDir?: string, assetRef?: string}} [options]
 * @returns {Promise<{markdown: string, title: string, chars: number, images: number, elapsed_ms: number}>}
 */
async function convert(filePath, options = {}) {
    if (typeof filePath !== 'string' || !filePath.trim()) {
        throw new Error('文件路径不能为空');
    }
    await start();

    const id = String(++sequence);
    const payload = {
        id,
        op: 'convert',
        path: filePath,
        assets_dir: options.assetsDir || null,
        asset_ref: options.assetRef || 'assets',
    };

    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            pending.delete(id);
            // 超时通常意味着解析卡死，直接重启进程，避免后续请求继续排队
            stop();
            reject(new Error('转换超时（超过 120 秒），已重置转换组件'));
        }, REQUEST_TIMEOUT_MS);

        pending.set(id, { resolve, reject, timer });
        try {
            childProcess.stdin.write(JSON.stringify(payload) + '\n');
        } catch (error) {
            clearTimeout(timer);
            pending.delete(id);
            reject(error);
        }
        touchIdleTimer();
    });
}

/**
 * 查询组件状态（不启动进程）。
 * @returns {Promise<{available: boolean, ready: boolean, version: string|null, executable: string|null, formats: string[], error: string|null}>}
 */
async function status() {
    const executable = resolveExecutable();
    return {
        available: Boolean(executable),
        ready: Boolean(readyInfo),
        version: readyInfo ? readyInfo.version : null,
        protocol: readyInfo ? readyInfo.protocol : null,
        formats: readyInfo ? readyInfo.formats : [],
        executable,
        error: lastError,
    };
}

function stop() {
    if (idleTimer) {
        clearTimeout(idleTimer);
        idleTimer = null;
    }
    if (!childProcess) {
        readyInfo = null;
        return;
    }
    try {
        childProcess.stdin.write(JSON.stringify({ id: 'bye', op: 'shutdown' }) + '\n');
    } catch (error) {
        // 进程可能已经退出，忽略写入失败
    }
    try {
        childProcess.kill();
    } catch (error) {
        // 同上
    }
    childProcess = null;
    readyInfo = null;
}

module.exports = { convert, start, status, stop, resolveExecutable };
