import Store from 'electron-store'

type Settings = {
  apiBaseUrl: string
}

export type ConnectionTestResult = { ok: boolean; status?: number; error?: string }

export type BarcodeApiItem = {
  barcode: number | string
  name: string
  um: string
  price: number
  quantity: number
  fel?: string | null // o litera; 'G' = produs cu garantie SGR
}

export class ApiClient {
  private store: Store<Settings>

  constructor(store: Store<Settings>) {
    this.store = store
  }

  getEndpointUrl(): string {
    const endpoint = (this.store as any).get('apiBaseUrl') as string | undefined
    return endpoint || 'http://central/barcodes'
  }

  async testConnection(): Promise<ConnectionTestResult> {
    const url = this.getEndpointUrl()
    try {
      const res = await fetch(url, { method: 'GET' })
      return { ok: res.ok, status: res.status }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  }

  async fetchBarcodes(): Promise<BarcodeApiItem[]> {
    const url = this.getEndpointUrl()
    const res = await fetch(url, { method: 'GET' })
    if (!res.ok) {
      throw new Error(`GET ${url} failed: ${res.status}`)
    }
    const data = (await res.json()) as unknown
    if (!Array.isArray(data)) throw new Error(`Expected JSON array from ${url}`)
    return data as BarcodeApiItem[]
  }
}

