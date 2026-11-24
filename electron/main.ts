import { app, BrowserWindow, Menu, ipcMain, screen } from 'electron'
import path from 'node:path'
import net from 'node:net'
import { spawn } from 'node:child_process'
import Store from 'electron-store'
import { autoUpdater } from 'electron-updater'
import { ApiClient } from './api/client'
import { BarcodeRepository } from './db/repo'

type Settings = {
  apiBaseUrl: string
  printerName?: string
  zebraIp?: string
  zebraPort?: number
}

const DEBUG_RESIZE = false

const settings = new Store<Settings>({
  defaults: {
    apiBaseUrl: 'http://central/barcodes',
    zebraPort: 9100
  }
})

let mainWindow: BrowserWindow | null = null
let minContentSize: { w: number; h: number } | null = null

// Single instance: second launch brings existing window to foreground
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.show()
      mainWindow.focus()
    }
  })
}

function getAppIconPath() {
  // Keep one source logo (icon-source.png) for both dev window icon and packaged runtime icon.
  if (app.isPackaged) return path.join(process.resourcesPath, 'icon-source.png')
  return path.join(app.getAppPath(), 'build', 'icon-source.png')
}

function createAppMenu() {
  Menu.setApplicationMenu(null)
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1300,
    height: 820,
    resizable: true,
    icon: getAppIconPath(),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  if (process.env.VITE_DEV_SERVER_URL) {
    void mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL)
    mainWindow.webContents.openDevTools({ mode: 'detach' })
  } else {
    void mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
  }

  mainWindow.webContents.once('did-finish-load', () => {
    // Resize the content area to match the rendered UI height/width.
    // This prevents outer window scrolling.
    void mainWindow?.webContents
      .executeJavaScript(`
        (async () => {
          await new Promise(requestAnimationFrame);
          await new Promise(requestAnimationFrame);
          const root = document.getElementById('root');
          const w1 = (root && root.scrollWidth) || document.documentElement.scrollWidth || 0;
          const h1 = (root && root.scrollHeight) || document.documentElement.scrollHeight || 0;
          // Add a small buffer so fonts/layout don't get clipped.
          const bufferW = 18;
          const bufferH = 60;
          return { w: Math.ceil(w1 + bufferW), h: Math.ceil(h1 + bufferH) };
        })()
      `)
      .then((size) => {
        if (!size) return
        const { width: maxW, height: maxH } = screen.getPrimaryDisplay().workArea
        const marginW = 24
        const marginH = 24
        if (!mainWindow) return
        const [curW, curH] = mainWindow.getContentSize()
        const wClamped = Math.min(size.w, maxW - marginW)
        const hClamped = Math.min(size.h, maxH - marginH)
        // Stabilize sizing on reloads:
        // - only resize if delta is meaningful (tolerance)
        // - allow shrinking back to the initial measured size (stop inflation)
        const toleranceW = 4
        const toleranceH = 4
        const targetW = Math.abs(wClamped - curW) <= toleranceW ? curW : wClamped
        const targetH = Math.abs(hClamped - curH) <= toleranceH ? curH : hClamped
        const finalW = Math.ceil(targetW)
        const finalH = Math.ceil(targetH)

        // First measurement becomes the minimum safe size.
        if (!minContentSize) minContentSize = { w: finalW, h: finalH }

        const safeW = Math.max(finalW, minContentSize.w)
        const safeH = Math.max(finalH, minContentSize.h)
        if (DEBUG_RESIZE) {
          console.log('[resize:init]', { curW, curH, wClamped, hClamped, finalW: safeW, finalH: safeH })
        }
        if (safeW !== curW || safeH !== curH) mainWindow.setContentSize(safeW, safeH, false)
      })
      .catch(() => {})
  })
}

