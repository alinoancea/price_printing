import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('api', {
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setApiBaseUrl: (url: string) => ipcRenderer.invoke('settings:setApiBaseUrl', url),
  getSettingsDebug: () => ipcRenderer.invoke('settings:debug'),
  testConnection: () => ipcRenderer.invoke('api:testConnection'),
  syncNow: () => ipcRenderer.invoke('sync:now'),
  getUpdatesInfo: () => ipcRenderer.invoke('updates:getInfo'),
  checkForUpdates: () => ipcRenderer.invoke('updates:checkNow'),
  downloadUpdates: () => ipcRenderer.invoke('updates:downloadNow'),
  listBarcodes: () => ipcRenderer.invoke('db:listBarcodes'),
  getLastSync: () => ipcRenderer.invoke('db:getLastSync'),
  resizeToContent: () => ipcRenderer.invoke('ui:resizeToContent'),
  deleteBarcodes: (barcodes: string[]) => ipcRenderer.invoke('db:deleteBarcodes', barcodes),
  updateBarcodes: (updates: Array<{ barcode: string; name: string; price: number }>) =>
    ipcRenderer.invoke('db:updateBarcodes', updates),
  listPrinters: () => ipcRenderer.invoke('printers:list'),
  setDefaultPrinter: (name: string) => ipcRenderer.invoke('printers:setDefault', name),
  setZebraConnection: (ip: string, port: number) => ipcRenderer.invoke('printers:setZebraConnection', ip, port),
  printZpl: (printerName: string, zpl: string) => ipcRenderer.invoke('printers:printZpl', printerName, zpl),
  onOpenSettings: (cb: () => void) => {
    const handler = () => cb()
    ipcRenderer.on('nav:settings', handler)
    return () => ipcRenderer.off('nav:settings', handler)
  },
  onUpdatesDownloadState: (cb: (downloading: boolean) => void) => {
    const handler = (_: unknown, downloading: boolean) => cb(downloading)
    ipcRenderer.on('updates:downloadState', handler)
    return () => ipcRenderer.off('updates:downloadState', handler)
  }
})

