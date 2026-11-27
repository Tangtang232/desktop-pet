// "看看它"窗口：狗在别人那儿时，远程看它（几秒一张的小图）、喂一碗、叫它回来。
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('watchApi', {
  onFrame: cb => ipcRenderer.on('watch:frame', (_e, f) => cb(f)),
  feed: () => ipcRenderer.invoke('together:feed'),
  call: () => ipcRenderer.invoke('together:call'),
  close: () => ipcRenderer.send('watch:close'),
  // 开着太久没理它会暂停传图；点一下接着看
  resume: () => ipcRenderer.send('watch:resume')
});
