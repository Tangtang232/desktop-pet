// 只把宠物需要的几个接口暴露给页面，页面本身拿不到 Node。
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('petApi', {
  setInteractive: on => ipcRenderer.send('pet:interactive', !!on),
  setExpanded: on => ipcRenderer.send('pet:expand', !!on),
  setBox: box => ipcRenderer.send('pet:box', box),
  showMenu: () => ipcRenderer.send('pet:menu'),
  showNoteMenu: () => ipcRenderer.send('pet:noteMenu'),
  setUnread: n => ipcRenderer.send('pet:unread', Number(n) || 0),
  raise: on => ipcRenderer.send('pet:raise', !!on),
  notify: text => ipcRenderer.send('pet:notify', String(text)),
  load: () => ipcRenderer.invoke('pet:load'),
  save: state => ipcRenderer.send('pet:save', state),
  heartbeat: () => ipcRenderer.send('pet:heartbeat'),
  diag: entry => ipcRenderer.send('pet:diag', entry),
  setTooltip: text => ipcRenderer.send('pet:tooltip', String(text)),
  onCommand: cb => ipcRenderer.on('pet:command', (_e, cmd) => cb(cmd)),
  // 合养：狗走出屏幕了（带上它的肚子、心情）、走进来了、看完了别人寄来的纸条、你和它的互动（算心动值）
  togetherDeparted: state => ipcRenderer.send('together:departed', state),
  togetherArrived: () => ipcRenderer.send('together:arrived'),
  togetherNoteRead: id => ipcRenderer.send('together:noteRead', String(id)),
  togetherEvent: kind => ipcRenderer.send('together:event', String(kind)),
  // 被呼唤时留不留它、远程看它时传的小图、点碗叫它回来、打开"看看它"
  togetherKeep: keep => ipcRenderer.send('together:keep', !!keep),
  togetherSnapshot: (img, act) => ipcRenderer.send('together:snapshot', String(img), String(act || '')),
  togetherCall: () => ipcRenderer.invoke('together:call'),
  openWatch: () => ipcRenderer.send('together:openWatch'),
  // 多块屏幕：狗要去旁边那块屏幕（-1 左边，1 右边），主进程把窗口挪过去
  crossScreen: dir => ipcRenderer.invoke('pet:cross', dir < 0 ? -1 : 1),
  // 养成：日记里记一句（发现了它是什么样的狗、胖了、来了整一周……）
  diary: text => ipcRenderer.send('pet:diary', String(text)),
  smokeShot: (name, dataUrl) => ipcRenderer.invoke('smoke:shot', name, dataUrl),
  smokeDone: result => ipcRenderer.send('smoke:done', result)
});
