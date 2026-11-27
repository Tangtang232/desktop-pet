// "它的日记"窗口：只读本机记下的日记。
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('diaryApi', {
  list: () => ipcRenderer.invoke('diary:list'),
  onList: cb => ipcRenderer.on('diary:list', (_e, l) => cb(l)),
  close: () => ipcRenderer.send('diary:close')
});
