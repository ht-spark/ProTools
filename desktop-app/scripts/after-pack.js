/**
 * electron-builder afterPack 钩子：为 Windows 可执行文件写入图标与版本信息。
 *
 * 背景：本机构建时 electron-builder 无法解压 winCodeSign（其中 macOS 测试文件需要
 * 创建符号链接，普通用户权限不足），因此以 signAndEditExecutable=false 跳过其内置
 * 的 rcedit 步骤；副作用是 exe 保留 Electron 默认图标，与界面图标不一致。
 *
 * 这里改用随仓库内置的 rcedit 完成同样的工作，不依赖网络与管理员权限。
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const APP_DIR = path.join(__dirname, '..');

module.exports = async function afterPack(context) {
    if (context.electronPlatformName !== 'win32') return;

    const productName = context.packager.appInfo.productFilename;
    const executable = path.join(context.appOutDir, `${productName}.exe`);
    const rcedit = path.join(APP_DIR, 'tools', 'rcedit-x64.exe');
    const icon = path.join(APP_DIR, 'assets', 'icon.ico');
    const { version } = context.packager.appInfo;

    if (!fs.existsSync(executable)) {
        console.warn(`[after-pack] 跳过：未找到 ${executable}`);
        return;
    }
    if (!fs.existsSync(rcedit) || !fs.existsSync(icon)) {
        console.warn('[after-pack] 跳过：rcedit 或 icon.ico 缺失');
        return;
    }

    const args = [
        executable,
        '--set-icon', icon,
        '--set-file-version', `${version}.0`,
        '--set-product-version', version,
        '--set-version-string', 'ProductName', productName,
        '--set-version-string', 'FileDescription', `${productName} - 文档与 Word 互转`,
        '--set-version-string', 'CompanyName', productName,
        '--set-version-string', 'LegalCopyright', productName,
        '--set-version-string', 'OriginalFilename', `${productName}.exe`,
    ];

    try {
        execFileSync(rcedit, args, { stdio: 'pipe' });
        console.log(`[after-pack] 已写入图标与版本信息：${path.basename(executable)}`);
    } catch (error) {
        console.warn('[after-pack] 写入失败（不阻断构建）：', error.message);
    }
};
