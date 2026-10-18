"""ProTools 的 MarkItDown 侧车进程。

Electron 主进程通过 stdin/stdout 与本进程通信，一行一个 JSON 请求，一行一个 JSON 响应。
之所以不使用 HTTP：桌面场景只需要单用户串行转换，省去端口占用、防火墙弹窗与鉴权问题。

协议（protocol = 1）：
    启动   -> {"type": "ready", "protocol": 1, "version": "0.1.8", "formats": [...]}
    请求   <- {"id": "1", "op": "convert", "path": "D:/a.pdf", "assets_dir": "...", "asset_ref": "assets"}
    响应   -> {"type": "result", "id": "1", "markdown": "...", "title": "...", "chars": 123, "images": 2, "elapsed_ms": 450}
    错误   -> {"type": "error", "id": "1", "code": "convert_failed", "message": "..."}

约定：
- 所有诊断信息写 stderr，stdout 只承载协议帧，避免污染调用方解析。
- 转换一律使用 ``convert_local``，不开放 URL / data URI 入口，避免被当作 SSRF 跳板。
- 文档内嵌的 base64 图片会落盘到 ``assets_dir``，Markdown 中改写为相对引用。
"""
from __future__ import annotations

import base64
import json
import re
import sys
import time
import traceback
from pathlib import Path
from typing import Any

PROTOCOL_VERSION = 1

# 受支持的扩展名，用于前端展示与调用前校验；与内置转换器保持一致
SUPPORTED_EXTENSIONS = (
    ".pdf", ".docx", ".pptx", ".xlsx", ".xls", ".html", ".htm", ".epub",
    ".ipynb", ".csv", ".txt", ".md", ".markdown", ".json", ".xml", ".zip",
    ".msg", ".mp3", ".wav", ".m4a", ".jpg", ".jpeg", ".png", ".gif",
    ".webp", ".bmp", ".tiff", ".rss", ".atom",
)

# Markdown 图片语法里的 base64 数据：![alt](data:image/png;base64,.... "可选标题")
_DATA_URI_PATTERN = re.compile(
    r"\]\(data:image/(?P<subtype>[A-Za-z0-9.+-]+);base64,(?P<payload>[A-Za-z0-9+/=]+)"
    r"(?P<suffix>\s+\"[^\"]*\")?\)",
    re.IGNORECASE,
)

_SUBTYPE_TO_EXT = {
    "jpeg": "jpg",
    "svg+xml": "svg",
    "x-icon": "ico",
    "vnd.microsoft.icon": "ico",
    "tiff": "tiff",
}


