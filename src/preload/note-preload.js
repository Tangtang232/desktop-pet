// 写纸条窗口：送出、取消，以及"寄给谁、它会怎么送"（合养时）。
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('noteApi', {
  info: () => ipcRenderer.invoke('note:info'),
  send: text => ipcRenderer.invoke('note:send', String(text)),
  cancel: () => ipcRenderer.send('note:cancel')
});
