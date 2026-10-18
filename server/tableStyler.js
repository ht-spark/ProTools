/**
 * 修改 docx 中的表格样式。
 *
 * adm-zip 通过参数注入而非模块顶层 require：打包后本文件位于 resources/server，
 * 该目录不带 node_modules，顶层 require 会导致整个模块加载失败、样式被静默跳过。
 *
 * @param {string} docxPath - docx 文件路径
 * @param {string} style - 'three-line' | 'bordered'
 * @param {Function} [ZipCtor] - adm-zip 构造器，缺省时回退到本目录依赖
 */
function applyTableStyle(docxPath, style, ZipCtor) {
    const Zip = ZipCtor || require('adm-zip');
    const zip = new Zip(docxPath);
    let docXml = zip.readAsText('word/document.xml');

    const targetStyle = style === 'bordered' ? 'BorderedTable' : 'ThreeLineTable';

    docXml = docXml.replace(/<w:tblStyle\s+w:val="Table"\s*\/>/g, '<w:tblStyle w:val="' + targetStyle + '"/>');

    // Also inject inline center alignment for each table as a backup
    docXml = docXml.replace(/<w:tblPr>/g, '<w:tblPr><w:jc w:val="center"/>');

    zip.updateFile('word/document.xml', Buffer.from(docXml, 'utf8'));
    zip.writeZip(docxPath);
}

module.exports = { applyTableStyle };
