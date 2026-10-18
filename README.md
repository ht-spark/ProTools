# ProTools

面向 Windows 的双向文档转换工具：任意文档 → Markdown，以及 Markdown + LaTeX → Word。适用于把论文、报告、课件、扫描件转成可编辑文本，再回填为格式规范的 Word 文档。

- 文档导入由 [MarkItDown](https://github.com/microsoft/markitdown)驱动，覆盖 PDF / Office / 图片 / 音频 / 网页等 20+ 格式
- 文档导出由 [Pandoc](https://pandoc.org/) 驱动，公式以 OMML 形式写入，Word 中可直接编辑；表格支持三线表与黑色框线

## 功能

| 模块     | 输入                                                                                               | 输出     | 关键能力                                                                              |
| -------- | -------------------------------------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------- |
| 文档导入 | PDF、DOCX、PPTX、XLSX/XLS、HTML、EPUB、CSV、JSON、XML、ZIP、MSG、IPYNB、图片（含 EXIF）、音频、RSS | Markdown | 标题 / 列表 / 表格结构保留；内嵌图片自动落盘；多文件队列串行转换                      |
| 文档导出 | Markdown、纯文本                                                                                   | DOCX     | LaTeX 公式转 Word 原生公式；三线表 / 边框表；中英文字体与字号；目录、硬换行、编号控制 |

导入结果可一键「送入 Word 转换」，形成 **PDF → Markdown → 规范 Word** 的闭环。

## 技术架构

```
┌──────────────────────────────────────────────────────────┐
│ 渲染进程  renderer/（原生 HTML/CSS/JS，无框架）           │
│   转换页（Markdown → Word）   文档导入页（文档 → Markdown）│
└───────────────┬──────────────────────────────────────────┘
                │ contextBridge + IPC（preload.js）
┌───────────────▼──────────────────────────────────────────┐
│ 主进程  main.js                                          │
│   ├─ server-app.js ──► Pandoc（系统安装）→ DOCX          │
│   │                    reference.docx / Lua 过滤器        │
│   └─ sidecar.js ─────► markitdown-sidecar.exe（Python）  │
│                        常驻子进程，JSON Lines over stdio  │
└──────────────────────────────────────────────────────────┘
```

侧车选择常驻进程而非一次性调用：冷启动需加载 magika 模型（约 1.5 秒），复用后单次转换可降至 50–200 毫秒。
==========================================================================================================

将markdown导出为格式规范工整Word文档，支持可编辑的LaTeX公式和格式化表格（三线表 / 边框表）以及自定义字体设置。

>>>>>>> a081b2ee6e4c97194c600906e7da5d03cf5d1d67
>>>>>>>
>>>>>>
>>>>>
>>>>
>>>
>>

## 目录结构

```
<<<<<<< HEAD
plugin/
├── desktop-app/            # Electron 应用
│   ├── main.js             # 主进程：窗口、托盘、IPC、历史与字体设置
│   ├── preload.js          # contextBridge API
│   ├── server-app.js       # Pandoc 封装（查找引擎、调用、样式后处理）
│   ├── sidecar.js          # MarkItDown 侧车生命周期管理
│   ├── renderer/           # index.html / app.js / style.css / app-icon.png
│   ├── assets/             # icon.ico（窗口、任务栏、安装包图标）
│   ├── scripts/            # after-pack.js（打包后写入图标与版本信息）
│   ├── tools/              # rcedit-x64.exe（图标写入，随仓库内置）
│   └── .gitignore
├── server/                 # Markdown → DOCX 转换实现（可独立以 HTTP 服务运行）
│   ├── index.js            # Express 接口：GET /health、POST /convert
│   ├── tableStyler.js      # 用 adm-zip 改写 document.xml 注入表格样式
│   ├── fontStyler.js       # 字体与字号注入
│   ├── markdownPreprocessor.js
│   ├── reference/reference.docx   # Pandoc 参考样式（宋体正文/标题）
│   └── templates/*.lua     # 公式与表格的 Pandoc 过滤器
├── markitdown-sidecar/     # Python 侧车
│   ├── sidecar.py          # JSON Lines 协议（ready / ping / convert）
│   ├── build.py            # PyInstaller onedir 打包与裁剪
│   └── requirements.txt
└── icons/                  # 多尺寸图标（ico / 16–512 png）
=======
MTD/
├── desktop-app/   # Electron 桌面应用（界面 + 主进程）
├── server/        # Markdown/LaTeX → DOCX 转换服务（基于 Pandoc）
└── icons/         # 应用图标
>>>>>>> a081b2ee6e4c97194c600906e7da5d03cf5d1d67
```

## 环境要求

| 场景             | 依赖                                                                      |
| ---------------- | ------------------------------------------------------------------------- |
| 运行（终端用户） | Windows 10/11 x64、**Pandoc 3.x**（必需，需在 PATH 或标准安装目录） |
| 开发             | 上一行 + Node.js 18+                                                      |
| 构建侧车         | 上一行 + Python 3.11、[uv](https://github.com/astral-sh/uv)                |

```bash
winget install JohnMacFarlane.Pandoc
pandoc --version   # 确认可用
```

未安装 Pandoc 时，Markdown → Word 不可用（界面会提示并给出下载入口）；文档导入不受影响。

## 开发运行

```bash
# 1. 安装依赖（三个子项目各自封闭，不共享 node_modules）
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

`build.py` 不会删除旧产物，而是改名为 `dist/.dist-previous-<时间戳>`，可手动清理。

## 构建安装包

```bash
cd markitdown-sidecar
.venv/Scripts/python.exe build.py        # 产出 dist/markitdown-sidecar/（约 151 MB）

cd ../desktop-app
npm run build          # NSIS 安装包，输出到 dist/
npm run build:dir      # 仅免安装目录
```

构建前请确认 `markitdown-sidecar/dist/markitdown-sidecar/markitdown-sidecar.exe` 存在，否则安装包会缺少导入能力。

**本机已知构建限制**：electron-builder 解压 `winCodeSign` 时会因 macOS 符号链接需要管理员权限而失败。可用以下方式绕开：

```bash
./node_modules/.bin/electron-builder --win \
  --config.directories.output=dist-installer \
  --config.win.signAndEditExecutable=false
```

图标与版本信息由 `build.afterPack` 钩子调用仓库内置的 `tools/rcedit-x64.exe` 补写，因此跳过 electron-builder 内置签名步骤不会丢失这些元数据，也不需要管理员权限。`directories.output` 建议每次指向新目录，避免覆盖旧目录触发文件保护。

## 配置

### 环境变量

| 变量                      | 作用                                           |
| ------------------------- | ---------------------------------------------- |
| `PROTOOLS_SIDECAR_PATH` | 覆盖侧车可执行文件路径（调试或外置部署时使用） |
| `MTD_SIDECAR_PATH`      | 更名前的旧变量，仍兼容                         |

### 数据存放

| 路径                                           | 内容                                              |
| ---------------------------------------------- | ------------------------------------------------- |
| `%APPDATA%\ProTools\conversion-history.json` | 转换历史（最多 100 条，仅文件名与时间，不含正文） |
| `%APPDATA%\ProTools\font-settings.json`      | 字体与字号设置                                    |
| `%TEMP%\protools-markitdown-cache\`          | 导入期间的内嵌图片，超过 24 小时自动清理          |

更名后的首次启动会自动从 `%APPDATA%\mtd-desktop` 迁移历史与字体设置（仅当目标不存在时复制）。

## 使用要点

1. **文档 → Markdown**：拖入或选择文件 → 转换 → 预览 → 可「复制」「保存 .md」「送入 Word 转换」。
2. **保存 .md 时的图片**：正文中的 base64 图片会写成独立文件，随文档保存为同名 `.assets` 目录，Markdown 引用同步改写为该目录相对路径。
3. **Markdown → Word**：粘贴或载入 `.md`，设置标题、表格样式与格式选项，导出由系统保存对话框决定位置。
4. **安全边界**：侧车仅接受本地文件路径（`convert_local`），不开放 URL / data URI 入口，避免被当作 SSRF 跳板。

## 已知限制

- 应用图标沿用 Electron 官方标志（深色圆形原子），仅作个人/内部使用；如需对外分发请替换为自有图标，并同步更新 `icons/`、`desktop-app/assets/icon.ico` 与 `renderer/app-icon.png`。
- 未启用云端增强：Azure Document Intelligence / Content Understanding、LLM 图片描述与 OCR 插件均未接入，扫描版 PDF 仍只能取文本层。
- 音频转写依赖在线识别接口（离线 pocketsphinx 模型已从发行包裁剪以减小体积），无网络时该能力不可用。
- MarkItDown 输出面向 LLM 消费，复杂多栏版面、跨页表格的还原度有限；高保真排版请以原始文档为准。
- 多文件导入为串行处理，单次转换超时 120 秒，超时后侧车会自动重启。

## 故障排查

| 现象                                                          | 原因与处理                                                                                                                                                                  |
| ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 转换提示「未找到 Pandoc」                                     | Pandoc 未安装或不在 PATH；`winget install JohnMacFarlane.Pandoc` 后点击「重新检测」                                                                                       |
| 导入提示「未找到 MarkItDown 运行组件」                        | `resources/sidecar/markitdown-sidecar.exe` 缺失；重新构建侧车并打包                                                                                                       |
| 首次导入等待 1–2 秒                                          | 侧车冷启动加载模型，属正常；进入导入页会提前预热                                                                                                                            |
| 打包报 `Cannot create symbolic link` / winCodeSign 下载失败 | 使用上文 `signAndEditExecutable=false` 方案，或开启 Windows 开发者模式                                                                                                    |
| `npm start` 一闪而过                                        | 环境存在 `ELECTRON_RUN_AS_NODE=1`，Electron 会退化为 Node；启动前执行 `unset ELECTRON_RUN_AS_NODE`（Git Bash）或 `Remove-Item Env:ELECTRON_RUN_AS_NODE`（PowerShell） |
| 侧车启动超时                                                  | 检查杀毒软件是否拦截新生成的 exe；可设 `PROTOOLS_SIDECAR_PATH` 指向可执行副本定位问题                                                                                     |

## 版本记录

| 版本   | 变更                                                                                                                                                                                  |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| v1.1.0 | 集成 MarkItDown 文档导入（Python 侧车）；产品更名 MTD → ProTools；新增导入页与引擎状态卡片；用户数据迁移；导航改为「MD转docx / 文档转MD」；统一应用图标并修复安装版表格/字体样式失效 |
| v1.0.0 | 首个版本：Markdown + LaTeX → Word，三线表 / 边框表，字体设置与转换历史                                                                                                               |