app.whenReady().then(() => {
  const repo = new BarcodeRepository()
  const api = new ApiClient(settings)

  const updateState: {
    latestVersion: string | null
    status: string
    isDownloading: boolean
  } = {
    latestVersion: null,
    status: 'Actualizari: neverificate',
    isDownloading: false
  }

  // Mesajul real al erorii (prima linie, scurt) in loc de un text generic.
  const updateErrorStatus = (e: unknown) => {
    console.error('[updates]', e)
    const msg = (e instanceof Error ? e.message : String(e)).split(/\r?\n/)[0]!.slice(0, 120)
    return `Eroare actualizare: ${msg}`
  }

  const sendDownloadState = (downloading: boolean) => {
    updateState.isDownloading = downloading
    mainWindow?.webContents.send('updates:downloadState', downloading)
  }

  // GitHub updates (public repo):
  // - Latest version should be available via GitHub Releases artifacts (`latest.yml` etc).
  // - When an update is found, it is downloaded automatically and installed on quit.
  // Note: if the release artifacts are not set up, check-for-updates will just report an error.
  autoUpdater.setFeedURL({
    provider: 'github',
    owner: 'alinoancea',
    repo: 'price_printing',
    channel: 'latest'
  } as any)
  // Allow update check in dev mode (for testing) - uses dev-app-update.yml
  autoUpdater.forceDevUpdateConfig = true
  // User-driven updates: check is fine automatically, but download/install must only happen on button press.
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = false

  autoUpdater.on('update-available', (info) => {
    updateState.latestVersion = info.version.toString()
    updateState.status = `Actualizare disponibila: ${updateState.latestVersion}`
  })
  autoUpdater.on('update-not-available', () => {
    updateState.latestVersion = null
    updateState.status = 'Aplicatia este la zi'
  })
  autoUpdater.on('download-progress', (p) => {
    // keep the status short since it's displayed in the settings panel
    const percent = typeof p.percent === 'number' ? p.percent : null
    updateState.status =
      percent === null
        ? 'Se descarca actualizarea...'
        : `Se descarca actualizarea... ${percent.toFixed(0)}%`
  })
  autoUpdater.on('update-downloaded', () => {
    updateState.status = 'Actualizare descarcata. Se instaleaza...'
    sendDownloadState(false)
    autoUpdater.quitAndInstall()
  })
  autoUpdater.on('error', (e) => {
    updateState.status = updateErrorStatus(e)
    sendDownloadState(false)
  })

  ipcMain.handle('ui:resizeToContent', async (evt) => {
    const sender = evt.sender
    const win = BrowserWindow.fromWebContents(sender)
    if (!win) return null

    // Lock window size after the initial did-finish-load measurement.
    // This prevents growth when switching views (e.g., Home -> Settings).
    if (minContentSize) {
      const [curW, curH] = win.getContentSize()
      return { w: curW, h: curH }
    }

    const size = await sender
      .executeJavaScript(`
        (async () => {
          await new Promise(requestAnimationFrame);
          await new Promise(requestAnimationFrame);
          const root = document.getElementById('root');
          if (!root) return null;
          const w = Math.ceil(root.scrollWidth || document.documentElement.scrollWidth || 0);
          const h = Math.ceil(root.scrollHeight || document.documentElement.scrollHeight || 0);
          const bufferW = 18;
          const bufferH = 60;
          return { w: w + bufferW, h: h + bufferH };
        })()
      `)
      .catch(() => null)

    if (size && typeof size.h === 'number') {
      const { width: maxW, height: maxH } = screen.getPrimaryDisplay().workArea
      const marginW = 24
      const marginH = 24
      const [curW, curH] = win.getContentSize()
      const wClamped = Math.min(size.w, maxW - marginW)
      const hClamped = Math.min(size.h, maxH - marginH)

      // Ensure we have a "safe minimum" before we allow shrinking.
      if (!minContentSize) minContentSize = { w: curW, h: curH }

      // Only resize when delta is meaningful.
      const toleranceW = 4
      const toleranceH = 4
      const targetW = Math.abs(wClamped - curW) <= toleranceW ? curW : wClamped
      const targetH = Math.abs(hClamped - curH) <= toleranceH ? curH : hClamped

      const finalW = Math.max(Math.ceil(targetW), minContentSize.w)
      const finalH = Math.max(Math.ceil(targetH), minContentSize.h)
      if (DEBUG_RESIZE) {
        console.log('[resize:ipc]', {
          curW,
          curH,
          wClamped,
          hClamped,
          targetW: targetW,
          targetH: targetH,
          finalW,
          finalH,
          minW: minContentSize.w,
          minH: minContentSize.h
        })
      }
      if (finalW !== curW || finalH !== curH) win.setContentSize(finalW, finalH, false)

      return { w: finalW, h: finalH }
    }

    return null
  })

  ipcMain.handle('settings:get', () => ({
    apiBaseUrl: ((settings as any).get('apiBaseUrl') as string | undefined) || 'http://central/barcodes',
    printerName: ((settings as any).get('printerName') as string | undefined) || '',
    zebraIp: ((settings as any).get('zebraIp') as string | undefined) || '',
    zebraPort: ((settings as any).get('zebraPort') as number | undefined) || 9100
  }))
  ipcMain.handle('settings:setApiBaseUrl', (_evt, url: string) => {
    console.log('[settings:setApiBaseUrl]', url)
    ;(settings as any).set('apiBaseUrl', url)
    console.log('[settings:setApiBaseUrl] stored=', (settings as any).get('apiBaseUrl'))
    return { apiBaseUrl: ((settings as any).get('apiBaseUrl') as string | undefined) || 'http://central/barcodes' }
  })
  ipcMain.handle('settings:debug', () => ({
    apiBaseUrl: ((settings as any).get('apiBaseUrl') as string | undefined) || 'http://central/barcodes',
    storePath: (settings as any).path,
    printerName: ((settings as any).get('printerName') as string | undefined) || '',
    zebraIp: ((settings as any).get('zebraIp') as string | undefined) || '',
    zebraPort: ((settings as any).get('zebraPort') as number | undefined) || 9100
  }))

  ipcMain.handle('updates:getInfo', () => ({
    currentVersion: app.getVersion(),
    latestVersion: updateState.latestVersion,
    status: updateState.status,
    isDownloading: updateState.isDownloading
  }))

  ipcMain.handle('updates:checkNow', async () => {
    // Skip if updater is disabled (not packaged and forceDevUpdateConfig is false)
    if (!autoUpdater.isUpdaterActive()) {
      updateState.latestVersion = null
      updateState.status = 'Actualizarile nu sunt disponibile.'
      return {
        currentVersion: app.getVersion(),
        latestVersion: updateState.latestVersion,
        updateAvailable: false,
        status: updateState.status
      }
    }

    updateState.latestVersion = null
    updateState.status = 'Verificare actualizari...'

    try {
      const res = await autoUpdater.checkForUpdates()
      const latest = res?.isUpdateAvailable ? res.updateInfo.version.toString() : null
      if (latest) {
        updateState.latestVersion = latest
        updateState.status = `Actualizare disponibila: ${latest}`
      } else {
        updateState.status = 'Aplicatia este la zi'
      }

      return {
        currentVersion: app.getVersion(),
        latestVersion: updateState.latestVersion,
        updateAvailable: !!latest,
        status: updateState.status
      }
    } catch (e) {
      updateState.status = updateErrorStatus(e)
      return {
        currentVersion: app.getVersion(),
        latestVersion: updateState.latestVersion,
        updateAvailable: false,
        status: updateState.status
      }
    }
  })

  ipcMain.handle('updates:downloadNow', async () => {
    if (!autoUpdater.isUpdaterActive()) {
      updateState.latestVersion = null
      updateState.status = 'Actualizarile nu sunt disponibile.'
      return {
        currentVersion: app.getVersion(),
        latestVersion: updateState.latestVersion,
        updateAvailable: false,
        status: updateState.status
      }
    }

    try {
      updateState.latestVersion = null
      updateState.status = 'Verificare pentru descarcare...'

      const res = await autoUpdater.checkForUpdates()
      const latest = res?.isUpdateAvailable ? res.updateInfo.version.toString() : null
      if (!latest) {
        updateState.latestVersion = null
        updateState.status = 'Aplicatia este la zi'
        return {
          currentVersion: app.getVersion(),
          latestVersion: null,
          updateAvailable: false,
          status: updateState.status
        }
      }

      updateState.latestVersion = latest
      updateState.status = `Se descarca actualizarea: ${latest}...`
      sendDownloadState(true)

      void autoUpdater.downloadUpdate().catch((e) => {
        updateState.status = updateErrorStatus(e)
        sendDownloadState(false)
      })

      return {
        currentVersion: app.getVersion(),
        latestVersion: updateState.latestVersion,
        updateAvailable: true,
        status: updateState.status
      }
    } catch (e) {
      updateState.status = updateErrorStatus(e)
      return {
        currentVersion: app.getVersion(),
        latestVersion: updateState.latestVersion,
        updateAvailable: false,
        status: updateState.status
      }
    }
  })

  ipcMain.handle('printers:list', async () => {
    const win = BrowserWindow.getAllWindows()[0]
    if (!win) return []
    try {
      const wc: any = win.webContents as any
      if (typeof wc.getPrintersAsync === 'function') {
        return await wc.getPrintersAsync()
      }
      if (typeof wc.getPrinters === 'function') {
        return wc.getPrinters()
      }
      return []
    } catch {
      return []
    }
  })

  ipcMain.handle('printers:setDefault', (_evt, name: string) => {
    ;(settings as any).set('printerName', name)
    return { printerName: ((settings as any).get('printerName') as string | undefined) || '' }
  })

  ipcMain.handle('printers:setZebraConnection', (_evt, ip: string, port: number) => {
    ;(settings as any).set('zebraIp', ip)
    ;(settings as any).set('zebraPort', port)
    return { zebraIp: ip, zebraPort: port }
  })

  ipcMain.handle('printers:printZpl', async (_evt, printerName: string, zpl: string) => {
    const printerNameFromStore = ((settings as any).get('printerName') as string | undefined) || ''
    const resolvedPrinterName = printerName || printerNameFromStore
    const ip = ((settings as any).get('zebraIp') as string | undefined) || ''
    const port = ((settings as any).get('zebraPort') as number | undefined) || 9100

    const payload = zpl.endsWith('\n') ? zpl : `${zpl}\n`

    // USB printers: use Windows spooler "RAW" to send ZPL bytes to the selected printer.
    // This avoids needing native Node printer bindings.
    if (resolvedPrinterName) {
      const dataB64 = Buffer.from(payload, 'ascii').toString('base64')
      const printerNameCandidates = Array.from(
        new Set([
          resolvedPrinterName,
          resolvedPrinterName.replace(/\s*\/\s*/g, '/'),
          resolvedPrinterName.replace(/\s+/g, ' ').trim()
        ])
      ).filter(Boolean)

      const script = `
param()
$ErrorActionPreference = 'Stop'

$printerName = $env:PRINTER_NAME
$dataB64 = $env:ZPL_B64
$bytes = [System.Convert]::FromBase64String($dataB64)

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

public class WinSpool {
  [DllImport("winspool.drv", SetLastError=true, CharSet=CharSet.Unicode)]
  public static extern bool OpenPrinter(string pPrinterName, out IntPtr phPrinter, IntPtr pDefault);

  [DllImport("winspool.drv", SetLastError=true)]
  public static extern bool ClosePrinter(IntPtr hPrinter);

  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
  public struct DOC_INFO_1 {
    public string pDocName;
    public string pOutputFile;
    public string pDataType;
  }

  [DllImport("winspool.drv", SetLastError=true, CharSet=CharSet.Unicode)]
  public static extern IntPtr StartDocPrinter(IntPtr hPrinter, int level, DOC_INFO_1 di);

  [DllImport("winspool.drv", SetLastError=true)]
  public static extern bool EndDocPrinter(IntPtr hPrinter);

  [DllImport("winspool.drv", SetLastError=true)]
  public static extern bool StartPagePrinter(IntPtr hPrinter);

  [DllImport("winspool.drv", SetLastError=true)]
  public static extern bool EndPagePrinter(IntPtr hPrinter);

  [DllImport("winspool.drv", SetLastError=true)]
  public static extern bool WritePrinter(IntPtr hPrinter, IntPtr pBuf, int dwCount, out int dwWritten);
}
'@

$hPrinter = [IntPtr]::Zero
$opened = [WinSpool]::OpenPrinter($printerName, [ref]$hPrinter, [IntPtr]::Zero)
if(-not $opened) {
  $lastErr = [Runtime.InteropServices.Marshal]::GetLastWin32Error()
  throw "OpenPrinter failed for printer '$printerName'. Win32Error=$lastErr"
}

$doc = New-Object WinSpool+DOC_INFO_1
$doc.pDocName = "ZPL"
$doc.pOutputFile = $null
$doc.pDataType = "RAW"

$jobId = [WinSpool]::StartDocPrinter($hPrinter, 1, $doc)
if($jobId -eq [IntPtr]::Zero) { [WinSpool]::ClosePrinter($hPrinter) | Out-Null; throw "StartDocPrinter failed." }

$startedPage = [WinSpool]::StartPagePrinter($hPrinter)
if(-not $startedPage) { [WinSpool]::EndDocPrinter($hPrinter) | Out-Null; [WinSpool]::ClosePrinter($hPrinter) | Out-Null; throw "StartPagePrinter failed." }

$ptr = [System.Runtime.InteropServices.Marshal]::AllocHGlobal($bytes.Length)
try {
  [System.Runtime.InteropServices.Marshal]::Copy($bytes, 0, $ptr, $bytes.Length)
  $written = 0
  $ok = [WinSpool]::WritePrinter($hPrinter, $ptr, $bytes.Length, [ref]$written)
  if(-not $ok) { throw "WritePrinter failed. $written bytes written." }
} finally {
  if($ptr -ne [IntPtr]::Zero) { [System.Runtime.InteropServices.Marshal]::FreeHGlobal($ptr) }
  [WinSpool]::EndPagePrinter($hPrinter) | Out-Null
  [WinSpool]::EndDocPrinter($hPrinter) | Out-Null
  [WinSpool]::ClosePrinter($hPrinter) | Out-Null
}
`

      let lastErr: unknown = null
      for (const candidate of printerNameCandidates) {
        try {
          // eslint-disable-next-line no-await-in-loop
          return await new Promise<{ ok: boolean }>((resolve, reject) => {
            const child = spawn(
              'powershell',
              ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script],
              {
                env: { ...process.env, PRINTER_NAME: candidate, ZPL_B64: dataB64 }
              }
            )

            let stdout = ''
            let stderr = ''
            child.stdout?.on('data', (d) => (stdout += String(d)))
            child.stderr?.on('data', (d) => (stderr += String(d)))
            child.on('error', (e) => reject(e))
            child.on('close', (code) => {
              if (code === 0) resolve({ ok: true })
              else reject(new Error(`PowerShell raw print failed (code=${code}). ${stderr || stdout}`))
            })
          })
        } catch (e) {
          lastErr = e
        }
      }

      throw lastErr instanceof Error ? lastErr : new Error('PowerShell raw print failed.')
    }

    // Fallback: network printers (TCP port 9100).
    if (!ip) throw new Error('Missing zebra IP and printerName not configured')

    return await new Promise<{ ok: boolean }>((resolve, reject) => {
      const socket = net.createConnection({ host: ip, port })

      const timer = setTimeout(() => {
        socket.destroy(new Error('Timeout printing ZPL'))
      }, 15000)

      socket.on('connect', () => {
        socket.write(payload, 'utf8', () => {
          socket.end()
        })
      })

      socket.on('error', (err) => {
        clearTimeout(timer)
        reject(err)
      })

      socket.on('close', () => {
        clearTimeout(timer)
        resolve({ ok: true })
      })
    })
  })

  ipcMain.handle('api:testConnection', async () => api.testConnection())
  ipcMain.handle('sync:now', async () => {
    const items = await api.fetchBarcodes()
    const now = Date.now()
    const res = repo.upsertMany(items, now)
    repo.setLastSync(now)
    return { ...res, lastSync: now }
  })
  ipcMain.handle('db:listBarcodes', () => repo.listBarcodes())
  ipcMain.handle('db:deleteBarcodes', (_evt, barcodes: string[]) => {
    return { deleted: repo.deleteMany(barcodes) }
  })
  ipcMain.handle('db:updateBarcodes', (_evt, updates: Array<{ barcode: string; name: string; price: number }>) => {
    return { updated: repo.updateMany(updates) }
  })
  ipcMain.handle('db:getLastSync', () => repo.getLastSync())

  createAppMenu()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

