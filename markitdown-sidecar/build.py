"""把 MarkItDown 侧车打包成 onedir 免安装目录。

产物：``dist/markitdown-sidecar/markitdown-sidecar.exe`` 及其依赖 DLL / 数据文件，
由 electron-builder 的 extraResources 整体复制进安装包的 ``resources/sidecar``。

用法：
    python build.py     # 构建；已有产物会被改名挪开（不做删除，便于在受保护环境执行）
"""
from __future__ import annotations

import shutil
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent
DIST_DIR = ROOT / "dist"
BUILD_DIR = ROOT / "build"

# magika 自带 ONNX 模型，pdfminer 依赖 CMap 数据文件，两者必须整体收集
COLLECT_ALL_PACKAGES = ("magika", "pdfminer", "charset_normalizer")

# 转换器按需加载，显式声明避免被静态分析漏掉
HIDDEN_IMPORTS = (
    "markitdown.converters",
    "markitdown.converter_utils",
    "mammoth",
    "openpyxl",
    "xlrd",
    "pptx",
    "olefile",
    "pydub",
    "speech_recognition",
    "youtube_transcript_api",
    "pdfplumber",
    "lxml.etree",
)

# 桌面端用不到、体积又大的模块
EXCLUDED_MODULES = ("tkinter", "matplotlib", "IPython", "pytest", "azure")


def _run(command: list[str]) -> None:
    print(">", " ".join(command), flush=True)
    subprocess.run(command, cwd=ROOT, check=True)


def _set_aside(path: Path, label: str) -> None:
    """把已有产物改名挪开。

    PyInstaller 在 COLLECT 阶段会整目录删除旧产物，该删除动作在部分受保护环境里会被拦截；
    改名不涉及删除，可稳定通过。旧目录保留在 dist 下，由使用者自行清理。
    """
    if not path.exists():
        return
    target = path.with_name(f".{label}-{int(time.time())}")
    try:
        path.rename(target)
        print(f"已挪开旧产物：{target.name}（可手动删除）")
    except OSError as error:
        print(f"无法挪开旧产物：{error}", file=sys.stderr)


TRIM_RELATIVE_PATHS = (
    # 语音识别只用到 Google Web API，pocketsphinx 离线模型用不上
    "speech_recognition/pocketsphinx-data",
    "speech_recognition/flac-linux-x86_64",
    "speech_recognition/flac-linux-x86",
    "speech_recognition/flac-mac",
)


def _trim(internal_dir: Path) -> int:
    """裁剪用不到的运行时数据，返回释放的字节数。"""
    freed = 0
    for relative in TRIM_RELATIVE_PATHS:
        target = internal_dir / relative
        if not target.exists():
            continue
        if target.is_dir():
            freed += sum(f.stat().st_size for f in target.rglob("*") if f.is_file())
            shutil.rmtree(target, ignore_errors=True)
        else:
            freed += target.stat().st_size
            target.unlink(missing_ok=True)
    return freed


def main() -> int:
    _set_aside(DIST_DIR / "markitdown-sidecar", "dist-previous")
    _set_aside(BUILD_DIR, "build-previous")

    command = [
        sys.executable,
        "-m",
        "PyInstaller",
        "--noconfirm",
        "--clean",
        "--onedir",
        "--console",
        "--name",
        "markitdown-sidecar",
        "--distpath",
        str(DIST_DIR),
        "--workpath",
        str(BUILD_DIR),
        "--specpath",
        str(BUILD_DIR),
    ]

    for package in COLLECT_ALL_PACKAGES:
        command += ["--collect-all", package]
    for module in HIDDEN_IMPORTS:
        command += ["--hidden-import", module]
    for module in EXCLUDED_MODULES:
        command += ["--exclude-module", module]

    command.append(str(ROOT / "sidecar.py"))
    _run(command)

    executable = DIST_DIR / "markitdown-sidecar" / "markitdown-sidecar.exe"
    if not executable.is_file():
        print(f"构建失败：未找到 {executable}", file=sys.stderr)
        return 1

    freed = _trim(DIST_DIR / "markitdown-sidecar" / "_internal")
    size_mb = sum(f.stat().st_size for f in (DIST_DIR / "markitdown-sidecar").rglob("*") if f.is_file()) / 1024 / 1024
    print(f"\n构建完成：{executable}")
    print(f"目录体积：{size_mb:.1f} MB（已裁剪 {freed / 1024 / 1024:.1f} MB 无用数据）")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
