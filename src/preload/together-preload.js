// 合养窗口：建一只新的、输宠物码加入、同意新人、呼唤它回来。
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('togetherApi', {
  view: () => ipcRenderer.invoke('together:view'),
  onView: cb => ipcRenderer.on('together:view', (_e, v) => cb(v)),
  create: () => ipcRenderer.invoke('together:create', ''),
  join: code => ipcRenderer.invoke('together:join', String(code), ''),
  // 输了邀请码先看看组里有谁；换了电脑的认自己；确认别人的新电脑
  peek: code => ipcRenderer.invoke('together:peek', String(code)),
  claim: (code, member) => ipcRenderer.invoke('together:claim', String(code), String(member)),
  approveDevice: (user, member, ok) => ipcRenderer.invoke('together:approveDevice', String(user), String(member), !!ok),
  // 换邀请码、退出、请人离开、远程看它
  rotate: () => ipcRenderer.invoke('together:rotate'),
  leave: () => ipcRenderer.invoke('together:leave'),
  kick: (target, ok) => ipcRenderer.invoke('together:kick', String(target), !!ok),
  watch: () => ipcRenderer.send('together:openWatch'),
  approve: (id, ok) => ipcRenderer.invoke('together:approve', String(id), !!ok),
  rename: nickname => ipcRenderer.invoke('together:rename', String(nickname)),
  call: () => ipcRenderer.invoke('together:call'),
  copy: text => ipcRenderer.send('together:copy', String(text)),
  close: () => ipcRenderer.send('together:close')
});