def _configure_stdio() -> None:
    """强制 UTF-8，避免 Windows 默认 GBK 代码页把中文标题写坏。"""
    for stream in (sys.stdin, sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")
        except (AttributeError, ValueError):
            pass


def _emit(payload: dict[str, Any]) -> None:
    """输出一帧协议数据并立即刷新，保证调用方可以流式读取。"""
    sys.stdout.write(json.dumps(payload, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def _log(message: str) -> None:
    sys.stderr.write(message.rstrip() + "\n")
    sys.stderr.flush()


def _extract_embedded_images(markdown: str, assets_dir: Path, asset_ref: str) -> tuple[str, int]:
    """把 base64 内嵌图片写成文件，并把 Markdown 中的引用改为相对路径。

    Args:
        markdown: 原始转换结果。
        assets_dir: 图片落盘目录，不存在时自动创建。
        asset_ref: 写入 Markdown 的相对前缀，如 ``assets``。

    Returns:
        ``(改写后的 markdown, 落盘图片数量)``。
    """
    matches = list(_DATA_URI_PATTERN.finditer(markdown))
    if not matches:
        return markdown, 0

    assets_dir.mkdir(parents=True, exist_ok=True)
    chunks: list[str] = []
    cursor = 0
    saved = 0

    for index, match in enumerate(matches, start=1):
        subtype = match.group("subtype").lower()
        extension = _SUBTYPE_TO_EXT.get(subtype, subtype)
        filename = f"image_{index:03d}.{extension}"
        try:
            payload = base64.b64decode(re.sub(r"\s+", "", match.group("payload")), validate=False)
        except Exception as error:  # 损坏的 data URI 不应中断整篇转换
            _log(f"[warn] 跳过无法解码的内嵌图片 #{index}: {error}")
            continue

        (assets_dir / filename).write_bytes(payload)
        chunks.append(markdown[cursor:match.start()])
        chunks.append(f"]({asset_ref}/{filename}{match.group('suffix') or ''})")
        cursor = match.end()
        saved += 1

    chunks.append(markdown[cursor:])
    return "".join(chunks), saved


def _handle_convert(request: dict[str, Any], converter: Any) -> dict[str, Any]:
    """执行一次文件到 Markdown 的转换。"""
    raw_path = request.get("path")
    if not isinstance(raw_path, str) or not raw_path.strip():
        raise ValueError("path 不能为空")

    source = Path(raw_path).expanduser()
    if not source.is_file():
        raise FileNotFoundError(f"文件不存在：{source}")

    assets_dir = request.get("assets_dir")
    asset_ref = request.get("asset_ref") or "assets"
    wants_assets = isinstance(assets_dir, str) and bool(assets_dir.strip())

    # 只有需要落盘图片时才保留完整 data URI：默认行为会把 base64 截断成 "data:image/png;base64..."
    convert_kwargs: dict[str, Any] = {}
    if wants_assets:
        convert_kwargs["keep_data_uris"] = True

    started = time.perf_counter()
    result = converter.convert_local(str(source), **convert_kwargs)
    markdown = result.markdown or ""

    images = 0
    if wants_assets:
        markdown, images = _extract_embedded_images(markdown, Path(assets_dir), asset_ref)

    elapsed_ms = int((time.perf_counter() - started) * 1000)
    return {
        "markdown": markdown,
        "title": (result.title or "").strip() or source.stem,
        "chars": len(markdown),
        "images": images,
        "elapsed_ms": elapsed_ms,
        "source": str(source),
    }


def main() -> int:
    _configure_stdio()

    try:
        from markitdown import MarkItDown
        from markitdown.__about__ import __version__ as markitdown_version
    except Exception as error:  # 依赖缺失时给出可读错误而不是栈
        _emit({
            "type": "error",
            "code": "import_failed",
            "message": f"MarkItDown 加载失败：{error}",
        })
        _log(traceback.format_exc())
        return 1

    converter = MarkItDown(enable_plugins=False)
    _log(f"[info] markitdown {markitdown_version} 已就绪")
    _emit({
        "type": "ready",
        "protocol": PROTOCOL_VERSION,
        "version": markitdown_version,
        "formats": list(SUPPORTED_EXTENSIONS),
    })

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue

        try:
            request = json.loads(line)
        except json.JSONDecodeError as error:
            _emit({"type": "error", "code": "bad_request", "message": f"JSON 解析失败：{error}"})
            continue

        request_id = request.get("id")
        op = request.get("op")

        try:
            if op == "ping":
                _emit({"type": "pong", "id": request_id, "version": markitdown_version})
            elif op == "convert":
                payload = _handle_convert(request, converter)
                _emit({"type": "result", "id": request_id, **payload})
            else:
                _emit({
                    "type": "error",
                    "id": request_id,
                    "code": "unsupported_op",
                    "message": f"不支持的操作：{op}",
                })
        except FileNotFoundError as error:
            _emit({"type": "error", "id": request_id, "code": "not_found", "message": str(error)})
        except PermissionError as error:
            _emit({"type": "error", "id": request_id, "code": "permission_denied", "message": str(error)})
        except Exception as error:
            _emit({
                "type": "error",
                "id": request_id,
                "code": "convert_failed",
                "message": str(error) or error.__class__.__name__,
            })
            _log(traceback.format_exc())

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
