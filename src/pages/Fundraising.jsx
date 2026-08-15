import { useState, useEffect, useMemo, useRef } from 'react'
import ExcelJS from 'exceljs'
import { supabase } from '../lib/supabase.js'

const BUCKET = 'fundraising-images'

const FUND_SOURCES = [
  { value: 'general', label: 'Church General Fund' },
  { value: 'missions', label: 'Missions Fund' },
  { value: 'other', label: 'Other / Small Business' },
]
const FUND_LABEL = Object.fromEntries(FUND_SOURCES.map(f => [f.value, f.label]))

const TX_TYPES = [
  { value: 'sale', label: 'Sale (money in)' },
  { value: 'donation', label: 'Donation (money in)' },
  { value: 'purchase', label: 'Purchase (money out)' },
  { value: 'adjustment', label: 'Adjustment' },
]
const TX_COLORS = {
  sale: { bg: '#e6f4ea', fg: '#2d7a4f' },
  donation: { bg: '#e6f4ea', fg: '#2d7a4f' },
  purchase: { bg: '#fdecea', fg: '#c0392b' },
  adjustment: { bg: '#eee', fg: '#555' },
}

const money = (n) => Number(n || 0).toLocaleString('en-US', { style: 'currency', currency: 'USD' })
const fmtDate = (d) => d ? new Date(d + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'

// Exact column order/names required by Zettle's own import template — do not
// reorder or rename these, or their import will reject the file.
const ZETTLE_COLUMNS = [
  'Name', 'Custom unit', 'Non profit (0%)', 'Tax exempt',
  'Option1 Name', 'Option1 Value', 'Option2 Name', 'Option2 Value', 'Option3 Name', 'Option3 Value',
  'SKU', 'Price', 'Cost price', 'Barcode', 'In stock', 'Category',
  'Variant id', 'Product id', 'ID (Do not edit)',
]

function csvEscape(val) {
  const s = val === null || val === undefined ? '' : String(val)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

function downloadCsv(filename, rows) {
  const csv = [ZETTLE_COLUMNS.join(','), ...rows.map(r => ZETTLE_COLUMNS.map(c => csvEscape(r[c])).join(','))].join('\n')
  const blob = new Blob([csv], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = filename
  document.body.appendChild(a); a.click(); document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

// Fundraising items (this app) always have a known shape — variant rows get
// their own line so Zettle can track each option's stock separately.
function fundraisingRowsToZettle(products) {
  const rows = []
  for (const p of products) {
    if (p.variants && p.variants.length > 0) {
      for (const v of p.variants) {
        rows.push({
          'Name': p.name, 'Price': p.sale_price || 0, 'Cost price': p.cost || 0,
          'Option1 Name': 'Option', 'Option1 Value': v.option_value,
          'In stock': v.quantity_on_hand ?? 0, 'Category': 'Fundraising',
        })
      }
    } else {
      rows.push({
        'Name': p.name, 'Price': p.sale_price || 0, 'Cost price': p.cost || 0,
        'In stock': p.quantity_on_hand ?? 0, 'Category': 'Fundraising',
      })
    }
  }
  return rows
}

// umc-store products — verified against that app's actual AdminProducts.jsx.
// Wrapped so a schema mismatch here doesn't take down the fundraising half
// of the export.
async function storeRowsToZettle() {
  const [{ data: products, error: pErr }, { data: colors, error: cErr }, { data: productColors, error: pcErr }] = await Promise.all([
    supabase.from('products').select('*').eq('active', true),
    supabase.from('colors').select('id, name'),
    supabase.from('product_colors').select('product_id, color_id, available_sizes'),
  ])
  if (pErr) throw pErr
  if (cErr) throw cErr
  if (pcErr) throw pcErr

  const colorName = Object.fromEntries((colors || []).map(c => [c.id, c.name]))
  const colorsByProduct = {}
  for (const pc of productColors || []) {
    if (!colorsByProduct[pc.product_id]) colorsByProduct[pc.product_id] = []
    colorsByProduct[pc.product_id].push(pc)
  }

  const rows = []
  for (const p of products || []) {
    const pColors = colorsByProduct[p.id] || []
    const category = p.category || 'Church Swag'
    const priceFor = (size) => (size && p.size_price_overrides?.[size] != null) ? p.size_price_overrides[size] : (p.base_price || 0)

    if (pColors.length === 0) {
      // No colors — just sizes (or a single plain item if no sizes either).
      const sizes = p.sizes?.length > 0 ? p.sizes : [null]
      for (const size of sizes) {
        rows.push({
          'Name': p.name, 'Price': priceFor(size), 'Category': category,
          ...(size ? { 'Option1 Name': 'Size', 'Option1 Value': size } : {}),
        })
      }
    } else {
      for (const pc of pColors) {
        // Each color can restrict which sizes it comes in; falls back to the
        // product's full size list when a color has no restriction set.
        const sizes = pc.available_sizes?.length > 0 ? pc.available_sizes : (p.sizes?.length > 0 ? p.sizes : [null])
        for (const size of sizes) {
          rows.push({
            'Name': p.name, 'Price': priceFor(size), 'Category': category,
            'Option1 Name': 'Color', 'Option1 Value': colorName[pc.color_id] || '',
            ...(size ? { 'Option2 Name': 'Size', 'Option2 Value': size } : {}),
          })
        }
      }
    }
  }
  return rows
}

async function uploadToStorage(file) {
  const ext = file.name.split('.').pop()
  const fileName = `${crypto.randomUUID()}.${ext}`
  const { error } = await supabase.storage.from(BUCKET).upload(fileName, file, { cacheControl: '3600', upsert: false })
  if (error) throw error
  const { data } = supabase.storage.from(BUCKET).getPublicUrl(fileName)
  return data.publicUrl
}

function totalStock(p) {
  return p.variants && p.variants.length > 0
    ? p.variants.reduce((s, v) => s + Number(v.quantity_on_hand || 0), 0)
    : Number(p.quantity_on_hand || 0)
}

export default function Fundraising() {
  const [tab, setTab] = useState('inventory') // 'inventory' | 'ledger' | 'requests'
  const [products, setProducts] = useState([])
  const [transactions, setTransactions] = useState([])
  const [requests, setRequests] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [showProductForm, setShowProductForm] = useState(false)
  const [editingProduct, setEditingProduct] = useState(null) // null = add mode
  const [showTxForm, setShowTxForm] = useState(false)
  const [exportingZettle, setExportingZettle] = useState(false)
  const [exportError, setExportError] = useState('')
  const [importingBulk, setImportingBulk] = useState(false)
  const [bulkImportResult, setBulkImportResult] = useState(null)
  const bulkFileInputRef = useRef(null)

  async function handleExportZettle() {
    setExportingZettle(true)
    setExportError('')
    const rows = fundraisingRowsToZettle(products)
    try {
      rows.push(...await storeRowsToZettle())
    } catch (err) {
      setExportError(`Church swag items couldn't be included (${err.message}) — exported fundraising items only.`)
    }
    downloadCsv(`zettle-import-${new Date().toISOString().slice(0, 10)}.csv`, rows)
    setExportingZettle(false)
  }

  async function handleDownloadBulkTemplate() {
    const wb = new ExcelJS.Workbook()
    wb.creator = 'UMCD Planning Hub'
    wb.created = new Date()

    const prodSheet = wb.addWorksheet('Products')
    prodSheet.columns = [
      { header: 'Name', key: 'name', width: 26 },
      { header: 'Description', key: 'description', width: 34 },
      { header: 'Cost', key: 'cost', width: 10 },
      { header: 'Sale Price', key: 'sale_price', width: 12 },
      { header: 'Fund Source', key: 'fund_source', width: 20 },
      { header: 'Vendor', key: 'vendor', width: 20 },
      { header: 'Quantity On Hand (no-variant items only)', key: 'quantity', width: 20 },
      { header: 'Public?', key: 'is_public', width: 10 },
      { header: 'Christian Ed Item?', key: 'is_ce', width: 16 },
    ]
    prodSheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } }
    prodSheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF3D0026' } }
    for (const p of products) {
      prodSheet.addRow({
        name: p.name, description: p.description || '', cost: p.cost || 0, sale_price: p.sale_price || 0,
        fund_source: FUND_LABEL[p.fund_source] || p.fund_source || '', vendor: p.vendor || '',
        quantity: p.variants?.length ? '' : (p.quantity_on_hand ?? 0),
        is_public: p.is_public ? 'Yes' : '', is_ce: p.is_christian_ed_item ? 'Yes' : '',
      })
    }
    for (let i = 0; i < 8; i++) prodSheet.addRow({})

    const varSheet = wb.addWorksheet('Variants')
    varSheet.columns = [
      { header: 'Product Name', key: 'product_name', width: 26 },
      { header: 'Option Name', key: 'option_name', width: 16 },
      { header: 'Option Value', key: 'option_value', width: 16 },
      { header: 'Quantity On Hand', key: 'quantity', width: 16 },
      { header: 'Sort Order', key: 'sort_order', width: 12 },
    ]
    varSheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } }
    varSheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF3D0026' } }
    for (const p of products) {
      for (const v of (p.variants || [])) {
        varSheet.addRow({
          product_name: p.name, option_name: v.option_name || 'Option', option_value: v.option_value,
          quantity: v.quantity_on_hand ?? 0, sort_order: v.sort_order ?? 0,
        })
      }
    }
    for (let i = 0; i < 10; i++) varSheet.addRow({})

    const txSheet = wb.addWorksheet('Transactions')
    txSheet.columns = [
      { header: 'Date', key: 'date', width: 14 },
      { header: 'Type', key: 'type', width: 14 },
      { header: 'Amount', key: 'amount', width: 12 },
      { header: 'Fund Source', key: 'fund_source', width: 20 },
      { header: 'Product Name (optional)', key: 'product_name', width: 26 },
      { header: 'Option Value (optional)', key: 'option_value', width: 18 },
      { header: 'Quantity (optional)', key: 'quantity', width: 16 },
      { header: 'Note', key: 'note', width: 30 },
    ]
    txSheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } }
    txSheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF3D0026' } }
    // Transactions are a ledger, not a catalog — leave the sheet blank for new
    // entries only (bulk-importing the entire existing ledger back would
    // create duplicates), with a few blank rows ready to fill in.
    for (let i = 0; i < 15; i++) txSheet.addRow({})

    const refSheet = wb.addWorksheet('Reference')
    refSheet.addRow(['Valid Fund Sources'])
    refSheet.getRow(1).font = { bold: true }
    for (const f of FUND_SOURCES) refSheet.addRow([f.label])
    refSheet.addRow([])
    refSheet.addRow(['Valid Transaction Types']).font = { bold: true }
    for (const t of TX_TYPES) refSheet.addRow([t.label.replace(/ \(.+\)/, '')])
    refSheet.getColumn(1).width = 28
    refSheet.addRow([])
    refSheet.addRow(['Notes:'])
    refSheet.addRow(['Products tab: matched by Name. Quantity On Hand only applies to products'])
    refSheet.addRow(['with no variants — if a product has variants, its total is calculated from them.'])
    refSheet.addRow(['Variants tab: leave a product out entirely to keep its existing variants'])
    refSheet.addRow(['untouched. Include a product and every variant under it fully replaces'])
    refSheet.addRow(['what\'s currently there for that product.'])
    refSheet.addRow(['Transactions tab: every filled-in row becomes a NEW ledger entry —'])
    refSheet.addRow(['this sheet is intentionally left blank on download so re-uploading it'])
    refSheet.addRow(['doesn\'t create duplicate transactions. Inventory updates automatically'])
    refSheet.addRow(['for sale/purchase transactions tied to a product, same as manual entry.'])

    const buffer = await wb.xlsx.writeBuffer()
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `umcd-fundraising-template-${new Date().toISOString().slice(0, 10)}.xlsx`
    a.click()
    URL.revokeObjectURL(url)
  }

  async function handleImportBulkTemplate(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setImportingBulk(true)
    setBulkImportResult(null)
    try {
      const buf = await file.arrayBuffer()
      const wb = new ExcelJS.Workbook()
      await wb.xlsx.load(buf)

      const prodSheet = wb.getWorksheet('Products')
      const varSheet = wb.getWorksheet('Variants')
      const txSheet = wb.getWorksheet('Transactions')
      if (!prodSheet) throw new Error('No "Products" sheet found — did you use the downloaded template?')

      const skipped = []
      let productsAdded = 0, productsUpdated = 0, variantsReplaced = 0, txAdded = 0

      const nameToProduct = {}
      for (const p of products) nameToProduct[p.name.toLowerCase()] = p

      // ── Products ──
      const prodRows = []
      prodSheet.eachRow((row, rowNumber) => {
        if (rowNumber === 1) return
        const name = (row.getCell(1).value ?? '').toString().trim()
        if (!name) return
        prodRows.push({
          name,
          description: (row.getCell(2).value ?? '').toString().trim(),
          cost: Number(row.getCell(3).value) || 0,
          sale_price: Number(row.getCell(4).value) || 0,
          fund_source_label: (row.getCell(5).value ?? '').toString().trim(),
          vendor: (row.getCell(6).value ?? '').toString().trim(),
          quantity: row.getCell(7).value,
          is_public: (row.getCell(8).value ?? '').toString().trim().toLowerCase() === 'yes',
          is_ce: (row.getCell(9).value ?? '').toString().trim().toLowerCase() === 'yes',
        })
      })

      for (const row of prodRows) {
        const fundMatch = FUND_SOURCES.find(f => f.label.toLowerCase() === row.fund_source_label.toLowerCase())
        if (row.fund_source_label && !fundMatch) {
          skipped.push(`${row.name} (unrecognized Fund Source "${row.fund_source_label}")`)
          continue
        }
        const existing = nameToProduct[row.name.toLowerCase()]
        const willHaveVariants = existing?.variants?.length > 0 // bulk import doesn't add first-time variants here — Variants tab does
        const patch = {
          name: row.name,
          description: row.description || null,
          cost: row.cost,
          sale_price: row.sale_price,
          fund_source: fundMatch?.value || 'general',
          vendor: row.vendor || null,
          is_public: row.is_public,
          is_christian_ed_item: row.is_public ? row.is_ce : false,
        }
        if (!willHaveVariants) patch.quantity_on_hand = Number(row.quantity) || 0

        if (existing) {
          const { error } = await supabase.from('fundraising_products').update(patch).eq('id', existing.id)
          if (error) { skipped.push(`${row.name} (${error.message})`); continue }
          productsUpdated++
        } else {
          const { data, error } = await supabase.from('fundraising_products').insert([{ ...patch, quantity_on_hand: Number(row.quantity) || 0 }]).select().single()
          if (error) { skipped.push(`${row.name} (${error.message})`); continue }
          nameToProduct[row.name.toLowerCase()] = { ...data, variants: [] }
          productsAdded++
        }
      }

      // ── Variants (replace-by-product-name) ──
      if (varSheet) {
        const variantsByProduct = {}
        varSheet.eachRow((row, rowNumber) => {
          if (rowNumber === 1) return
          const productName = (row.getCell(1).value ?? '').toString().trim()
          const optionValue = (row.getCell(3).value ?? '').toString().trim()
          if (!productName || !optionValue) return
          if (!variantsByProduct[productName]) variantsByProduct[productName] = []
          variantsByProduct[productName].push({
            option_name: (row.getCell(2).value ?? 'Option').toString().trim() || 'Option',
            option_value: optionValue,
            quantity_on_hand: Number(row.getCell(4).value) || 0,
            sort_order: Number(row.getCell(5).value) || variantsByProduct[productName].length,
          })
        })
        for (const [productName, varRows] of Object.entries(variantsByProduct)) {
          const product = nameToProduct[productName.toLowerCase()]
          if (!product) { skipped.push(`Variants for "${productName}" (no matching product — add it on the Products tab first)`); continue }
          await supabase.from('fundraising_variants').delete().eq('product_id', product.id)
          await supabase.from('fundraising_variants').insert(varRows.map(v => ({ product_id: product.id, ...v })))
          const total = varRows.reduce((s, v) => s + v.quantity_on_hand, 0)
          await supabase.from('fundraising_products').update({ quantity_on_hand: total }).eq('id', product.id)
          variantsReplaced++
        }
      }

      // ── Transactions (always new inserts) ──
      if (txSheet) {
        const { data: { user } } = await supabase.auth.getUser()
        for (let rowNumber = 2; rowNumber <= txSheet.rowCount; rowNumber++) {
          const row = txSheet.getRow(rowNumber)
          const dateCell = row.getCell(1).value
          const dateStr = dateCell instanceof Date ? dateCell.toISOString().slice(0, 10) : (dateCell ?? '').toString().trim()
          const typeLabel = (row.getCell(2).value ?? '').toString().trim()
          const amount = row.getCell(3).value
          if (!dateStr && !typeLabel && (amount === null || amount === undefined)) continue // fully blank row
          if (!dateStr || !typeLabel || amount === null || amount === undefined) {
            skipped.push(`Transaction row ${rowNumber} (missing Date, Type, or Amount)`)
            continue
          }
          const typeMatch = TX_TYPES.find(t => t.label.replace(/ \(.+\)/, '').toLowerCase() === typeLabel.toLowerCase())
          if (!typeMatch) { skipped.push(`Transaction row ${rowNumber} (unrecognized Type "${typeLabel}")`); continue }

          const fundLabel = (row.getCell(4).value ?? '').toString().trim()
          const fundMatch = FUND_SOURCES.find(f => f.label.toLowerCase() === fundLabel.toLowerCase())
          if (fundLabel && !fundMatch) { skipped.push(`Transaction row ${rowNumber} (unrecognized Fund Source "${fundLabel}")`); continue }

          const productName = (row.getCell(5).value ?? '').toString().trim()
          const optionValue = (row.getCell(6).value ?? '').toString().trim()
          const quantity = row.getCell(7).value
          const note = (row.getCell(8).value ?? '').toString().trim()

          let product = null, variant = null
          if (productName) {
            product = nameToProduct[productName.toLowerCase()]
            if (!product) { skipped.push(`Transaction row ${rowNumber} (no matching product "${productName}")`); continue }
            if (optionValue) {
              variant = (product.variants || []).find(v => v.option_value.toLowerCase() === optionValue.toLowerCase())
              if (!variant) { skipped.push(`Transaction row ${rowNumber} (no matching option "${optionValue}" on "${productName}")`); continue }
            }
          }

          const payload = {
            type: typeMatch.value,
            amount: Number(amount),
            fund_source: fundMatch?.value || 'general',
            product_id: product?.id || null,
            variant_id: variant?.id || null,
            quantity: quantity ? Number(quantity) : null,
            note: note || null,
            transaction_date: dateStr,
            created_by: user?.id || null,
          }
          const { error } = await supabase.from('fundraising_transactions').insert([payload])
          if (error) { skipped.push(`Transaction row ${rowNumber} (${error.message})`); continue }
          txAdded++

          if (product && quantity) {
            const delta = typeMatch.value === 'sale' ? -Number(quantity) : typeMatch.value === 'purchase' ? Number(quantity) : 0
            if (delta !== 0) {
              if (variant) {
                const newQty = Math.max(0, Number(variant.quantity_on_hand || 0) + delta)
                await supabase.from('fundraising_variants').update({ quantity_on_hand: newQty }).eq('id', variant.id)
                variant.quantity_on_hand = newQty
                const newTotal = (product.variants || []).reduce((s, v) => s + Number(v.quantity_on_hand || 0), 0)
                await supabase.from('fundraising_products').update({ quantity_on_hand: newTotal }).eq('id', product.id)
              } else {
                const newQty = Math.max(0, Number(product.quantity_on_hand || 0) + delta)
                await supabase.from('fundraising_products').update({ quantity_on_hand: newQty }).eq('id', product.id)
                product.quantity_on_hand = newQty
              }
            }
          }
        }
      }

      setBulkImportResult({ productsAdded, productsUpdated, variantsReplaced, txAdded, skipped })
      await load()
    } catch (err) {
      setBulkImportResult({ error: err.message })
    }
    setImportingBulk(false)
    e.target.value = ''
  }

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    setError('')
    const { data: prods, error: pErr } = await supabase.from('fundraising_products').select('*').order('name', { ascending: true })
    if (pErr) { setError(pErr.message); setLoading(false); return }

    const { data: variants, error: vErr } = await supabase.from('fundraising_variants').select('*').order('sort_order', { ascending: true })
    if (vErr) { setError(vErr.message); setLoading(false); return }

    const variantsByProduct = {}
    for (const v of variants || []) {
      if (!variantsByProduct[v.product_id]) variantsByProduct[v.product_id] = []
      variantsByProduct[v.product_id].push(v)
    }
    setProducts((prods || []).map(p => ({ ...p, variants: variantsByProduct[p.id] || [] })))

    const { data: txs, error: tErr } = await supabase.from('fundraising_transactions').select('*').order('transaction_date', { ascending: false }).order('created_at', { ascending: false })
    if (tErr) { setError(tErr.message); setLoading(false); return }
    setTransactions(txs || [])

    const { data: reqs, error: rErr } = await supabase.from('fundraising_order_requests').select('*').order('created_at', { ascending: false })
    if (!rErr) setRequests(reqs || [])

    setLoading(false)
  }

  async function updateRequestStatus(id, status) {
    setRequests(prev => prev.map(r => r.id === id ? { ...r, status } : r))
    await supabase.from('fundraising_order_requests').update({ status }).eq('id', id)
  }

  async function handleDeleteRequest(id) {
    if (!confirm('Delete this order request?')) return
    await supabase.from('fundraising_order_requests').delete().eq('id', id)
    setRequests(prev => prev.filter(r => r.id !== id))
  }

  const summary = useMemo(() => {
    const inventoryValue = products.reduce((s, p) => s + Number(p.cost || 0) * totalStock(p), 0)
    const moneyIn = transactions.filter(t => t.type === 'sale' || t.type === 'donation').reduce((s, t) => s + Number(t.amount || 0), 0)
    const moneyOut = transactions.filter(t => t.type === 'purchase').reduce((s, t) => s + Number(t.amount || 0), 0)
    const adjustments = transactions.filter(t => t.type === 'adjustment').reduce((s, t) => s + Number(t.amount || 0), 0)
    return { inventoryValue, moneyIn, moneyOut, adjustments, net: moneyIn - moneyOut + adjustments }
  }, [products, transactions])

  function openAddProduct() {
    setEditingProduct(null)
    setShowProductForm(true)
  }
  function openEditProduct(p) {
    setEditingProduct(p)
    setShowProductForm(true)
  }
  async function handleDeleteProduct(id) {
    if (!confirm('Delete this product? This does not delete past transactions tied to it.')) return
    await supabase.from('fundraising_products').delete().eq('id', id)
    load()
  }

  async function handleDeleteTx(id) {
    if (!confirm('Delete this transaction? This does not undo any inventory change it made.')) return
    await supabase.from('fundraising_transactions').delete().eq('id', id)
    load()
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Fundraising</h1>
          <div style={{ display: 'flex', gap: '6px', marginTop: '10px' }}>
            <button
              className={tab === 'inventory' ? 'btn btn-primary btn-sm' : 'btn btn-secondary btn-sm'}
              onClick={() => setTab('inventory')}
            >Inventory</button>
            <button
              className={tab === 'ledger' ? 'btn btn-primary btn-sm' : 'btn btn-secondary btn-sm'}
              onClick={() => setTab('ledger')}
            >Money In / Out</button>
            <button
              className={tab === 'requests' ? 'btn btn-primary btn-sm' : 'btn btn-secondary btn-sm'}
              onClick={() => setTab('requests')}
            >Order Requests{requests.filter(r => r.status === 'new').length > 0 ? ` (${requests.filter(r => r.status === 'new').length})` : ''}</button>
          </div>
        </div>
        {tab === 'inventory' ? (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button className="btn btn-secondary" onClick={handleExportZettle} disabled={exportingZettle}>
              {exportingZettle ? 'Exporting…' : '📤 Export to Zettle CSV'}
            </button>
            <button className="btn btn-secondary" onClick={handleDownloadBulkTemplate}>📝 Bulk Template</button>
            <button className="btn btn-secondary" onClick={() => bulkFileInputRef.current?.click()} disabled={importingBulk}>
              {importingBulk ? 'Importing…' : '⬆ Upload Bulk'}
            </button>
            <input ref={bulkFileInputRef} type="file" accept=".xlsx,.xls" style={{ display: 'none' }} onChange={handleImportBulkTemplate} />
            <button className="btn btn-primary" onClick={openAddProduct}>+ Add Product</button>
          </div>
        ) : tab === 'ledger' ? (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button className="btn btn-secondary" onClick={handleDownloadBulkTemplate}>📝 Bulk Template</button>
            <button className="btn btn-secondary" onClick={() => bulkFileInputRef.current?.click()} disabled={importingBulk}>
              {importingBulk ? 'Importing…' : '⬆ Upload Bulk'}
            </button>
            <input ref={bulkFileInputRef} type="file" accept=".xlsx,.xls" style={{ display: 'none' }} onChange={handleImportBulkTemplate} />
            <button className="btn btn-primary" onClick={() => setShowTxForm(true)}>+ Log Transaction</button>
          </div>
        ) : null}
      </div>

      {bulkImportResult && (
        <div style={{ fontSize: '12px', color: bulkImportResult.error ? 'var(--danger)' : 'var(--gray-600)', margin: '0 24px 12px', padding: '8px 12px', background: 'var(--gray-50)', borderRadius: '6px' }}>
          {bulkImportResult.error || `Products — added ${bulkImportResult.productsAdded}, updated ${bulkImportResult.productsUpdated}. Variant sets replaced: ${bulkImportResult.variantsReplaced}. Transactions added: ${bulkImportResult.txAdded}.${bulkImportResult.skipped?.length ? ` Skipped: ${bulkImportResult.skipped.join('; ')}` : ''}`}
        </div>
      )}

      {exportError && (
        <div className="alert alert-error" style={{ margin: '0 24px 12px' }}>{exportError}</div>
      )}

      <div className="page-body">
        {error && <div className="alert alert-error" style={{ marginBottom: '16px' }}>{error}</div>}

        {/* Summary strip */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '12px', marginBottom: '20px' }}>
          <SummaryCard label="Inventory Value (cost)" value={money(summary.inventoryValue)} />
          <SummaryCard label="Money In" value={money(summary.moneyIn)} tone="good" />
          <SummaryCard label="Money Out" value={money(summary.moneyOut)} tone="bad" />
          <SummaryCard label="Net" value={money(summary.net)} tone={summary.net >= 0 ? 'good' : 'bad'} />
        </div>

        {loading ? <div className="spinner" /> : tab === 'inventory' ? (
          <InventoryGrid products={products} onEdit={openEditProduct} onDelete={handleDeleteProduct} />
        ) : tab === 'ledger' ? (
          <LedgerTable transactions={transactions} products={products} onDelete={handleDeleteTx} />
        ) : (
          <RequestsTable requests={requests} onStatusChange={updateRequestStatus} onDelete={handleDeleteRequest} />
        )}
      </div>

      {showProductForm && (
        <ProductFormModal
          product={editingProduct}
          onClose={() => setShowProductForm(false)}
          onSaved={() => { setShowProductForm(false); load() }}
        />
      )}
      {showTxForm && (
        <TransactionFormModal
          products={products}
          onClose={() => setShowTxForm(false)}
          onSaved={() => { setShowTxForm(false); load() }}
        />
      )}
    </div>
  )
}

