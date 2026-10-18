/**
 * 修改 docx 文件中 styles.xml 的字体设置
 * @param {string} docxPath - docx 文件路径
 * @param {Object} fontSettings - 字体设置
 * @param {Function} [ZipCtor] - adm-zip 构造器；打包后本目录无 node_modules，由调用方注入
 * @param {string} [fontSettings.fontFamily] - 中文字体（如 "宋体"）
 * @param {string} [fontSettings.fontFamilyEn] - 英文字体（如 "Times New Roman"）
 * @param {number} [fontSettings.bodySize] - 正文字号（磅）
 * @param {number} [fontSettings.h1Size] - 一级标题字号
 * @param {number} [fontSettings.h2Size] - 二级标题字号
 * @param {number} [fontSettings.h3Size] - 三级标题字号
 * @param {number} [fontSettings.h4Size] - 四级标题字号
 * @param {number} [fontSettings.h5Size] - 五级标题字号
 * @param {number} [fontSettings.h6Size] - 六级标题字号
 */
function applyFontStyle(docxPath, fontSettings, ZipCtor) {
    if (!fontSettings) return;

    const cnFont = fontSettings.fontFamily && fontSettings.fontFamily.trim();
    const enFont = fontSettings.fontFamilyEn && fontSettings.fontFamilyEn.trim();
    const hasFont = cnFont || enFont;
    const hasBodySize = fontSettings.bodySize && fontSettings.bodySize > 0;
    const headingSizes = {
        'Heading1': fontSettings.h1Size,
        'Heading2': fontSettings.h2Size,
        'Heading3': fontSettings.h3Size,
        'Heading4': fontSettings.h4Size,
        'Heading5': fontSettings.h5Size,
        'Heading6': fontSettings.h6Size,
    };

    const hasHeadingSizes = Object.values(headingSizes).some(s => s && s > 0);

    if (!hasFont && !hasBodySize && !hasHeadingSizes) return;

    const zip = new (ZipCtor || require('adm-zip'))(docxPath);
    let stylesXml = zip.readAsText('word/styles.xml');
    if (!stylesXml) return;

    // ===== 1. 修改默认字体和字号 (docDefaults) =====
    if (hasFont || hasBodySize) {
        stylesXml = stylesXml.replace(
            /(<w:docDefaults>[\s\S]*?<w:rPr(?:\s[^>]*)?>)([\s\S]*?)(<\/w:rPr>)/,
            (match, before, content, after) => {
                let newContent = content;

                if (hasFont) {
                    const rFonts = buildRFontsTag(cnFont, enFont);
                    if (/<w:rFonts[^>]*\/>/.test(newContent)) {
                        newContent = newContent.replace(/<w:rFonts[^>]*\/>/, rFonts);
                    } else {
                        newContent = rFonts + newContent;
                    }
                }

                if (hasBodySize) {
                    const szVal = String(fontSettings.bodySize * 2);
                    newContent = replaceOrAddSize(newContent, szVal);
                }

                return before + newContent + after;
            }
        );
    }

    // ===== 2. 修改 Normal 样式的字体和字号 =====
    if (hasFont || hasBodySize) {
        stylesXml = modifyStyle(stylesXml, 'Normal', (content) => {
            let newContent = content;
            if (hasFont) {
                newContent = replaceOrAddRFonts(newContent, cnFont, enFont);
            }
            if (hasBodySize) {
                const szVal = String(fontSettings.bodySize * 2);
                newContent = replaceOrAddSize(newContent, szVal);
            }
            return newContent;
        });
    }

    // ===== 3. 修改各标题样式的字号和字体 =====
    for (const [styleId, size] of Object.entries(headingSizes)) {
        if (size && size > 0) {
            stylesXml = modifyStyle(stylesXml, styleId, (content) => {
                let newContent = content;
                if (hasFont) {
                    newContent = replaceOrAddRFonts(newContent, cnFont, enFont);
                }
                const szVal = String(size * 2);
                newContent = replaceOrAddSize(newContent, szVal);
                return newContent;
            });
        }
    }

    // ===== 4. 如果设置了字体，修改所有已有 rFonts 引用 =====
    if (hasFont) {
        const rFonts = buildRFontsTag(cnFont, enFont);
        stylesXml = stylesXml.replace(
            /<w:rFonts\s+w:ascii="[^"]*"\s+w:hAnsi="[^"]*"\s+w:eastAsia="[^"]*"\s*(?:w:cs="[^"]*"\s*)?\/>/g,
            rFonts
        );
    }

    zip.updateFile('word/styles.xml', Buffer.from(stylesXml, 'utf8'));
    zip.writeZip(docxPath);
}

/**
 * 构建 rFonts 标签，区分中英文字体
 * w:ascii / w:hAnsi / w:cs → 英文字体
 * w:eastAsia → 中文字体
 */
function buildRFontsTag(cnFont, enFont) {
    const en = enFont || cnFont || 'Times New Roman';
    const cn = cnFont || enFont || '宋体';
    return `<w:rFonts w:ascii="${en}" w:hAnsi="${en}" w:eastAsia="${cn}" w:cs="${en}"/>`;
}

/**
 * 修改指定 styleId 的样式内容
 */
function modifyStyle(stylesXml, styleId, modifier) {
    const regex = new RegExp(
        `(<w:style[^>]*w:styleId="${styleId}"[^>]*>)([\\s\\S]*?)(</w:style>)`
    );

    return stylesXml.replace(regex, (match, openTag, content, closeTag) => {
        if (/<w:rPr(?:\s[^>]*)?>[\s\S]*?<\/w:rPr>/.test(content)) {
            content = content.replace(
                /(<w:rPr(?:\s[^>]*)?>)([\s\S]*?)(<\/w:rPr>)/,
                (m, before, rprContent, after) => before + modifier(rprContent) + after
            );
        } else {
            const rprContent = modifier('');
            if (/<w:pPr[\s\S]*?<\/w:pPr>/.test(content)) {
                content = content.replace(
                    /(<\/w:pPr>)/,
                    `$1<w:rPr>${rprContent}</w:rPr>`
                );
            } else {
                content = `<w:rPr>${rprContent}</w:rPr>` + content;
            }
        }
        return openTag + content + closeTag;
    });
}

/**
 * 替换或添加 rFonts（区分中英文）
 */
function replaceOrAddRFonts(content, cnFont, enFont) {
    const rFonts = buildRFontsTag(cnFont, enFont);
    if (/<w:rFonts[^>]*\/>/.test(content)) {
        return content.replace(/<w:rFonts[^>]*\/>/, rFonts);
    }
    return rFonts + content;
}

/**
 * 替换或添加 sz 和 szCs
 */
function replaceOrAddSize(content, szVal) {
    let result = content;
    if (/<w:sz[^>]*\/>/.test(result)) {
        result = result.replace(/<w:sz[^>]*\/>/, `<w:sz w:val="${szVal}"/>`);
    } else {
        result += `<w:sz w:val="${szVal}"/>`;
    }
    if (/<w:szCs[^>]*\/>/.test(result)) {
        result = result.replace(/<w:szCs[^>]*\/>/, `<w:szCs w:val="${szVal}"/>`);
    } else {
        result += `<w:szCs w:val="${szVal}"/>`;
    }
    return result;
}

module.exports = { applyFontStyle };
