/**
 * Listing & mapping request forms (Dashboard → Listings & Mapping). One schema drives the browser form and the API
 * validation, so both always agree. FLIPKART_MAPPING follows the owner's field list exactly (6 Nov 2026); the other
 * three are drafts from the marketplaces' standard fields until the owner's brief arrives.
 */
export type Marketplace = 'FLIPKART' | 'AMAZON';
export type FormKind = 'MAPPING' | 'NEW_LISTING';
export type FieldType = 'text' | 'textarea' | 'number' | 'money' | 'select' | 'date' | 'url';
export interface Field {
  key: string; label: string; type: FieldType; required?: boolean; options?: string[]; unit?: string;
  help?: string; placeholder?: string; min?: number; max?: number; maxLength?: number;
}
export interface Section { title: string; note?: string; fields: Field[] }
export interface FormDef { marketplace: Marketplace; kind: FormKind; title: string; intro: string; draft: boolean; sections: Section[] }

const COUNTRIES = ['India', 'China', 'Bangladesh', 'Vietnam', 'Sri Lanka', 'Nepal', 'Thailand', 'Indonesia', 'Malaysia', 'Taiwan', 'South Korea', 'Japan', 'Turkey', 'United Arab Emirates', 'Germany', 'Italy', 'United Kingdom', 'United States', 'Other'];
/** MinOQ is offered only in some categories, and starts with 1 or 2. */
const MINOQ = ['1', '2'];
const GST = ['GST_0', 'GST_3', 'GST_5', 'GST_12', 'GST_18', 'GST_28', 'GST_APPAREL'];

const manufacturing: Section = {
  title: 'Manufacturing Details',
  fields: [
    { key: 'countryOfOrigin', label: 'Country Of Origin', type: 'select', required: true, options: COUNTRIES },
    { key: 'manufacturerDetails', label: 'Manufacturer Details', type: 'textarea', required: true, placeholder: 'Name and full address', maxLength: 500 },
    { key: 'packerDetails', label: 'Packer Details', type: 'textarea', required: true, placeholder: 'Name and full address', maxLength: 500 },
    { key: 'importerDetails', label: 'Importer Details', type: 'textarea', placeholder: 'Only for imported products', maxLength: 500 },
    { key: 'manufacturingDate', label: 'Manufacturing date', type: 'date' },
    { key: 'shelfLifeMonths', label: 'Shelf Life', type: 'number', unit: 'Months', min: 0, max: 600 },
  ],
};
const packageDetails: Section = {
  title: 'Package details',
  fields: [
    { key: 'lengthCm', label: 'Length', type: 'number', unit: 'cms', min: 0, max: 1000 },
    { key: 'breadthCm', label: 'Breadth', type: 'number', unit: 'cms', min: 0, max: 1000 },
    { key: 'heightCm', label: 'Height', type: 'number', unit: 'cms', min: 0, max: 1000 },
    { key: 'weightKg', label: 'Weight', type: 'number', unit: 'Kgs', min: 0, max: 1000 },
  ],
};

const flipkartCommercial: Section[] = [
  { title: 'Listing information', fields: [{ key: 'sellerSku', label: 'Seller SKU ID', type: 'text', required: true, maxLength: 64, placeholder: 'Your own SKU code' }] },
  { title: 'Status Details', fields: [{ key: 'listingStatus', label: 'Listing Status', type: 'select', required: true, options: ['Active', 'Inactive'] }] },
  {
    title: 'Price details',
    note: 'Recommended price: your manager checks Flipkart’s recommended price and your earnings (fees, shipping) before the listing goes live. Sellers who accepted Flipkart recommended price have realised 20% increase in units.',
    fields: [
      { key: 'mrp', label: 'MRP', type: 'money', required: true, unit: 'INR', min: 1 },
      { key: 'sellingPrice', label: 'Your selling price', type: 'money', required: true, unit: 'INR', min: 1, help: 'You can change this price if needed' },
      { key: 'minOrderQty', label: 'Minimum Order Quantity (MinOQ)', type: 'select', options: MINOQ, help: 'Only if Flipkart offers MinOQ in your category' },
    ],
  },
  {
    title: 'Inventory details',
    fields: [
      { key: 'fulfilmentBy', label: 'Fullfilment by', type: 'select', required: true, options: ['Seller', 'Flipkart (FBF)'] },
      { key: 'procurementType', label: 'Procurement type', type: 'select', options: ['Instock', 'Express', 'Domestic procurement', 'International procurement', 'Made to order'] },
      { key: 'procurementSlaDays', label: 'Procurement SLA', type: 'number', required: true, unit: 'days', min: 0, max: 60 },
      { key: 'stock', label: 'Stock', type: 'number', required: true, min: 0, max: 1_000_000 },
    ],
  },
  { title: 'Shipping provider', fields: [{ key: 'shippingProvider', label: 'Shipping provider', type: 'select', options: ['Flipkart', 'Seller'] }] },
  {
    title: 'Handling Fee Charged To Customer',
    fields: [
      { key: 'localHandlingFee', label: 'Local handling fee', type: 'money', unit: 'INR', min: 0 },
      { key: 'zonalHandlingFee', label: 'Zonal handling fee', type: 'money', unit: 'INR', min: 0 },
      { key: 'nationalHandlingFee', label: 'National handling fee', type: 'money', unit: 'INR', min: 0 },
    ],
  },
  packageDetails,
  {
    title: 'Tax details',
    fields: [
      { key: 'hsn', label: 'HSN', type: 'text', required: true, placeholder: '4–8 digit HSN code', help: 'Find relevant HSN codes on the GST portal or ask your manager' },
      { key: 'luxuryCessPct', label: 'Luxury Cess', type: 'number', unit: 'Percentage', min: 0, max: 100 },
      { key: 'taxCode', label: 'Tax Code', type: 'select', required: true, options: GST, help: 'Find relevant Tax codes: GST rate for your HSN' },
    ],
  },
  manufacturing,
];

