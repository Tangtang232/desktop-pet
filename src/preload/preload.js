// 只把宠物需要的几个接口暴露给页面，页面本身拿不到 Node。
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('petApi', {
  setInteractive: on => ipcRenderer.send('pet:interactive', !!on),
  setExpanded: on => ipcRenderer.send('pet:expand', !!on),
  setBox: box => ipcRenderer.send('pet:box', box),
  showMenu: () => ipcRenderer.send('pet:menu'),
  load: () => ipcRenderer.invoke('pet:load'),
  save: state => ipcRenderer.send('pet:save', state),
  heartbeat: () => ipcRenderer.send('pet:heartbeat'),
  setTooltip: text => ipcRenderer.send('pet:tooltip', String(text)),
  onCommand: cb => ipcRenderer.on('pet:command', (_e, cmd) => cb(cmd)),
  smokeShot: (name, dataUrl) => ipcRenderer.invoke('smoke:shot', name, dataUrl),
  smokeDone: result => ipcRenderer.send('smoke:done', result)
});
