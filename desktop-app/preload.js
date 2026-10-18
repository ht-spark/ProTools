/**
 * ProTools Desktop - 预加载脚本
 * 通过 contextBridge 安全暴露 API 给渲染进程
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('superplugin', {
    // 直接转换 + 保存（带历史记录）
    convert: {
        save: (options) => ipcRenderer.invoke('convert:saveWithHistory', options),
    },
    // 文件操作
    file: {
        openMarkdown: () => ipcRenderer.invoke('file:openMarkdown'),
        exists: (filePath) => ipcRenderer.invoke('file:exists', filePath),
    },
    // 历史记录
    history: {
        load: () => ipcRenderer.invoke('history:load'),
        delete: (id) => ipcRenderer.invoke('history:delete', id),
        clear: () => ipcRenderer.invoke('history:clear'),
        updateNote: (id, note) => ipcRenderer.invoke('history:updateNote', id, note),
    },
    // Pandoc 检测
    pandoc: {
        check: () => ipcRenderer.invoke('pandoc:check'),
    },
    // Shell 操作
    shell: {
        openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url),
        showItemInFolder: (p) => ipcRenderer.invoke('shell:showItemInFolder', p),
        openPath: (p) => ipcRenderer.invoke('shell:openPath', p),
    },
    // 应用设置
    app: {
        setAutoLaunch: (enabled) => ipcRenderer.invoke('app:setAutoLaunch', enabled),
        getAutoLaunch: () => ipcRenderer.invoke('app:getAutoLaunch'),
        getInfo: () => ipcRenderer.invoke('app:getInfo'),
        getDependencies: () => ipcRenderer.invoke('app:getDependencies'),
    },
    // 字体设置
    font: {
        getSettings: () => ipcRenderer.invoke('font:getSettings'),
        saveSettings: (settings) => ipcRenderer.invoke('font:saveSettings', settings),
        resetSettings: () => ipcRenderer.invoke('font:resetSettings'),
    },
    // 窗口控制
    window: {
        minimizeToTray: () => ipcRenderer.invoke('window:minimizeToTray'),
    },
    // 文档导入（MarkItDown）
    markitdown: {
        status: () => ipcRenderer.invoke('markitdown:status'),
        warm: () => ipcRenderer.invoke('markitdown:warm'),
        pickFiles: () => ipcRenderer.invoke('markitdown:pickFiles'),
        convert: (filePath) => ipcRenderer.invoke('markitdown:convert', filePath),
        save: (payload) => ipcRenderer.invoke('markitdown:save', payload),
    },
});
