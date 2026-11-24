import { useEffect, useMemo, useRef, useState } from 'react'
import { LabelPreview } from './LabelPreview'
import { bottomRowZpl } from './zplGraphics'
import appLogo from '../build/icon-source.png'

type BarcodeRow = Awaited<ReturnType<typeof window.api.listBarcodes>>[number]

function isValidUrl(s: string) {
  try {
    const u = new URL(s)
    return u.protocol === 'http:' || u.protocol === 'https:'
  } catch {
    return false
  }
}

function normalizeEndpointUrl(s: string) {
  return s.trim()
}

function formatDMY(ts: number) {
  const d = new Date(ts)
  const dd = String(d.getDate()).padStart(2, '0')
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const yyyy = d.getFullYear()
  return `${dd}.${mm}.${yyyy}`
}

const UPDATE_SERVER_UNREACHABLE = 'Serverul de actualizari nu poate fi accesat'
const isUpdateErrorMessage = (m: string) =>
  /eroare|error|cannot|failed|econnrefused|enotfound|econnreset|etimedout/i.test(m)

export default function App() {
  const [view, setView] = useState<'home' | 'settings'>('home')
  const [apiBaseUrl, setApiBaseUrl] = useState('http://central/barcodes')
  const [status, setStatus] = useState<string>('')
  const [loading, setLoading] = useState(false)
  const [rows, setRows] = useState<BarcodeRow[]>([])
  const [lastSync, setLastSync] = useState<number | null>(null)
  const [query, setQuery] = useState('')
  const [saveOkVisible, setSaveOkVisible] = useState(false)
  const [printers, setPrinters] = useState<
    Array<{ name: string; displayName?: string; isDefault?: boolean; description?: string; location?: string }>
  >([])
  const [selectedPrinter, setSelectedPrinter] = useState('')
  const [selectedItems, setSelectedItems] = useState<
    Array<{ id: string; barcode: string; name: string; price: number; fel?: string; source: 'first' | 'manual' }>
  >([])
  const [editMode, setEditMode] = useState(false)
  const [editTargetBarcode, setEditTargetBarcode] = useState<string | null>(null)
  const [editDrafts, setEditDrafts] = useState<Record<string, { barcode: string; name: string; price: string }>>({})
  const editDraftsRef = useRef(editDrafts)
  const selectedItemsRef = useRef(selectedItems)
  const editTargetBarcodeRef = useRef(editTargetBarcode)
  const searchInputRef = useRef<HTMLInputElement | null>(null)
  const syncButtonRef = useRef<HTMLButtonElement | null>(null)
  const resizedViewsRef = useRef<{ home: boolean; settings: boolean }>({ home: false, settings: false })
  const [updateCurrentVersion, setUpdateCurrentVersion] = useState('')
  const [updateLatestVersion, setUpdateLatestVersion] = useState<string | null>(null)
  const [updateStatus, setUpdateStatus] = useState('')
  const [checkingUpdates, setCheckingUpdates] = useState(false)
  const [downloadingUpdate, setDownloadingUpdate] = useState(false)
  const [updateAvailable, setUpdateAvailable] = useState(false)
  const [showPreview, setShowPreview] = useState(false) // DEV: preview etichete inainte de print

  useEffect(() => {
    if (!window.api) return
    window.api
      .getSettings()
      .then((s) => {
        setApiBaseUrl(s.apiBaseUrl || 'http://central/barcodes')
        setSelectedPrinter(s.printerName || '')
      })
      .catch(() => {})
    window.api
      .getLastSync()
      .then((ts) => setLastSync(ts ?? null))
      .catch(() => {})
    window.api.listBarcodes().then(setRows)
    return window.api.onOpenSettings(() => setView('settings'))
  }, [])

  useEffect(() => {
    if (!window.api || view !== 'settings') return
    window.api
      .listPrinters()
      .then((p) => setPrinters(p))
      .catch(() => {})
    window.api
      .getUpdatesInfo()
      .then((info) => {
        setUpdateCurrentVersion(info.currentVersion)
        setUpdateLatestVersion(info.latestVersion)
        setUpdateStatus(
          info.status && isUpdateErrorMessage(info.status) ? UPDATE_SERVER_UNREACHABLE : info.status
        )
        setUpdateAvailable(!!info.latestVersion && info.latestVersion !== info.currentVersion)
        setDownloadingUpdate(info.isDownloading ?? false)
      })
      .catch(() => {})
    const off = window.api?.onUpdatesDownloadState?.((downloading) => setDownloadingUpdate(downloading))
    return () => off?.()
  }, [view])

  useEffect(() => {
    if (view !== 'home') return
    const focusSearch = () => {
      const syncBtn = syncButtonRef.current
      if (document.activeElement === syncBtn) syncBtn?.blur()
      searchInputRef.current?.focus({ preventScroll: true })
      searchInputRef.current?.select()
    }
    const t1 = window.setTimeout(focusSearch, 0)
    const t2 = window.setTimeout(focusSearch, 120)
    const t3 = window.setTimeout(focusSearch, 280)
    const t4 = window.setTimeout(focusSearch, 520)
    return () => {
      window.clearTimeout(t1)
      window.clearTimeout(t2)
      window.clearTimeout(t3)
      window.clearTimeout(t4)
    }
  }, [view])

  useEffect(() => {
    if (!saveOkVisible) return
    const t = window.setTimeout(() => setSaveOkVisible(false), 2000)
    return () => window.clearTimeout(t)
  }, [saveOkVisible])

  useEffect(() => {
    if (!status) return
    const t = window.setTimeout(() => setStatus(''), 5000)
    return () => window.clearTimeout(t)
  }, [status])

  const canSave = useMemo(() => isValidUrl(apiBaseUrl), [apiBaseUrl])
  const queryTrimmed = query.trim()
  const isSearchActive = queryTrimmed.length >= 3
  const filteredRows = useMemo(() => {
    if (!isSearchActive) return []
    const q = queryTrimmed.toLowerCase()
    return rows.filter((r) => {
      const hay = `${r.barcode} ${r.name}`.toLowerCase()
      return hay.includes(q)
    })
  }, [isSearchActive, queryTrimmed, rows])

  const displayedCount = useMemo(() => {
    // Cerinta: counterul se schimba doar cand cautarea e activa (>= 3 caractere).
    // Cand cautarea e goala sau < 3 caractere, afisam in continuare totalul din baza de date.
    return isSearchActive ? filteredRows.length : rows.length
  }, [filteredRows.length, isSearchActive, rows.length])

  // Highlight in the first table should reflect only items that originated from the first table.
  // Manual rows in the second table must not affect the selection highlight.
  const selectedSet = useMemo(
    () => new Set(selectedItems.filter((i) => i.source === 'first').map((i) => i.barcode)),
    [selectedItems]
  )

  function makeSelectedRowId() {
    return `ROW-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  }

  function displayBarcode(b: string) {
    // Manual rows are allowed to have empty barcode; show empty.
    return b
  }

  function toAsciiForZpl(s: string) {
    // Zebra ZPL often does not render diacritics; strip them.
    return s.normalize('NFD').replace(/[̀-ͯ]/g, '')
  }

  function escapeZpl(s: string) {
    return toAsciiForZpl(s).replace(/\r?\n/g, ' ').replace(/[\^~]/g, '')
  }

  // Zebra eticheta fizica: 58 x 35 mm. ZPL la 203 dpi (default Zebra): ^PW464 x ^LL280 puncte.

  /** Detecteaza cantitate in nume (L, ml, kg, g) si calculeaza pret / L sau pret / kg. */
  function getPricePerLiterOrKg(nameRaw: string, price: number): { label: string; suffix: 'L' | 'KG' } | null {
    if (!Number.isFinite(price) || price <= 0) return null
    const s = nameRaw.normalize('NFD').replace(/[̀-ͯ]/g, '')
    const parseNum = (m: string) => {
      const n = parseFloat(m.replace(',', '.'))
      return Number.isFinite(n) && n > 0 ? n : null
    }

    const tryMl = s.match(/(\d+(?:[.,]\d+)?)\s*ml\b/i)
    if (tryMl) {
      const ml = parseNum(tryMl[1]!)
      if (ml) {
        const liters = ml / 1000
        return { label: (price / liters).toFixed(2), suffix: 'L' }
      }
    }
    const tryL = s.match(/(\d+(?:[.,]\d+)?)\s*(?:l|lit(?:er|ri)?)\b/i)
    if (tryL) {
      const liters = parseNum(tryL[1]!)
      if (liters) return { label: (price / liters).toFixed(2), suffix: 'L' }
    }
    const tryKg = s.match(/(\d+(?:[.,]\d+)?)\s*kg\b/i)
    if (tryKg) {
      const kg = parseNum(tryKg[1]!)
      if (kg) return { label: (price / kg).toFixed(2), suffix: 'KG' }
    }
    const tryG = s.match(/(\d+(?:[.,]\d+)?)\s*(?:g|gr|gram(?:e)?)\b/i)
    if (tryG) {
      const g = parseNum(tryG[1]!)
      if (g) {
        const kg = g / 1000
        return { label: (price / kg).toFixed(2), suffix: 'KG' }
      }
    }
    return null
  }

  function formatPriceLei(p: (typeof selectedItems)[number]) {
    const n = p.price
    const priceStr = Number.isFinite(n) ? n.toFixed(2) : String(n ?? '')
    // \& este un tag ZPL (secventa folosita in ^FD) imediat dupa "LEI"
    return `${priceStr} LEI\\&`
  }

  function buildZplLabel(p: (typeof selectedItems)[number]) {
    const name = escapeZpl(p.name || '')
    const priceLei = escapeZpl(formatPriceLei(p))
    const barcode = escapeZpl(p.barcode || '')

    const PW = 464 // 58mm @ 203 dpi
    const LL = 280 // 35mm @ 203 dpi
    const d = (v: number) => v // 203 dpi native, no scaling
    const marginX = d(12) // aceeasi margine ca linia subtire
    const textW = PW - 2 * marginX
    // Margin suplimentar sus pentru descriere (puncte ZPL)
    const nameY = d(10)
    const nameFont = d(32)
    const nameLineGap = d(8)
    // Descriere: maxim 2 linii. Rezervam exact blocul de 2 linii + spatiu de separare.
    const nameBlockBottom = nameY + nameFont * 2 + nameLineGap + d(8)
    const priceFont = d(96)
    // Mai inalt + mai mult spatiu orizontal => module ^BY mai groase, print mai sigur
    const barH = d(34)
    const interpBelow = d(20)
    const bottomM = d(28) // extra margin so printer doesn't cut off barcode/price per kg
    const barcodeY = Math.max(0, LL - bottomM - barH - interpBelow)
    // SGR: "SGR" in nume SAU campul "fel" din API este litera G
    const hasSgr = (p.name || '').toUpperCase().includes('SGR') || (p.fel || '').trim().toUpperCase() === 'G'
    const perUnit = getPricePerLiterOrKg(p.name || '', p.price)
    // Linie subtire deasupra codului de bare si a randului "SGR / pret per L"
    const hasBottom = !!barcode || hasSgr || !!perUnit
    const lineY = barcodeY - d(11)
    // Pret centrat pe verticala in spatiul ramas intre descriere (max 2 linii) si linia de jos.
    const gapTop = nameBlockBottom
    const gapBottom = hasBottom ? lineY : LL - bottomM
    // Doar inaltimea liniei de pret pentru centrare
    const priceBlockHeight = priceFont
    const minPriceY = gapTop + d(2)
    const maxPriceY = Math.max(minPriceY, gapBottom - priceBlockHeight - d(2))
    const centeredPriceY = Math.round((gapTop + gapBottom) / 2 - priceBlockHeight / 2)
    const priceY = Math.max(minPriceY, Math.min(maxPriceY, centeredPriceY))

    let zpl = '^XA'
    zpl += `^PW${PW}`
    zpl += `^LL${LL}`
    zpl += '^CI28'
    zpl += `^FO${marginX},${nameY}^A0N,${nameFont},${nameFont}^FB${textW},2,${nameLineGap},L,0^FD${name}^FS`
    zpl += `^FO${marginX},${priceY}^A0N,${priceFont},${priceFont}^FB${textW},1,0,C,0^FD${priceLei}^FS`

    if (barcode) {
      // Jos-stanga; modul fix 1 punct: codurile scurte nu devin mai late decat cele lungi (EAN)
      const byNarrow = 1
      zpl += `^FO${marginX},${barcodeY}^BY${byNarrow}^BCN,${barH},Y,N,N^FD${barcode}^FS`
    }

    if (hasBottom) zpl += `^FO${d(12)},${lineY}^GB${PW - d(24)},1,1^FS`
    if (hasSgr || perUnit) {
      // Rand de jos aliniat la dreapta: logo SGR | +0.50 LEI SGR | PRET PER L (texte desenate ca imagini Segoe UI)
      zpl += bottomRowZpl({
        sgr: hasSgr,
        perUnit: perUnit
          ? { title: perUnit.suffix === 'L' ? 'PRET PER L' : 'PRET PER KG', value: perUnit.label }
          : null,
        rowY: barcodeY, // aceeasi inaltime si aliniere ca barele codului de bare
        rowH: barH + interpBelow, // cod de bare + cifrele de sub el
        rightEdge: PW - marginX
      })
    }

    zpl += '^PQ1'
    zpl += '^XZ\n'
    return zpl
  }

  async function printLabelsToPrinter() {
    if (!window.api || !selectedItems.length) return
    if (!selectedPrinter) {
      window.alert('Selecteaza o imprimanta in Setari.')
      return
    }
    setStatus('Printeaza...')
    try {
      for (const p of selectedItems) {
        const zpl = buildZplLabel(p)
        await window.api.printZpl(selectedPrinter, zpl)
      }
      setStatus(`Etichete trimise la imprimanta (${selectedItems.length} produse)`)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setStatus(`Eroare print: ${msg}`)
    }
    setTimeout(() => setStatus(''), 3000)
  }

  function addManualItem() {
    const id = makeSelectedRowId()
    const newItem = { id, barcode: '', name: '', price: 0, source: 'manual' as const }
    setSelectedItems((prev) => [...prev, newItem])
    setEditDraftsWithRef({
      [id]: { barcode: '', name: '', price: '0' }
    })
    editTargetBarcodeRef.current = id
    setEditTargetBarcode(id)
    setEditMode(true)
  }

  function toggleSelected(barcode: string) {
    if (editMode) return
    setSelectedItems((prev) => {
      const existsFirst = prev.some((i) => i.barcode === barcode && i.source === 'first')
      if (existsFirst) return prev.filter((i) => !(i.barcode === barcode && i.source === 'first'))
      const row = rows.find((r) => r.barcode === barcode)
      if (!row) return prev
      return [
        ...prev,
        {
          id: makeSelectedRowId(),
          barcode: row.barcode,
          name: row.name,
          price: row.price,
          fel: row.fel,
          source: 'first' as const
        }
      ]
    })
  }

  function startEditItem(id: string) {
    const item = selectedItems.find((it) => it.id === id)
    if (!item) return
    setEditDraftsWithRef({
      [id]: { barcode: item.barcode, name: item.name, price: String(item.price) }
    })
    editTargetBarcodeRef.current = id
    setEditTargetBarcode(id)
    setEditMode(true)
  }

  function cancelEditSelected() {
    setEditMode(false)
    editTargetBarcodeRef.current = null
    setEditTargetBarcode(null)
    setEditDraftsWithRef({})
  }

  function setEditDraftsWithRef(updater: any) {
    const prev = editDraftsRef.current
    const next = typeof updater === 'function' ? updater(prev) : updater
    editDraftsRef.current = next
    setEditDrafts(next)
  }

  function finishEditItem() {
    const target = editTargetBarcodeRef.current
    if (!target) return
    const staged = editDraftsRef.current[target]
    const current = selectedItemsRef.current.find((it) => it.id === target)
    if (!current) return

    const name = staged?.name ?? current.name
    const stagedBarcode = (staged?.barcode ?? '').trim()
    // If user leaves barcode empty, keep current barcode.
    const barcode = stagedBarcode.length ? stagedBarcode : current.barcode
    const priceRaw = staged?.price ?? String(current.price)
    const parsed = Number(String(priceRaw).trim())
    const price = Number.isFinite(parsed) ? parsed : current.price

    setSelectedItems((prev) =>
      prev.map((it) => (it.id === target ? { ...it, barcode, name, price } : it))
    )

    cancelEditSelected()
  }

  function clearSelectedItems() {
    if (!selectedItems.length) return
    setSelectedItems([])
    setEditMode(false)
    editTargetBarcodeRef.current = null
    setEditDraftsWithRef({})
    setEditTargetBarcode(null)
  }

  function removeSelectedItem(id: string) {
    setSelectedItems((prev) => prev.filter((it) => it.id !== id))
    setEditDraftsWithRef((prev: typeof editDrafts) => {
      const next = { ...prev }
      delete next[id]
      return next
    })
    if (editTargetBarcode === id) {
      setEditMode(false)
      setEditTargetBarcode(null)
    }
  }

  // Modifica un camp din draft-ul randului in editare (nume / pret / cod de bare).
  function setDraftField(
    item: (typeof selectedItems)[number],
    field: 'barcode' | 'name' | 'price',
    value: string
  ) {
    setEditDraftsWithRef((prev: typeof editDrafts) => ({
      ...prev,
      [item.id]: {
        ...(prev[item.id] ?? { barcode: item.barcode, name: item.name, price: String(item.price) }),
        [field]: value
      }
    }))
  }

  useEffect(() => {
    if (!window.api?.resizeToContent || resizedViewsRef.current[view]) return
    resizedViewsRef.current[view] = true
    const t = window.setTimeout(() => {
      window.api?.resizeToContent?.().catch(() => {})
    }, 250)
    return () => window.clearTimeout(t)
  }, [view])

  async function saveSettings() {
    if (!window.api) return
    const url = normalizeEndpointUrl(apiBaseUrl)
    if (!isValidUrl(url)) return
    try {
      const res = await window.api.setApiBaseUrl(url)
      setApiBaseUrl(res.apiBaseUrl || url)
      if (selectedPrinter) {
        const printerRes = await window.api.setDefaultPrinter(selectedPrinter)
        setSelectedPrinter(printerRes.printerName || selectedPrinter)
      }
      setSaveOkVisible(true)
    } catch (e) {
      console.error(e)
    }
  }

  async function checkForUpdates() {
    if (!window.api) {
      setUpdateStatus(UPDATE_SERVER_UNREACHABLE)
      return
    }
    setCheckingUpdates(true)
    setUpdateStatus('Verificare actualizari...')
    try {
      const res = await window.api.checkForUpdates()
      setUpdateCurrentVersion(res.currentVersion)
      setUpdateLatestVersion(res.latestVersion)
      setUpdateStatus(res.status && isUpdateErrorMessage(res.status) ? UPDATE_SERVER_UNREACHABLE : res.status)
      setUpdateAvailable(res.updateAvailable)
    } catch {
      setUpdateStatus(UPDATE_SERVER_UNREACHABLE)
    } finally {
      setCheckingUpdates(false)
    }
  }

  async function downloadUpdates() {
    if (!window.api) return
    setCheckingUpdates(true)
    try {
      const res = await window.api.downloadUpdates()
      setUpdateCurrentVersion(res.currentVersion)
      setUpdateLatestVersion(res.latestVersion)
      setUpdateStatus(res.status && isUpdateErrorMessage(res.status) ? UPDATE_SERVER_UNREACHABLE : res.status)
      setUpdateAvailable(res.updateAvailable)
    } catch {
      setUpdateStatus(UPDATE_SERVER_UNREACHABLE)
    } finally {
      setCheckingUpdates(false)
    }
  }

  async function syncNow() {
    if (!window.api) return
    setLoading(true)
    setStatus('Sincronizare...')
    try {
      const res = await window.api.syncNow()
      setRows(await window.api.listBarcodes())
      setLastSync(res.lastSync ?? Date.now())
      setStatus(`Sincronizare finalizata.\nProduse adaugate: ${res.inserted}\nProduse actualizate: ${res.updated}`)
    } catch {
      setStatus('Serverul nu poate fi contactat.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    editDraftsRef.current = editDrafts
  }, [editDrafts])
  useEffect(() => {
    selectedItemsRef.current = selectedItems
  }, [selectedItems])
  useEffect(() => {
    editTargetBarcodeRef.current = editTargetBarcode
  }, [editTargetBarcode])

  // Cat timp un rand e in editare, un clic in afara lui (in afara butoanelor lui) il finalizeaza.
  useEffect(() => {
    if (!editMode) return
    const onMouseDown = (e: MouseEvent) => {
      const t = e.target as HTMLElement | null
      if (!t) return
      if (t.closest('[aria-label="Sterge produs"]') || t.closest('[data-edit-row="1"]')) return
      finishEditItem()
    }
    window.addEventListener('mousedown', onMouseDown, true)
    return () => window.removeEventListener('mousedown', onMouseDown, true)
  }, [editMode])

  return (
    <div
      className="container-fluid pt-4 pb-2 px-3 h-100 overflow-hidden d-flex flex-column"
      style={{ fontFamily: 'Segoe UI, system-ui, sans-serif' }}
    >
      <div className="d-flex align-items-center justify-content-between mb-3">
        <div>
          <div className="d-flex align-items-center gap-2">
            <div
              className="rounded-3 pn-soft-border"
              style={{
                width: 36,
                height: 36,
                display: 'grid',
                placeItems: 'center',
                background: 'rgba(13,110,253,0.10)'
              }}
            >
              <img
                src={appLogo}
                alt="Logo Imprimare Preturi"
                style={{ width: 28, height: 28, objectFit: 'contain' }}
              />
            </div>
            <div>
              <div className="h4 mb-0">
                Imprimare Preturi
                {import.meta.env.DEV && <span className="badge text-bg-warning ms-2 align-middle fs-6">DEV</span>}
              </div>
            </div>
          </div>
        </div>

        <div className="d-flex align-items-center gap-3">
          {view === 'home' ? (
            <div className="d-flex align-items-center gap-2">
              <button
                ref={syncButtonRef}
                className="btn btn-success btn-sm"
                onClick={syncNow}
                disabled={loading}
                title="Sincronizare"
                aria-label="Sincronizare"
              >
                <i className={`bi ${loading ? 'bi-hourglass-split' : 'bi-cloud-download'}`} />
              </button>
              <span className="badge text-bg-light pn-soft-border pn-mono small">
                <i className="bi bi-clock me-1" />
                Actualizat: {lastSync ? formatDMY(lastSync) : 'Niciodata'}
              </span>
            </div>
          ) : null}

          <div className="ms-auto btn-group">
            <button
              className={`btn btn-sm ${view === 'home' ? 'btn-primary' : 'btn-outline-primary'}`}
              onClick={() => setView('home')}
            >
              <i className="bi bi-house-door me-1" />
              Acasa
            </button>
            <button
              className={`btn btn-sm ${view === 'settings' ? 'btn-primary' : 'btn-outline-primary'}`}
              onClick={() => setView('settings')}
            >
              <i className="bi bi-gear me-1" />
              Configurare
            </button>
          </div>
        </div>
      </div>

      {!window.api ? (
        <div className="alert alert-warning mt-3 mb-0 pn-card">
          This UI is meant to run inside Electron (IPC bridge not available in browser).
        </div>
      ) : null}

      {view === 'home' && status && (
        <div className="position-fixed bottom-0 end-0 p-3" style={{ zIndex: 2000 }}>
          <div
            className={`alert alert-${
              status === 'Sincronizare...' || status === 'Printeaza...'
                ? 'warning'
                : status.toLowerCase().includes('failed') ||
                    status.toLowerCase().includes('error') ||
                    status === 'Serverul nu poate fi contactat.'
                  ? 'danger'
                  : 'success'
            } mb-0 py-1 px-3 small shadow`}
            style={{ maxWidth: 260 }}
          >
            {status.split('\n').map((line, i) => (
              <span key={i}>
                {line}
                {i < status.split('\n').length - 1 && <br />}
              </span>
            ))}
          </div>
        </div>
      )}

      {view === 'settings' ? (
        <div className="card pn-card">
          <div className="card-header bg-white fw-semibold">
            <i className="bi bi-gear me-2" />
            Configurare
          </div>
          <div className="card-body">
            <div className="mb-2">
              <label className="form-label fw-semibold">IP Server Produse</label>
              <input
                value={apiBaseUrl}
                onChange={(e) => setApiBaseUrl(e.target.value)}
                placeholder="http://central/barcodes"
                className="form-control"
              />
            </div>

            <div className="mb-3">
              <label className="form-label fw-semibold">Imprimanta</label>
              <select
                className="form-select"
                value={selectedPrinter}
                onChange={(e) => setSelectedPrinter(e.target.value)}
              >
                {!selectedPrinter && <option value="">Selecteaza o imprimanta</option>}
                {printers.map((p) => (
                  <option key={p.name} value={p.displayName || p.name}>
                    {p.displayName || p.name}
                    {p.isDefault ? ' (implicit)' : ''}
                  </option>
                ))}
              </select>
            </div>

            <div className="pn-soft-border rounded-3 p-3 mb-3">
              <div className="d-flex align-items-center justify-content-between gap-2 flex-wrap">
                <div className="fw-semibold">
                  <i className="bi bi-arrow-repeat me-2" />
                  Actualizari
                </div>
                <button
                  className={`btn btn-sm ${updateAvailable ? 'btn-warning' : 'btn-outline-primary'}`}
                  onClick={() => void (updateAvailable ? downloadUpdates() : checkForUpdates())}
                  disabled={checkingUpdates || downloadingUpdate}
                >
                  {checkingUpdates
                    ? 'Verific...'
                    : downloadingUpdate
                      ? 'Se descarca...'
                      : updateAvailable
                        ? 'Descarca si actualizeaza'
                        : 'Verifica actualizare'}
                </button>
              </div>
              <div className="mt-2 small">
                <div>
                  Versiune curenta:{' '}
                  <span className="pn-mono">{updateCurrentVersion || '...'}</span>
                </div>
                {updateAvailable && updateLatestVersion ? (
                  <div>
                    Versiune noua:{' '}
                    <span className="pn-mono">{updateLatestVersion}</span>
                  </div>
                ) : null}
                {updateStatus && updateStatus !== 'Actualizari: neverificate' ? (
                  <div
                    className={`mt-1 ${
                      updateStatus === UPDATE_SERVER_UNREACHABLE ? 'text-danger fw-medium' : 'text-body-secondary'
                    }`}
                  >
                    {updateStatus === UPDATE_SERVER_UNREACHABLE ? (
                      <>
                        <i className="bi bi-exclamation-circle me-1" />
                        {updateStatus}
                      </>
                    ) : (
                      updateStatus
                    )}
                  </div>
                ) : null}
              </div>
            </div>

            <div className="d-flex gap-2 flex-wrap">
              <button className="btn btn-success" onClick={saveSettings} disabled={!canSave}>
                <i className="bi bi-check2-circle me-1" />
                Salveaza
              </button>
              <button className="btn btn-secondary d-flex align-items-center gap-2" onClick={() => setView('home')}>
                <i className="bi bi-arrow-left" />
                Inapoi
              </button>
            </div>

            {saveOkVisible ? (
              <div className="mt-3 alert alert-success mb-0" role="status">
                <i className="bi bi-check2-circle me-2" />
                Setari salvate
              </div>
            ) : null}
          </div>
        </div>
      ) : (
        <>
          <div className="row g-0 mt-0" style={{ minHeight: 0, flex: '1 1 auto', overflow: 'hidden' }}>
            <div className="col-12 col-lg-6 pe-lg-2 mb-3 mb-lg-0" style={{ minHeight: 0 }}>
              <div
                className="card pn-card d-flex flex-column h-100"
                style={{ minHeight: 0, flex: '1 1 auto', overflow: 'hidden' }}
              >
                <div className="card-header bg-white fw-semibold d-flex align-items-center justify-content-between">
                  <span>
                    <i className="bi bi-search me-2" />
                    Cautare produse
                  </span>
                  <span className="text-body-secondary small pn-mono">{displayedCount} produse</span>
                </div>

                <div className="px-3 pt-3">
                  <div className="input-group">
                    <span className="input-group-text">
                      <i className="bi bi-search" />
                    </span>
                    <input
                      ref={searchInputRef}
                      autoFocus={view === 'home'}
                      className="form-control"
                      placeholder="Cauta dupa cod de bare sau nume produs"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      onKeyDown={(e) => {
                        // Scanner/cod tastat (doar cifre) + Enter: un singur rezultat => selecteaza, goleste, refocus
                        if (e.key !== 'Enter' || !/^\d+$/.test(queryTrimmed) || filteredRows.length !== 1) return
                        const only = filteredRows[0]!
                        if (!selectedSet.has(only.barcode)) toggleSelected(only.barcode)
                        setQuery('')
                        searchInputRef.current?.focus()
                      }}
                    />
                    {query ? (
                      <button
                        className="btn btn-outline-secondary"
                        onClick={(e) => {
                          e.stopPropagation()
                          setQuery('')
                        }}
                      >
                        Sterge
                      </button>
                    ) : null}
                  </div>
                </div>

                <div
                  className="table-responsive pn-table px-3 pb-3 mt-2"
                  style={{ flex: '1 1 0', minHeight: 0, overflowY: 'scroll', overflowX: 'hidden' }}
                >
                  <table className="table table-hover table-striped mb-0 align-middle pn-products-table">
                    <thead className="table-light pn-products-thead">
                      <tr>
                        <th scope="col" className="fw-semibold">
                          Nume produse
                        </th>
                        <th scope="col" className="text-end fw-semibold" style={{ width: 90 }}>
                          Pret
                        </th>
                        <th scope="col" style={{ width: 150 }}>
                          Cod de bare
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredRows.map((r) => {
                        const isSelected = selectedSet.has(r.barcode)
                        return (
                          <tr
                            key={r.barcode}
                            className={`pn-selectable-row ${isSelected ? 'pn-selected-row' : ''}`}
                            onClick={() => toggleSelected(r.barcode)}
                            role="button"
                            tabIndex={0}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' || e.key === ' ') toggleSelected(r.barcode)
                            }}
                            aria-pressed={isSelected}
                          >
                            <td className="text-truncate" style={{ minWidth: 0 }} title={r.name}>
                              {r.name}
                            </td>
                            <td className="text-nowrap pn-mono text-end">{r.price}</td>
                            <td className="text-nowrap pn-mono">{r.barcode}</td>
                          </tr>
                        )
                      })}
                      {filteredRows.length === 0 ? (
                        <tr>
                          <td colSpan={3} className="text-body-secondary py-3">
                            {!queryTrimmed && rows.length > 0
                              ? 'Cauta produse in casuta de mai sus'
                              : !queryTrimmed && rows.length === 0
                                ? 'Nu exista produse in baza de date'
                                : queryTrimmed.length < 3
                                  ? 'Introdu cel putin 3 caractere pentru cautare'
                                  : 'Nu exista produs pentru cautare'}
                          </td>
                        </tr>
                      ) : null}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            <div className="col-12 col-lg-6 ps-lg-2" style={{ minHeight: 0 }}>
              <div
                className="card pn-card d-flex flex-column h-100"
                style={{ minHeight: 0, flex: '1 1 auto', overflow: 'hidden' }}
              >
                <div className="card-header bg-white fw-semibold d-flex align-items-center justify-content-between">
                  <span>
                    <i className="bi bi-list-check me-2" />
                    Produse selectate
                  </span>
                  <span className="text-body-secondary small pn-mono">{selectedItems.length} produse</span>
                </div>

                <div className="px-3 pt-2 pb-1">
                  <div className="d-flex gap-2 flex-wrap">
                    <button
                      className="btn btn-danger btn-sm"
                      disabled={!selectedItems.length}
                      onClick={clearSelectedItems}
                    >
                      <i className="bi bi-trash me-1" />
                      Sterge toate produsele
                    </button>

                    <button className="btn btn-primary btn-sm" onClick={addManualItem} disabled={editMode}>
                      <i className="bi bi-plus-lg me-1" />
                      Adauga produs
                    </button>

                    <button
                      className="btn btn-secondary btn-sm ms-auto"
                      onClick={() => (import.meta.env.DEV ? setShowPreview(true) : printLabelsToPrinter())}
                      disabled={!selectedItems.length}
                      title="Trimite etichetele la imprimanta"
                    >
                      <i className="bi bi-printer me-1" />
                      Printeaza etichete
                    </button>
                  </div>
                </div>

                <div
                  className="table-responsive pn-table px-3 pb-3 mt-2"
                  style={{ flex: '1 1 0', minHeight: 0, overflowY: 'scroll' }}
                >
                  <table className="table table-sm table-hover mb-0 align-middle pn-products-table">
                    <thead className="table-light pn-products-thead">
                      <tr>
                        <th scope="col" style={{ width: 70 }} />
                        <th scope="col" className="fw-semibold">
                          Nume produse
                        </th>
                        <th scope="col" className="text-end fw-semibold" style={{ width: 90 }}>
                          Pret
                        </th>
                        <th scope="col" style={{ width: 150 }}>
                          Cod de bare
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {selectedItems.length === 0 ? (
                        <tr>
                          <td colSpan={4} className="text-body-secondary py-3">
                            Nu exista produse selectate
                          </td>
                        </tr>
                      ) : null}
                      {selectedItems.map((it) => {
                        const editing = editMode && editTargetBarcode === it.id
                        return (
                          <tr key={it.id} className="" data-edit-row={editing ? '1' : undefined}>
                            <td className="text-nowrap" onClick={(e) => e.stopPropagation()}>
                              {editing ? (
                                <div className="d-flex align-items-center gap-1">
                                  <button
                                    type="button"
                                    className="btn btn-sm btn-danger p-1"
                                    aria-label="Sterge produs"
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      removeSelectedItem(it.id)
                                    }}
                                  >
                                    <i className="bi bi-trash" />
                                  </button>
                                  <button
                                    type="button"
                                    className="btn btn-sm btn-success p-1"
                                    aria-label="Finalizeaza editarea"
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      finishEditItem()
                                    }}
                                  >
                                    <i className="bi bi-check2" />
                                  </button>
                                </div>
                              ) : (
                                <div className="d-flex align-items-center gap-1">
                                  <button
                                    type="button"
                                    className="btn btn-sm btn-danger p-1"
                                    aria-label="Sterge produs"
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      removeSelectedItem(it.id)
                                    }}
                                  >
                                    <i className="bi bi-trash" />
                                  </button>
                                  <button
                                    type="button"
                                    className="btn btn-sm btn-warning p-1"
                                    aria-label="Editeaza produs"
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      startEditItem(it.id)
                                    }}
                                  >
                                    <i className="bi bi-pencil" />
                                  </button>
                                </div>
                              )}
                            </td>
                            <td className="text-truncate" style={{ minWidth: 0 }} title={it.name}>
                              {editing ? (
                                <input
                                  className="form-control form-control-sm"
                                  value={editDrafts[it.id]?.name ?? it.name}
                                  onChange={(e) => setDraftField(it, 'name', e.target.value)}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Escape') cancelEditSelected()
                                  }}
                                />
                              ) : (
                                it.name
                              )}
                            </td>
                            <td className="text-nowrap pn-mono text-end" onClick={(e) => e.stopPropagation()}>
                              {editing ? (
                                <input
                                  className="form-control form-control-sm text-end"
                                  type="number"
                                  step="0.01"
                                  value={editDrafts[it.id]?.price ?? String(it.price)}
                                  onChange={(e) => setDraftField(it, 'price', e.target.value)}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Escape') cancelEditSelected()
                                  }}
                                />
                              ) : (
                                it.price
                              )}
                            </td>
                            <td className="text-nowrap pn-mono">
                              {editing ? (
                                <input
                                  className="form-control form-control-sm pn-mono"
                                  value={editDrafts[it.id]?.barcode ?? it.barcode}
                                  onChange={(e) => setDraftField(it, 'barcode', e.target.value)}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Escape') cancelEditSelected()
                                  }}
                                />
                              ) : (
                                displayBarcode(it.barcode)
                              )}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>
        </>
      )}

      {showPreview && (
        <div className="modal d-block" style={{ background: 'rgba(0,0,0,.5)' }}>
          <div className="modal-dialog modal-dialog-scrollable modal-lg">
            <div className="modal-content">
              <div className="modal-header">
                <h5 className="modal-title">Preview etichete (DEV)</h5>
              </div>
              <div className="modal-body d-flex flex-wrap gap-3">
                {selectedItems.map((p) => (
                  <LabelPreview key={p.id} zpl={buildZplLabel(p)} />
                ))}
              </div>
              <div className="modal-footer">
                <button className="btn btn-secondary" onClick={() => setShowPreview(false)}>
                  Anuleaza
                </button>
                <button
                  className="btn btn-primary"
                  onClick={() => {
                    setShowPreview(false)
                    void printLabelsToPrinter()
                  }}
                >
                  Printeaza
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
