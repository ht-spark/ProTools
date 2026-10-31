# ProTools

面向 Windows 的双向文档转换桌面应用：**任意文档 → Markdown**，以及 **Markdown + LaTeX → 格式规范的 Word**。适用于把论文、报告、课件、扫描件转成可编辑文本，再回填为排版规整的 Word 文档。

- 文档导入由 [MarkItDown](https://github.com/microsoft/markitdown) 驱动，覆盖 PDF / Office / 图片 / 音频 / 网页等 30 种格式
- 文档导出由 [Pandoc](https://pandoc.org/) 驱动，公式以 OMML 形式写入，Word 中可直接编辑；表格支持三线表与黑色框线

最新安装包见 [Releases](https://github.com/ht-spark/ProTools/releases/latest)。

---

## 功能介绍

### 双向转换

| 模块 | 输入 | 输出 | 关键能力 |
| --- | --- | --- | --- |
| 文档导入 | PDF、DOCX、PPTX、XLSX/XLS、HTML、EPUB、CSV、JSON、XML、ZIP、MSG、IPYNB、TXT/MD、图片（含 EXIF）、音频、RSS/Atom | Markdown | 标题 / 列表 / 表格结构保留；内嵌图片自动落盘为 `.assets` 目录；多文件队列串行转换 |
| 文档导出 | Markdown、纯文本 | DOCX | LaTeX 公式转 Word 原生公式；三线表 / 边框表；中英文字体与字号；标题层级、目录、硬换行、编号控制 |

导入结果可一键「送入 Word 转换」，形成 **PDF → Markdown → 规范 Word** 的闭环。

### 桌面端能力

- **转换历史**：记录最近 100 条转换（仅文件名与时间，不保存正文），支持备注、删除、清空
- **字体与样式**：正文字体、字号、标题字体可持久化保存（`font-settings.json`）
- **引擎状态**：独立页面实时检测 Pandoc 与 MarkItDown 组件是否就绪，缺失时给出安装入口
- **常驻托盘**：关闭窗口不退出，托盘菜单可显示主窗口或退出；支持开机自启
- **单实例**：重复启动会唤醒已有窗口，不会开出第二个进程

### 能力边界

侧车只接受本地文件路径（`convert_local`），不开放 URL / data URI 入口，避免被当作 SSRF 跳板；文档解析与 Word 生成全程在本机完成，仅音频转写在启用时会调用在线识别接口。

---

## 安装方法

### 方式一：下载安装包（终端用户）

1. 打开 [Releases](https://github.com/ht-spark/ProTools/releases/latest)，下载 `ProTools.Setup.exe`（约 131 MB）
2. 双击运行。安装包**未做数字签名**，Windows SmartScreen 会提示「已保护你的电脑」——点 **更多信息 → 仍要运行**
3. 按向导选择安装目录（当前用户安装，**无需管理员权限**），完成
4. 自动创建桌面与开始菜单快捷方式，安装后占用约 414 MB

运行环境：Windows 10/11 x64。**Markdown → Word 需要系统已安装 Pandoc 3.x**（未安装时该功能会提示并给出下载入口，文档导入不受影响）：

```powershell
winget install JohnMacFarlane.Pandoc
pandoc --version   # 确认可用
```

### 方式二：从源码运行

```bash
# 1. 三个子项目各自封闭，不共享 node_modules
cd server && npm install
cd ../desktop-app && npm install
cd ../markitdown-sidecar && uv venv .venv --python 3.11 && uv pip install -r requirements.txt

# 2. 构建侧车（Python 依赖变更后需重做）
cd ../markitdown-sidecar
.venv/Scripts/python.exe build.py

# 3. 启动应用
cd ../desktop-app
npm start
```

开发环境另需 Node.js 18+、Python 3.11 与 [uv](https://github.com/astral-sh/uv)。`npm start` 一闪而过时，多半是环境里存在 `ELECTRON_RUN_AS_NODE=1`，先 `unset ELECTRON_RUN_AS_NODE`。

### 方式三：自行构建安装包

```bash
cd markitdown-sidecar
.venv/Scripts/python.exe build.py        # 产出 dist/markitdown-sidecar/（约 154 MB）

cd ../desktop-app
npm run build          # NSIS 安装包，输出到 dist/
npm run build:dir      # 仅免安装目录
```

构建前确认 `markitdown-sidecar/dist/markitdown-sidecar/markitdown-sidecar.exe` 存在，否则安装包会缺少导入能力。

**本机已知构建限制**：electron-builder 解压 `winCodeSign` 时会因 macOS 符号链接需要管理员权限而失败。可用以下方式绕开：

```bash
./node_modules/.bin/electron-builder --win \
  --config.directories.output=dist-installer \
  --config.win.signAndEditExecutable=false
```

图标与版本信息由 `build.afterPack` 钩子调用仓库内置的 `tools/rcedit-x64.exe` 补写，因此跳过内置签名步骤不会丢失这些元数据，也不需要管理员权限。`directories.output` 建议每次指向新目录，避免覆盖旧目录触发文件保护。

> 安装包体积超过 GitHub 单文件 100 MB 限制，不再纳入版本库（`.gitignore` 已忽略 `desktop-app/*.exe`），发行产物统一走 Releases。

---

## 技术栈

### 分层架构

```
┌──────────────────────────────────────────────────────────┐
│ 渲染进程  renderer/（原生 HTML/CSS/JS，无框架）           │
│   转换页（Markdown → Word）   文档导入页（文档 → Markdown）│
└───────────────┬──────────────────────────────────────────┘
                │ contextBridge + IPC（preload.js）
┌───────────────▼──────────────────────────────────────────┐
│ 主进程  main.js（窗口 / 托盘 / IPC / 历史 / 字体设置）     │
│   ├─ server-app.js ──► Pandoc（系统安装）→ DOCX          │
│   │                    reference.docx / Lua 过滤器        │
│   └─ sidecar.js ─────► markitdown-sidecar.exe（Python）  │
│                        常驻子进程，JSON Lines over stdio  │
└──────────────────────────────────────────────────────────┘
```

### 关键选型

| 层次 | 技术 | 版本 | 说明 |
| --- | --- | --- | --- |
| 桌面外壳 | Electron | ^31 | Windows x64，contextIsolation 开启、nodeIntegration 关闭 |
| 前端 | 原生 HTML / CSS / JS | — | 无框架，`renderer/` 约 3000 行，避免打包体积与构建链 |
| 主进程 | Node.js | 18+ | 窗口、托盘、单实例锁、IPC、历史与设置读写 |
| 文档导出 | Pandoc + Lua filter | 3.x | `math-fix.lua` 修公式、`three-line-table.lua` / `bordered-table.lua` 控制表格 |
| 样式后处理 | adm-zip | ^0.5.17 | 改写 `document.xml` 注入表格边框与字体字号（`tableStyler.js` / `fontStyler.js`） |
| 本地服务 | Express | ^4.18 | `server/index.js` 可独立以 HTTP 服务运行（`GET /health`、`POST /convert`） |
| 文档导入 | MarkItDown（Python） | 0.1.8 | 启用 `pdf/docx/pptx/xlsx/xls/outlook/audio-transcription/youtube-transcription` 等扩展 |
| 侧车打包 | PyInstaller | ≥ 6.10 | onedir 模式 + 依赖裁剪，产物约 154 MB |
| 安装包 | electron-builder（NSIS） | ^24.13 | 当前用户安装、可选目录、创建快捷方式 |

### 设计要点

- **侧车常驻而非一次性调用**：冷启动需加载 magika 模型（约 1.5 秒），复用后单次转换降到 50–200 毫秒；空闲 5 分钟自动退出，超时 120 秒或崩溃时重启并拒绝在途请求。
- **协议极简**：`ready` / `ping` / `convert` 三类 JSON 帧，逐行 over stdio，不引入端口与鉴权。
- **样式与转换解耦**：Pandoc 只负责语义转换，表格边框、字体字号由 `adm-zip` 直接改写 OOXML 完成，便于独立调整而不影响转换逻辑。

### 目录结构

```
MTD/
├── desktop-app/                # Electron 桌面应用
│   ├── main.js                 # 主进程：窗口、托盘、IPC、历史与字体设置
│   ├── preload.js              # contextBridge API
│   ├── server-app.js           # Pandoc 封装（查找引擎、调用、样式后处理）
│   ├── sidecar.js              # MarkItDown 侧车生命周期管理
│   ├── renderer/               # index.html / app.js / style.css / app-icon.png
│   ├── assets/                 # icon.ico（窗口、任务栏、安装包图标）
│   ├── scripts/after-pack.js   # 打包后写入图标与版本信息
│   ├── tools/rcedit-x64.exe    # 图标与版本资源写入（随仓库内置）
│   └── package.json            # 依赖与 electron-builder 配置
├── server/                     # Markdown → DOCX 转换实现（可独立以 HTTP 服务运行）
│   ├── index.js                # Express 接口：GET /health、POST /convert
│   ├── tableStyler.js          # 用 adm-zip 改写 document.xml 注入表格样式
│   ├── fontStyler.js           # 字体与字号注入
│   ├── markdownPreprocessor.js # Markdown 预处理（换行、编号、目录）
│   ├── reference/reference.docx# Pandoc 参考样式（宋体正文 / 标题）
│   └── templates/*.lua         # 公式与表格的 Pandoc 过滤器
├── markitdown-sidecar/         # Python 侧车
│   ├── sidecar.py              # JSON Lines 协议（ready / ping / convert）
│   ├── build.py                # PyInstaller onedir 打包与裁剪
│   └── requirements.txt
└── icons/                      # 应用图标（icon.ico，含 16/24/32/48/64/128/256 帧）
```

### 数据与配置

| 路径 | 内容 |
| --- | --- |
| `%APPDATA%\ProTools\conversion-history.json` | 转换历史（最多 100 条，仅文件名与时间，不含正文） |
| `%APPDATA%\ProTools\font-settings.json` | 字体与字号设置 |
| `%TEMP%\protools-markitdown-cache\` | 导入期间的内嵌图片，超过 24 小时自动清理 |

更名后的首次启动会自动从 `%APPDATA%\mtd-desktop` 迁移历史与字体设置（仅当目标不存在时复制）。

| 环境变量 | 作用 |
| --- | --- |
| `PROTOOLS_SIDECAR_PATH` | 覆盖侧车可执行文件路径（调试或外置部署时使用） |
| `MTD_SIDECAR_PATH` | 更名前的旧变量，仍兼容 |

---

## 使用要点

1. **文档 → Markdown**：拖入或选择文件 → 转换 → 预览 → 可「复制」「保存 .md」「送入 Word 转换」。
2. **保存 .md 时的图片**：正文中的 base64 图片会写成独立文件，随文档保存为同名 `.assets` 目录，Markdown 引用同步改写为该目录相对路径。
3. **Markdown → Word**：粘贴或载入 `.md`，设置标题、表格样式与格式选项，导出由系统保存对话框决定位置。

## 已知限制

- 应用图标沿用 Electron 官方标志（深色圆形原子），仅作个人/内部使用；如需对外分发请替换为自有图标，并同步更新 `icons/icon.ico`、`desktop-app/assets/icon.ico` 与 `renderer/app-icon.png`。
- 未启用云端增强：Azure Document Intelligence / Content Understanding、LLM 图片描述与 OCR 插件均未接入，扫描版 PDF 仍只能取文本层。
- 音频转写依赖在线识别接口（离线 pocketsphinx 模型已从发行包裁剪以减小体积），无网络时该能力不可用。
- MarkItDown 输出面向 LLM 消费，复杂多栏版面、跨页表格的还原度有限；高保真排版请以原始文档为准。
- 多文件导入为串行处理，单次转换超时 120 秒，超时后侧车会自动重启。

## 故障排查

| 现象 | 原因与处理 |
| --- | --- |
| 转换提示「未找到 Pandoc」 | Pandoc 未安装或不在 PATH；`winget install JohnMacFarlane.Pandoc` 后点击「重新检测」 |
| 导入提示「未找到 MarkItDown 运行组件」 | `resources/sidecar/markitdown-sidecar.exe` 缺失；重新构建侧车并打包 |
| 首次导入等待 1–2 秒 | 侧车冷启动加载模型，属正常；进入导入页会提前预热 |
| 打包报 `Cannot create symbolic link` / winCodeSign 下载失败 | 使用上文 `signAndEditExecutable=false` 方案，或开启 Windows 开发者模式 |
| `npm start` 一闪而过 | 环境存在 `ELECTRON_RUN_AS_NODE=1`，Electron 会退化为 Node；启动前执行 `unset ELECTRON_RUN_AS_NODE`（Git Bash）或 `Remove-Item Env:ELECTRON_RUN_AS_NODE`（PowerShell） |
| 侧车启动超时 | 检查杀毒软件是否拦截新生成的 exe；可设 `PROTOOLS_SIDECAR_PATH` 指向可执行副本定位问题 |
| SmartScreen 拦截安装 | 安装包未签名；点「更多信息 → 仍要运行」，或对 exe 做代码签名后再分发 |

## 版本记录

| 版本 | 变更 |
| --- | --- |
| v1.1.0 | 集成 MarkItDown 文档导入（Python 侧车）；产品更名 MTD → ProTools；新增导入页与引擎状态卡片；用户数据迁移；导航改为「MD转docx / 文档转MD」；统一应用图标并修复安装版表格/字体样式失效；首个 Release 发行包 |
| v1.0.0 | 首个版本：Markdown + LaTeX → Word，三线表 / 边框表，字体设置与转换历史 |