const amazonCommercial: Section[] = [
  { title: 'Offer', fields: [
    { key: 'sellerSku', label: 'Seller SKU', type: 'text', required: true, maxLength: 64 },
    { key: 'condition', label: 'Condition', type: 'select', required: true, options: ['New', 'Renewed', 'Used - Like New', 'Used - Very Good', 'Used - Good'] },
  ] },
  { title: 'Price details', fields: [
    { key: 'mrp', label: 'Maximum Retail Price (MRP)', type: 'money', required: true, unit: 'INR', min: 1 },
    { key: 'sellingPrice', label: 'Your price', type: 'money', required: true, unit: 'INR', min: 1 },
    { key: 'minOrderQty', label: 'Minimum Order Quantity', type: 'select', options: MINOQ, help: 'Only if your category supports it' },
  ] },
  { title: 'Inventory details', fields: [
    { key: 'fulfilmentChannel', label: 'Fulfilment channel', type: 'select', required: true, options: ['Easy Ship (Amazon delivers)', 'Self Ship', 'Fulfilled by Amazon (FBA)', 'Seller Flex'] },
    { key: 'stock', label: 'Quantity', type: 'number', required: true, min: 0, max: 1_000_000 },
    { key: 'handlingTimeDays', label: 'Handling time', type: 'number', unit: 'days', min: 0, max: 30 },
  ] },
  packageDetails,
  { title: 'Tax details', fields: [
    { key: 'hsn', label: 'HSN', type: 'text', required: true, placeholder: '4–8 digit HSN code' },
    { key: 'taxCode', label: 'GST rate', type: 'select', required: true, options: GST },
  ] },
  manufacturing,
];

const productInfo = (mp: Marketplace): Section => ({
  title: 'Product information',
  fields: [
    { key: 'productTitle', label: 'Product title', type: 'text', required: true, maxLength: 200 },
    { key: 'brand', label: 'Brand', type: 'text', required: true, maxLength: 80 },
    { key: 'category', label: mp === 'FLIPKART' ? 'Vertical / category' : 'Product type / category', type: 'text', required: true, maxLength: 120 },
    { key: 'productIdType', label: 'Product ID type', type: 'select', options: ['EAN', 'UPC', 'GTIN', 'ISBN', 'No barcode (brand registered)'] },
    { key: 'productId', label: 'Product ID (barcode number)', type: 'text', maxLength: 20 },
    { key: 'keyFeatures', label: mp === 'FLIPKART' ? 'Key features' : 'Bullet points', type: 'textarea', required: true, maxLength: 2000, placeholder: 'One per line' },
    { key: 'description', label: 'Description', type: 'textarea', required: true, maxLength: 4000 },
    { key: 'variants', label: 'Variants (size / colour / pack)', type: 'textarea', maxLength: 1000, placeholder: 'e.g. 500 ml, 1 L; pack of 1, pack of 2' },
    { key: 'imageLinks', label: 'Image links', type: 'textarea', required: true, maxLength: 2000, placeholder: 'Google Drive or Dropbox links, one per line', help: 'White-background main image, at least 1000 px' },
  ],
});

