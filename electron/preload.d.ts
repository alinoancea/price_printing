export {}

declare global {
  interface Window {
    api: {
      getSettings: () => Promise<{ apiBaseUrl: string; printerName?: string; zebraIp?: string; zebraPort?: number }>
      setApiBaseUrl: (
        url: string
      ) => Promise<{ apiBaseUrl: string; printerName?: string; zebraIp?: string; zebraPort?: number }>
      getSettingsDebug: () => Promise<{
        apiBaseUrl: string
        storePath?: string
        printerName?: string
        zebraIp?: string
        zebraPort?: number
      }>
      testConnection: () => Promise<{ ok: boolean; status?: number; error?: string }>
      syncNow: () => Promise<{ inserted: number; updated: number; lastSync?: number }>
      listBarcodes: () => Promise<
        Array<{
          barcode: string
          name: string
          um: string
          price: number
          quantity: number
          fel: string
          updatedAt: number
        }>
      >
      getLastSync: () => Promise<number | null>
      resizeToContent: () => Promise<{ w: number; h: number } | null>
      deleteBarcodes: (barcodes: string[]) => Promise<{ deleted: number }>
      getUpdatesInfo: () => Promise<{
        currentVersion: string
        latestVersion: string | null
        status: string
        isDownloading?: boolean
      }>
      checkForUpdates: () => Promise<{
        currentVersion: string
        latestVersion: string | null
        updateAvailable: boolean
        status: string
      }>
      downloadUpdates: () => Promise<{
        currentVersion: string
        latestVersion: string | null
        updateAvailable: boolean
        status: string
      }>
      updateBarcodes: (
        updates: Array<{ barcode: string; name: string; price: number }>
      ) => Promise<{ updated: number }>
      listPrinters: () => Promise<
        Array<{
          name: string
          displayName?: string
          isDefault?: boolean
          description?: string
          location?: string
        }>
      >
      setDefaultPrinter: (name: string) => Promise<{ printerName: string }>
      setZebraConnection: (ip: string, port: number) => Promise<{ zebraIp: string; zebraPort: number }>
      printZpl: (printerName: string, zpl: string) => Promise<{ ok: boolean }>
      onOpenSettings: (cb: () => void) => () => void
      onUpdatesDownloadState: (cb: (downloading: boolean) => void) => (() => void) | undefined
    }
  }
}

