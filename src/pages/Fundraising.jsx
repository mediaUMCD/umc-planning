import { useState, useEffect, useMemo } from 'react'
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
  const [tab, setTab] = useState('inventory') // 'inventory' | 'ledger'
  const [products, setProducts] = useState([])
  const [transactions, setTransactions] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [showProductForm, setShowProductForm] = useState(false)
  const [editingProduct, setEditingProduct] = useState(null) // null = add mode
  const [showTxForm, setShowTxForm] = useState(false)
  const [exportingZettle, setExportingZettle] = useState(false)
  const [exportError, setExportError] = useState('')

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
    setLoading(false)
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
          </div>
        </div>
        {tab === 'inventory' ? (
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-secondary" onClick={handleExportZettle} disabled={exportingZettle}>
              {exportingZettle ? 'Exporting…' : '📤 Export to Zettle CSV'}
            </button>
            <button className="btn btn-primary" onClick={openAddProduct}>+ Add Product</button>
          </div>
        ) : (
          <button className="btn btn-primary" onClick={() => setShowTxForm(true)}>+ Log Transaction</button>
        )}
      </div>

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
        ) : (
          <LedgerTable transactions={transactions} products={products} onDelete={handleDeleteTx} />
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

        {error && <div className="alert alert-error" style={{ marginBottom: '10px' }}>{error}</div>}

        <button type="submit" className="btn btn-primary btn-lg" style={{ width: '100%' }} disabled={saving}>
          {saving ? 'Saving…' : isEdit ? 'Save Changes' : 'Add Product'}
        </button>
      </form>
    </Modal>
  )
}

// ── Ledger ─────────────────────────────────────────────────────────────
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