export const FORMS: FormDef[] = [
  {
    marketplace: 'FLIPKART', kind: 'MAPPING', draft: false, title: 'Flipkart — map to an existing product',
    intro: 'The product is already on Flipkart (it has an FSN). We add your offer to it.',
    sections: [
      { title: 'Request details', fields: [
        { key: 'productLink', label: 'Flipkart product link or FSN', type: 'text', required: true, maxLength: 500, placeholder: 'https://www.flipkart.com/… or FSN' },
        { key: 'productName', label: 'Product name', type: 'text', maxLength: 200 },
      ] },
      ...flipkartCommercial,
    ],
  },
  {
    marketplace: 'FLIPKART', kind: 'NEW_LISTING', draft: true, title: 'Flipkart — new listing',
    intro: 'The product is not on Flipkart yet. We create the catalog page and your listing.',
    sections: [productInfo('FLIPKART'), ...flipkartCommercial],
  },
  {
    marketplace: 'AMAZON', kind: 'MAPPING', draft: true, title: 'Amazon — map to an existing ASIN',
    intro: 'The product is already on Amazon (it has an ASIN). We add your offer to it.',
    sections: [
      { title: 'Request details', fields: [
        { key: 'productLink', label: 'Amazon product link or ASIN', type: 'text', required: true, maxLength: 500, placeholder: 'https://www.amazon.in/dp/… or ASIN' },
        { key: 'productName', label: 'Product name', type: 'text', maxLength: 200 },
      ] },
      ...amazonCommercial,
    ],
  },
  {
    marketplace: 'AMAZON', kind: 'NEW_LISTING', draft: true, title: 'Amazon — new listing',
    intro: 'The product is not on Amazon yet. We create the detail page and your offer.',
    sections: [productInfo('AMAZON'), ...amazonCommercial],
  },
];

export const formFor = (mp: Marketplace, kind: FormKind) => FORMS.find((f) => f.marketplace === mp && f.kind === kind)!;

/**
 * The marketplace product ID inside a pasted link (or the ID itself): Amazon ASIN, Flipkart FSN.
 * Product details are NOT fetched from the page (no scraping) — that comes from the marketplace APIs once approved.
 */
export function productRef(mp: Marketplace, value: string): { type: 'ASIN' | 'FSN'; id: string } | null {
  const v = value.trim();
  if (mp === 'AMAZON') {
    const m = /(?:\/dp\/|\/gp\/product\/|\/gp\/aw\/d\/|[?&]asin=)([A-Z0-9]{10})(?=[/?&#]|$)/i.exec(v) ?? /^([A-Z0-9]{10})$/i.exec(v);
    return m ? { type: 'ASIN', id: m[1].toUpperCase() } : null;
  }
  const m = /[?&]pid=([A-Z0-9]{16})(?=[&#]|$)/i.exec(v) ?? /^([A-Z0-9]{16})$/i.exec(v);
  return m ? { type: 'FSN', id: m[1].toUpperCase() } : null;
}
const fields = (f: FormDef) => f.sections.flatMap((s) => s.fields);

/** Normalises and validates submitted values. Returns clean data (known keys only) and per-field errors. */
export function validateForm(def: FormDef, input: Record<string, unknown>, { partial = false } = {}) {
  const data: Record<string, string | number> = {};
  const errors: Record<string, string> = {};
  for (const f of fields(def)) {
    const raw = input[f.key];
    const str = raw === undefined || raw === null ? '' : String(raw).trim();
    if (!str) { if (f.required && !partial) errors[f.key] = `${f.label} is required`; continue; }
    if (f.type === 'number' || f.type === 'money') {
      const n = Number(str.replace(/,/g, ''));
      if (!Number.isFinite(n)) { errors[f.key] = `${f.label} must be a number`; continue; }
      if (f.min !== undefined && n < f.min) { errors[f.key] = `${f.label} must be at least ${f.min}`; continue; }
      if (f.max !== undefined && n > f.max) { errors[f.key] = `${f.label} must be at most ${f.max}`; continue; }
      data[f.key] = f.type === 'money' ? Math.round(n * 100) / 100 : n;
    } else if (f.type === 'select') {
      if (f.options && !f.options.includes(str)) { errors[f.key] = `Choose a valid ${f.label}`; continue; }
      data[f.key] = str;
    } else if (f.type === 'date') {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(str) || Number.isNaN(Date.parse(str))) { errors[f.key] = `${f.label} must be a date`; continue; }
      data[f.key] = str;
    } else {
      if (f.maxLength && str.length > f.maxLength) { errors[f.key] = `${f.label} is too long (max ${f.maxLength})`; continue; }
      data[f.key] = str;
    }
  }
  if (typeof data.mrp === 'number' && typeof data.sellingPrice === 'number' && data.sellingPrice > data.mrp) errors.sellingPrice = 'Selling price cannot be more than MRP';
  if (typeof data.hsn === 'string' && !/^\d{4,8}$/.test(data.hsn)) errors.hsn = 'HSN must be 4 to 8 digits';
  if (typeof data.productLink === 'string') {
    const ref = productRef(def.marketplace, data.productLink);
    if (ref) data.productRef = ref.id;
    else if (!/^https?:\/\//i.test(data.productLink)) errors.productLink = `Paste the product page link or a valid ${def.marketplace === 'AMAZON' ? 'ASIN (10 characters)' : 'FSN (16 characters)'}`;
  }
  return { data, errors };
}
