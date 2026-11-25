// 写纸条窗口只需要"送出"和"取消"两个接口。
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('noteApi', {
  send: text => ipcRenderer.send('note:send', String(text)),
  cancel: () => ipcRenderer.send('note:cancel')
});