function SummaryCard({ label, value, tone }) {
  const color = tone === 'good' ? 'var(--burgundy)' : tone === 'bad' ? 'var(--danger)' : 'var(--gray-800)'
  return (
    <div className="card" style={{ textAlign: 'center', padding: '14px' }}>
      <div style={{ fontSize: '20px', fontWeight: 700, color }}>{value}</div>
      <div style={{ fontSize: '11px', color: 'var(--gray-400)', textTransform: 'uppercase', letterSpacing: '0.5px', marginTop: '4px' }}>{label}</div>
    </div>
  )
}

// ── Inventory ──────────────────────────────────────────────────────────
function InventoryGrid({ products, onEdit, onDelete }) {
  if (products.length === 0) {
    return <div className="empty-state"><div className="icon">💰</div><p>No fundraising products yet. Add one above.</p></div>
  }
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '14px' }}>
      {products.map(p => {
        const margin = Number(p.sale_price || 0) - Number(p.cost || 0)
        const stock = totalStock(p)
        const hasVariants = p.variants && p.variants.length > 0
        return (
          <div key={p.id} className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <div style={{ aspectRatio: '4/3', background: 'var(--gray-100)' }}>
              {p.image_url ? (
                <img src={p.image_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              ) : (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', fontSize: '32px', color: 'var(--gray-200)' }}>🖼️</div>
              )}
            </div>
            {hasVariants && (
              <div style={{ display: 'flex', gap: '4px', padding: '8px 14px 0', overflowX: 'auto' }}>
                {p.variants.map(v => (
                  <img
                    key={v.id}
                    src={v.image_url || p.image_url}
                    alt={v.option_value}
                    title={`${v.option_value} — ${v.quantity_on_hand} in stock`}
                    style={{ width: '32px', height: '32px', objectFit: 'cover', borderRadius: '6px', border: '1px solid var(--gray-200)', flexShrink: 0 }}
                  />
                ))}
              </div>
            )}
            <div style={{ padding: '12px 14px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '6px' }}>
                <div style={{ fontSize: '14px', fontWeight: 700, color: 'var(--gray-800)' }}>{p.name}</div>
                {p.is_public && <span style={{ fontSize: '10px', fontWeight: 700, color: 'var(--burgundy)', background: 'var(--burgundy-light)', padding: '2px 6px', borderRadius: '4px', flexShrink: 0 }}>PUBLIC</span>}
                {p.is_christian_ed_item && <span style={{ fontSize: '10px', fontWeight: 700, color: '#1565c0', background: '#e3f2fd', padding: '2px 6px', borderRadius: '4px', flexShrink: 0 }}>CE</span>}
              </div>
              <div style={{ fontSize: '12px', color: 'var(--gray-400)', marginTop: '2px' }}>{FUND_LABEL[p.fund_source] || p.fund_source}</div>

              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '10px', fontSize: '12px' }}>
                <span style={{ color: 'var(--gray-600)' }}>Cost {money(p.cost)}</span>
                <span style={{ color: 'var(--gray-600)' }}>Sells {money(p.sale_price)}</span>
              </div>
              <div style={{ fontSize: '11px', color: margin >= 0 ? 'var(--gray-400)' : 'var(--danger)', marginTop: '2px' }}>
                Margin {money(margin)} / item
              </div>
              <div style={{ fontSize: '13px', fontWeight: 700, color: stock <= 0 ? 'var(--danger)' : 'var(--gray-800)', marginTop: '8px' }}>
                {stock} in stock{hasVariants ? ` (${p.variants.length} options)` : ''}
              </div>

              <div style={{ display: 'flex', gap: '8px', marginTop: '10px' }}>
                <button className="btn btn-secondary btn-sm" style={{ flex: 1 }} onClick={() => onEdit(p)}>Edit</button>
                <button className="btn btn-danger btn-sm" onClick={() => onDelete(p.id)}>Delete</button>
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}

let variantKeySeq = 0
function newVariantRow(v) {
  return {
    key: v?.id || `new-${variantKeySeq++}`,
    id: v?.id || null,
    value: v?.option_value || '',
    quantity: v?.quantity_on_hand ?? 0,
    existingImageUrl: v?.image_url || null,
    imageFile: null,
    imagePreview: v?.image_url || null,
    removed: false,
  }
}

function ProductFormModal({ product, onClose, onSaved }) {
  const isEdit = !!product
  const [name, setName] = useState(product?.name || '')
  const [description, setDescription] = useState(product?.description || '')
  const [cost, setCost] = useState(product?.cost ?? '')
  const [salePrice, setSalePrice] = useState(product?.sale_price ?? '')
  const [fundSource, setFundSource] = useState(product?.fund_source || 'general')
  const [vendor, setVendor] = useState(product?.vendor || '')
  const [quantity, setQuantity] = useState(product?.quantity_on_hand ?? 0)
  const [isPublic, setIsPublic] = useState(product?.is_public || false)
  const [isChristianEd, setIsChristianEd] = useState(product?.is_christian_ed_item || false)
  const [imageFile, setImageFile] = useState(null)
  const [imagePreview, setImagePreview] = useState(product?.image_url || null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const [optionName, setOptionName] = useState(product?.variants?.[0]?.option_name || '')
  const [variantRows, setVariantRows] = useState((product?.variants || []).map(newVariantRow))

  const activeVariantRows = variantRows.filter(r => !r.removed)
  const hasVariants = activeVariantRows.length > 0
  const variantTotal = activeVariantRows.reduce((s, r) => s + Number(r.quantity || 0), 0)

  function handleImageChange(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setImageFile(file)
    setImagePreview(URL.createObjectURL(file))
  }

  function addVariantRow() {
    setVariantRows(rows => [...rows, newVariantRow()])
  }
  function updateVariantRow(key, field, value) {
    setVariantRows(rows => rows.map(r => r.key === key ? { ...r, [field]: value } : r))
  }
  function handleVariantImageChange(key, e) {
    const file = e.target.files?.[0]
    if (!file) return
    setVariantRows(rows => rows.map(r => r.key === key ? { ...r, imageFile: file, imagePreview: URL.createObjectURL(file) } : r))
  }
  function removeVariantRow(key) {
    setVariantRows(rows => rows.map(r => r.key === key ? { ...r, removed: true } : r).filter(r => r.id || !r.removed))
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setSaving(true)
    setError('')
    try {
      let imageUrl = product?.image_url || null
      if (imageFile) imageUrl = await uploadToStorage(imageFile)

      const payload = {
        name,
        description: description || null,
        cost: Number(cost) || 0,
        sale_price: Number(salePrice) || 0,
        fund_source: fundSource,
        vendor: vendor || null,
        quantity_on_hand: hasVariants ? variantTotal : (Number(quantity) || 0),
        is_public: isPublic,
        is_christian_ed_item: isPublic ? isChristianEd : false,
        image_url: imageUrl,
      }

      let productId = product?.id
      if (isEdit) {
        const { error: err } = await supabase.from('fundraising_products').update(payload).eq('id', product.id)
        if (err) throw err
      } else {
        const { data, error: err } = await supabase.from('fundraising_products').insert([payload]).select().single()
        if (err) throw err
        productId = data.id
      }

      // Removed existing variants
      const toDelete = variantRows.filter(r => r.removed && r.id).map(r => r.id)
      if (toDelete.length > 0) {
        const { error: delErr } = await supabase.from('fundraising_variants').delete().in('id', toDelete)
        if (delErr) throw delErr
      }

      // Add/update remaining variants
      for (const [index, row] of activeVariantRows.entries()) {
        let variantImageUrl = row.existingImageUrl
        if (row.imageFile) variantImageUrl = await uploadToStorage(row.imageFile)

        const variantPayload = {
          product_id: productId,
          option_name: optionName || 'Option',
          option_value: row.value,
          image_url: variantImageUrl,
          quantity_on_hand: Number(row.quantity) || 0,
          sort_order: index,
        }
        if (row.id) {
          const { error: vErr } = await supabase.from('fundraising_variants').update(variantPayload).eq('id', row.id)
          if (vErr) throw vErr
        } else {
          const { error: vErr } = await supabase.from('fundraising_variants').insert([variantPayload])
          if (vErr) throw vErr
        }
      }

      onSaved()
    } catch (err) {
      setError(err.message)
    }
    setSaving(false)
  }

  return (
    <Modal title={isEdit ? 'Edit Product' : 'Add Product'} onClose={onClose}>
      <form onSubmit={handleSubmit}>
        <div className="form-group">
          <label className="form-label">Name</label>
          <input className="form-input" value={name} onChange={e => setName(e.target.value)} required />
        </div>
        <div className="form-group">
          <label className="form-label">Description</label>
          <textarea className="form-input" rows={2} value={description} onChange={e => setDescription(e.target.value)} />
        </div>
        <div style={{ display: 'flex', gap: '10px' }}>
          <div className="form-group" style={{ flex: 1 }}>
            <label className="form-label">Cost (per item)</label>
            <input className="form-input" type="number" step="0.01" min="0" value={cost} onChange={e => setCost(e.target.value)} required />
          </div>
          <div className="form-group" style={{ flex: 1 }}>
            <label className="form-label">Sale Price</label>
            <input className="form-input" type="number" step="0.01" min="0" value={salePrice} onChange={e => setSalePrice(e.target.value)} required />
          </div>
        </div>
        <div style={{ display: 'flex', gap: '10px' }}>
          <div className="form-group" style={{ flex: 1 }}>
            <label className="form-label">Fund Source</label>
            <select className="form-select" value={fundSource} onChange={e => setFundSource(e.target.value)}>
              {FUND_SOURCES.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
            </select>
          </div>
          <div className="form-group" style={{ flex: 1 }}>
            <label className="form-label">{hasVariants ? 'Quantity on Hand (total)' : 'Quantity on Hand'}</label>
            {hasVariants ? (
              <input className="form-input" type="number" value={variantTotal} disabled style={{ background: 'var(--gray-100)', color: 'var(--gray-600)' }} />
            ) : (
              <input className="form-input" type="number" min="0" value={quantity} onChange={e => setQuantity(e.target.value)} required />
            )}
          </div>
        </div>
        <div className="form-group">
          <label className="form-label">Vendor / Source (optional)</label>
          <input className="form-input" value={vendor} onChange={e => setVendor(e.target.value)} placeholder="e.g. purchased from [small business name]" />
        </div>
        <div className="form-group">
          <label className="form-label">Cover Photo</label>
          <input type="file" accept="image/*" onChange={handleImageChange} style={{ fontSize: '13px' }} />
          {imagePreview && <img src={imagePreview} alt="" style={{ width: '100%', maxWidth: '200px', borderRadius: '8px', marginTop: '6px', display: 'block' }} />}
          <div style={{ fontSize: '11px', color: 'var(--gray-400)', marginTop: '4px' }}>
            Used as the main thumbnail. If this product has options below, each option can also have its own photo.
          </div>
        </div>

        <div className="form-group">
          <label className="form-label">Options (optional)</label>
          <input
            className="form-input"
            value={optionName}
            onChange={e => setOptionName(e.target.value)}
            placeholder="e.g. Color, Size — leave blank if this product has no options"
            style={{ marginBottom: '10px' }}
          />

          {activeVariantRows.map(row => (
            <div key={row.key} style={{ border: '1px solid var(--gray-200)', borderRadius: '8px', padding: '10px', marginBottom: '8px' }}>
              <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-start' }}>
                <div style={{ flex: 2 }}>
                  <input
                    className="form-input"
                    value={row.value}
                    onChange={e => updateVariantRow(row.key, 'value', e.target.value)}
                    placeholder="Value, e.g. Black"
                  />
                </div>
                <div style={{ flex: 1 }}>
                  <input
                    className="form-input"
                    type="number"
                    min="0"
                    value={row.quantity}
                    onChange={e => updateVariantRow(row.key, 'quantity', e.target.value)}
                    placeholder="Stock"
                  />
                </div>
                <button type="button" onClick={() => removeVariantRow(row.key)} style={{ background: 'none', border: 'none', color: 'var(--danger)', cursor: 'pointer', fontSize: '15px', padding: '8px 4px' }}>✕</button>
              </div>
              <div style={{ marginTop: '8px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <input type="file" accept="image/*" onChange={e => handleVariantImageChange(row.key, e)} style={{ fontSize: '12px' }} />
                {row.imagePreview && <img src={row.imagePreview} alt="" style={{ width: '36px', height: '36px', objectFit: 'cover', borderRadius: '6px' }} />}
              </div>
            </div>
          ))}

          <button type="button" className="btn btn-secondary btn-sm" onClick={addVariantRow}>+ Add Option</button>
        </div>

        <label className="checkbox-label" style={{ marginBottom: '10px' }}>
          <input type="checkbox" checked={isPublic} onChange={e => setIsPublic(e.target.checked)} />
          Show on the public website fundraising page
        </label>

        {isPublic && (
          <label className="checkbox-label" style={{ marginBottom: '10px', marginLeft: '24px' }}>
            <input type="checkbox" checked={isChristianEd} onChange={e => setIsChristianEd(e.target.checked)} />
            This is a Christian Ed item (shows on the Christian Education page's listing)
          </label>
        )}

        {error && <div className="alert alert-error" style={{ marginBottom: '10px' }}>{error}</div>}

        <button type="submit" className="btn btn-primary btn-lg" style={{ width: '100%' }} disabled={saving}>
          {saving ? 'Saving…' : isEdit ? 'Save Changes' : 'Add Product'}
        </button>
      </form>
    </Modal>
  )
}

// ── Ledger ─────────────────────────────────────────────────────────────
const REQUEST_STATUS_LABELS = { new: 'New', contacted: 'Contacted', fulfilled: 'Fulfilled', cancelled: 'Cancelled' }
const REQUEST_STATUS_COLORS = {
  new: { bg: '#fdecea', fg: '#c0392b' },
  contacted: { bg: '#fff8e7', fg: '#b8860b' },
  fulfilled: { bg: '#e6f4ea', fg: '#2d7a4f' },
  cancelled: { bg: '#eee', fg: '#888' },
}

function RequestsTable({ requests, onStatusChange, onDelete }) {
  if (requests.length === 0) {
    return <div className="empty-state"><div className="icon">📬</div><p>No order requests yet — these come in from the Christian Ed page on the website.</p></div>
  }
  return (
    <div className="card">
      <table className="data-table">
        <thead>
          <tr>
            <th>Requested</th>
            <th>Item</th>
            <th>Qty</th>
            <th>Requester</th>
            <th>Contact</th>
            <th>Notes</th>
            <th>Status</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {requests.map(r => {
            const c = REQUEST_STATUS_COLORS[r.status] || REQUEST_STATUS_COLORS.new
            return (
              <tr key={r.id}>
                <td>{new Date(r.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</td>
                <td>{r.product_name}{r.variant_label ? ` — ${r.variant_label}` : ''}</td>
                <td>{r.quantity}</td>
                <td>{r.requester_name}</td>
                <td>{r.requester_contact}</td>
                <td style={{ maxWidth: '200px', fontSize: '12px', color: 'var(--gray-600)' }}>{r.notes || '—'}</td>
                <td>
                  <select
                    value={r.status}
                    onChange={e => onStatusChange(r.id, e.target.value)}
                    style={{ background: c.bg, color: c.fg, border: 'none', borderRadius: '6px', padding: '4px 8px', fontSize: '12px', fontWeight: 600 }}
                  >
                    {Object.entries(REQUEST_STATUS_LABELS).map(([v, label]) => <option key={v} value={v}>{label}</option>)}
                  </select>
                </td>
                <td>
                  <button onClick={() => onDelete(r.id)} style={{ background: 'none', border: 'none', color: 'var(--danger)', cursor: 'pointer', fontSize: '12px' }}>Delete</button>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function LedgerTable({ transactions, products, onDelete }) {
  const productName = (id) => products.find(p => p.id === id)?.name || '—'
  const variantLabel = (productId, variantId) => {
    if (!variantId) return ''
    const v = products.find(p => p.id === productId)?.variants?.find(v => v.id === variantId)
    return v ? ` — ${v.option_value}` : ''
  }

  if (transactions.length === 0) {
    return <div className="empty-state"><div className="icon">🧾</div><p>No transactions logged yet.</p></div>
  }
  return (
    <div className="card">
      <table className="data-table">
        <thead>
          <tr>
            <th>Date</th>
            <th>Type</th>
            <th>Product</th>
            <th>Fund Source</th>
            <th>Amount</th>
            <th>Note</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {transactions.map(t => {
            const c = TX_COLORS[t.type] || TX_COLORS.adjustment
            return (
              <tr key={t.id}>
                <td>{fmtDate(t.transaction_date)}</td>
                <td>
                  <span style={{ background: c.bg, color: c.fg, padding: '3px 10px', borderRadius: 20, fontSize: 12, fontWeight: 600 }}>
                    {TX_TYPES.find(x => x.value === t.type)?.label.split(' (')[0] || t.type}
                  </span>
                </td>
                <td>{t.product_id ? productName(t.product_id) + variantLabel(t.product_id, t.variant_id) : '—'}</td>
                <td style={{ fontSize: '13px', color: 'var(--gray-600)' }}>{FUND_LABEL[t.fund_source] || t.fund_source}</td>
                <td style={{ fontWeight: 700 }}>{money(t.amount)}</td>
                <td style={{ fontSize: '13px', color: 'var(--gray-600)', maxWidth: '220px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.note}</td>
                <td>
                  <button onClick={() => onDelete(t.id)} style={{ background: 'none', border: 'none', color: 'var(--danger)', cursor: 'pointer', fontSize: '13px' }}>✕</button>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function TransactionFormModal({ products, onClose, onSaved }) {
  const [type, setType] = useState('sale')
  const [amount, setAmount] = useState('')
  const [fundSource, setFundSource] = useState('general')
  const [productId, setProductId] = useState('')
  const [variantId, setVariantId] = useState('')
  const [quantity, setQuantity] = useState('')
  const [note, setNote] = useState('')
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const selectedProduct = products.find(p => p.id === productId)
  const hasVariants = selectedProduct?.variants?.length > 0

  function handleProductChange(id) {
    setProductId(id)
    setVariantId('') // reset — a new product's options don't match the old selection
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (hasVariants && !variantId) { setError('Please choose which option this transaction is for.'); return }
    setSaving(true)
    setError('')
    try {
      const { data: { user } } = await supabase.auth.getUser()
      const payload = {
        type,
        amount: Number(amount),
        fund_source: fundSource,
        product_id: productId || null,
        variant_id: variantId || null,
        quantity: quantity ? Number(quantity) : null,
        note: note || null,
        transaction_date: date,
        created_by: user?.id || null,
      }
      const { error: err } = await supabase.from('fundraising_transactions').insert([payload])
      if (err) throw err

      // Keep inventory in sync when a transaction is tied to a product + quantity
      if (productId && quantity) {
        const delta = type === 'sale' ? -Number(quantity) : type === 'purchase' ? Number(quantity) : 0
        if (delta !== 0 && selectedProduct) {
          if (variantId) {
            const variant = selectedProduct.variants.find(v => v.id === variantId)
            const newVariantQty = Math.max(0, Number(variant?.quantity_on_hand || 0) + delta)
            await supabase.from('fundraising_variants').update({ quantity_on_hand: newVariantQty }).eq('id', variantId)

            // Keep the product's cached total in sync with its options.
            const newTotal = selectedProduct.variants.reduce((s, v) => s + (v.id === variantId ? newVariantQty : Number(v.quantity_on_hand || 0)), 0)
            await supabase.from('fundraising_products').update({ quantity_on_hand: newTotal }).eq('id', productId)
          } else {
            await supabase.from('fundraising_products')
              .update({ quantity_on_hand: Math.max(0, Number(selectedProduct.quantity_on_hand || 0) + delta) })
              .eq('id', productId)
          }
        }
      }
      onSaved()
    } catch (err) {
      setError(err.message)
    }
    setSaving(false)
  }

  return (
    <Modal title="Log Transaction" onClose={onClose}>
      <form onSubmit={handleSubmit}>
        <div className="form-group">
          <label className="form-label">Type</label>
          <select className="form-select" value={type} onChange={e => setType(e.target.value)}>
            {TX_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </div>
        <div style={{ display: 'flex', gap: '10px' }}>
          <div className="form-group" style={{ flex: 1 }}>
            <label className="form-label">Amount</label>
            <input className="form-input" type="number" step="0.01" min="0" value={amount} onChange={e => setAmount(e.target.value)} required />
          </div>
          <div className="form-group" style={{ flex: 1 }}>
            <label className="form-label">Date</label>
            <input className="form-input" type="date" value={date} onChange={e => setDate(e.target.value)} required />
          </div>
        </div>
        <div className="form-group">
          <label className="form-label">Fund Source</label>
          <select className="form-select" value={fundSource} onChange={e => setFundSource(e.target.value)}>
            {FUND_SOURCES.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
          </select>
        </div>
        <div style={{ display: 'flex', gap: '10px' }}>
          <div className="form-group" style={{ flex: 1 }}>
            <label className="form-label">Product (optional)</label>
            <select className="form-select" value={productId} onChange={e => handleProductChange(e.target.value)}>
              <option value="">— None —</option>
              {products.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          <div className="form-group" style={{ flex: 1 }}>
            <label className="form-label">Quantity (optional)</label>
            <input className="form-input" type="number" min="0" value={quantity} onChange={e => setQuantity(e.target.value)} disabled={!productId} />
          </div>
        </div>
        {hasVariants && (
          <div className="form-group">
            <label className="form-label">Option *</label>
            <select className="form-select" value={variantId} onChange={e => setVariantId(e.target.value)} required>
              <option value="">— Choose which option —</option>
              {selectedProduct.variants.map(v => (
                <option key={v.id} value={v.id}>{v.option_value} ({v.quantity_on_hand} in stock)</option>
              ))}
            </select>
          </div>
        )}
        {productId && quantity && (
          <div style={{ fontSize: '12px', color: 'var(--gray-400)', marginTop: '-8px', marginBottom: '10px' }}>
            {type === 'sale' && `This will reduce inventory by ${quantity}${variantId ? ` for ${selectedProduct.variants.find(v => v.id === variantId)?.option_value}` : ''}.`}
            {type === 'purchase' && `This will add ${quantity} to inventory${variantId ? ` for ${selectedProduct.variants.find(v => v.id === variantId)?.option_value}` : ''}.`}
          </div>
        )}
        <div className="form-group">
          <label className="form-label">Note</label>
          <textarea className="form-input" rows={2} value={note} onChange={e => setNote(e.target.value)} />
        </div>

        {error && <div className="alert alert-error" style={{ marginBottom: '10px' }}>{error}</div>}

        <button type="submit" className="btn btn-primary btn-lg" style={{ width: '100%' }} disabled={saving}>
          {saving ? 'Saving…' : 'Log Transaction'}
        </button>
      </form>
    </Modal>
  )
}

function Modal({ title, children, onClose }) {
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', overflowY: 'auto', padding: '40px 16px' }}
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{ background: 'white', borderRadius: 14, padding: 24, width: '100%', maxWidth: 480 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h2 style={{ margin: 0, color: 'var(--burgundy)', fontFamily: 'var(--font-display)', fontSize: 20 }}>{title}</h2>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 22, cursor: 'pointer', color: 'var(--gray-400)' }}>×</button>
        </div>
        {children}
      </div>
    </div>
  )
}