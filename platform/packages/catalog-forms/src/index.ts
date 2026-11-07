/**
 * Listing & mapping request forms (Dashboard → Listings & Mapping). One schema drives the browser form and the API
 * validation, so both always agree. FLIPKART_MAPPING follows the owner's field list exactly (6 Nov 2026); the other
 * three are drafts from the marketplaces' standard fields until the owner's brief arrives.
 */
export type Marketplace = 'FLIPKART' | 'AMAZON';
export type FormKind = 'MAPPING' | 'NEW_LISTING';
/** list = several values (Enter or comma after each), stored one per line. images = uploaded image document ids, comma-separated. */
/** checks = tick any of the options (stored one per line). */
export type FieldType = 'text' | 'textarea' | 'number' | 'money' | 'select' | 'date' | 'url' | 'list' | 'images' | 'checks';
export interface Field {
  key: string; label: string; type: FieldType; required?: boolean; options?: string[]; unit?: string;
  help?: string; placeholder?: string; min?: number; max?: number; maxLength?: number;
  /** Stored when the client leaves the field empty (shown as a hint). */
  blankAs?: string | number;
  /** Left empty → SOLLUNA generates a unique SKU code. */
  autoSku?: boolean;
  /** Typing hints for a text field; any value is still accepted. */
  suggestions?: string[];
  /** list: most values; images: most files. */
  maxItems?: number;
}
export interface Section { title: string; note?: string; fields: Field[] }
export interface FormDef { marketplace: Marketplace; kind: FormKind; title: string; intro: string; draft: boolean; sections: Section[];
  /** Values SOLLUNA always uses for this form (not shown to the client). */
  fixed?: Record<string, string> }

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

const flipkartManufacturing: Section = {
  ...manufacturing,
  fields: manufacturing.fields.map((f) => (f.key === 'importerDetails' ? { ...f, blankAs: 'None', help: 'Leave blank if not imported — we enter "None"' } : f)),
};
const flipkartPackage: Section = { ...packageDetails, fields: packageDetails.fields.map((f) => ({ ...f, required: true, min: 0.01 })) };
const zeroIfBlank = { blankAs: 0, help: 'Leave blank if you don’t charge it — we enter 0' };

/** Owner decision 7 Nov 2026: Flipkart offers are always seller-fulfilled and shipped by Flipkart. */
const FLIPKART_FIXED = { fulfilmentBy: 'Seller', shippingProvider: 'Flipkart' };

const flipkartCommercial: Section[] = [
  { title: 'Listing information', fields: [{ key: 'sellerSku', label: 'Seller SKU ID', type: 'text', maxLength: 64, autoSku: true, placeholder: 'Your own SKU code', help: 'Optional — leave blank and SOLLUNA creates one for you' }] },
  { title: 'Status Details', fields: [{ key: 'listingStatus', label: 'Listing Status', type: 'select', required: true, options: ['Active', 'Inactive'] }] },
  {
    title: 'Price details',
    fields: [
      { key: 'mrp', label: 'MRP', type: 'money', required: true, unit: 'INR', min: 1 },
      { key: 'sellingPrice', label: 'Your selling price', type: 'money', required: true, unit: 'INR', min: 1, help: 'This is the price the customer pays — not your bank settlement. Delivery charges, tax and Flipkart commission are deducted from it. Your exact bank settlement shows after the listing is live; ask your manager to check it for you.' },
      { key: 'minOrderQty', label: 'Minimum Order Quantity (MinOQ)', type: 'select', options: MINOQ, help: 'Only if Flipkart offers MinOQ in your category' },
    ],
  },
  {
    title: 'Inventory details',
    fields: [
      { key: 'procurementType', label: 'Procurement type', type: 'select', required: true, options: ['Instock', 'Express', 'Domestic procurement', 'International procurement', 'Made to order'] },
      { key: 'procurementSlaDays', label: 'Procurement SLA', type: 'number', required: true, unit: 'days', min: 0, max: 60 },
      { key: 'stock', label: 'Stock', type: 'number', required: true, min: 0, max: 1_000_000, help: 'Minimum 5 quantity required for listing visibility' },
    ],
  },
  {
    title: 'Handling Fee Charged To Customer',
    fields: [
      { key: 'localHandlingFee', label: 'Local handling fee', type: 'money', unit: 'INR', min: 0, ...zeroIfBlank },
      { key: 'zonalHandlingFee', label: 'Zonal handling fee', type: 'money', unit: 'INR', min: 0, ...zeroIfBlank },
      { key: 'nationalHandlingFee', label: 'National handling fee', type: 'money', unit: 'INR', min: 0, ...zeroIfBlank },
    ],
  },
  flipkartPackage,
  {
    title: 'Tax details',
    fields: [
      { key: 'hsn', label: 'HSN', type: 'text', required: true, placeholder: '4–8 digit HSN code', help: 'Find relevant HSN codes on the GST portal or ask your manager' },
      { key: 'luxuryCessPct', label: 'Luxury Cess', type: 'number', unit: 'Percentage', min: 0, max: 100, blankAs: 0, help: 'Leave blank if not applicable — we enter 0' },
      { key: 'taxCode', label: 'Tax Code', type: 'select', required: true, options: GST, help: 'Find relevant Tax codes: GST rate for your HSN' },
    ],
  },
  flipkartManufacturing,
];

const many = (key: string, label: string, extra: Partial<Field> = {}): Field => ({ key, label, type: 'list', maxItems: 30, maxLength: 3000, help: 'Multiple values allowed. Press “Enter” or “,” after each value', ...extra });

/** Flipkart new listing — owner's field list (7 Nov 2026), in Seller Hub order. Product attributes follow the owner's example vertical. */
const flipkartNewListing: Section[] = [
  { title: 'Product', fields: [
    { key: 'vertical', label: 'Select The Vertical For Your Product', type: 'text', required: true, maxLength: 120, placeholder: 'e.g. Floor Cleaner', suggestions: ['Floor Cleaner', 'Toilet Cleaner', 'Bathroom Cleaner', 'Kitchen Cleaner', 'Glass Cleaner', 'Multi-Surface Cleaner', 'Room Freshener', 'Dishwash Liquid', 'Detergent'] },
    { key: 'brand', label: 'Brand', type: 'text', required: true, maxLength: 80 },
    { key: 'images', label: 'Product images', type: 'images', required: true, maxItems: 5, help: 'Up to 5 images (JPG, PNG or WEBP). First image = main image: white background, at least 1000 px' },
  ] },
  ...flipkartCommercial,
  { title: 'Product details', fields: [
    { key: 'modelName', label: 'Model Name', type: 'text', required: true, maxLength: 120 },
    { key: 'brandFragrance', label: 'Brand Fragrance', type: 'text', required: true, maxLength: 80, suggestions: ['Lavender', 'Lemon', 'Rose', 'Jasmine', 'Pine', 'Floral', 'Citrus', 'Unscented'] },
    { key: 'quantityL', label: 'Quantity', type: 'number', required: true, unit: 'L', min: 0.001, max: 1000 },
    { key: 'suitableFor', label: 'Suitable For', type: 'text', required: true, maxLength: 120, suggestions: ['Floor', 'Tiles', 'Bathroom', 'Toilet', 'Kitchen', 'Glass', 'Multi-surface'] },
    { key: 'formFactor', label: 'Form Factor', type: 'text', required: true, maxLength: 60, suggestions: ['Liquid', 'Gel', 'Powder', 'Spray', 'Tablet', 'Wipes'] },
    { key: 'packOf', label: 'Pack of', type: 'number', required: true, min: 1, max: 1000 },
    { key: 'containerType', label: 'Container Type', type: 'text', required: true, maxLength: 60, suggestions: ['Bottle', 'Spray Bottle', 'Can', 'Pouch', 'Jar', 'Sachet', 'Box'] },
  ] },
  { title: 'General', fields: [
    many('eanUpc', 'EAN/UPC', { maxLength: 600 }),
    { key: 'fragranceForRefiner', label: 'Fragrance For Refiner', type: 'text', maxLength: 80, suggestions: ['Lavender', 'Lemon', 'Rose', 'Jasmine', 'Pine', 'Floral', 'Citrus'] },
    many('keyFeatures', 'Key Features'),
    many('usageInstructions', 'Usage Instructions'),
    { key: 'videoUrl', label: 'Video URL', type: 'url', maxLength: 500 },
    { key: 'description', label: 'Description', type: 'textarea', maxLength: 5000 },
    many('composition', 'Composition'),
    many('searchKeywords', 'Search Keywords'),
    many('certification', 'Certification'),
    { key: 'usedFor', label: 'Used For', type: 'text', maxLength: 120, suggestions: ['Cleaning', 'Disinfecting', 'Stain Removal', 'Descaling', 'Fragrance'] },
    { key: 'phValue', label: 'pH Value', type: 'number', min: 0, max: 14 },
    { key: 'maxShelfLifeMonths', label: 'Maximum Shelf Life', type: 'number', unit: 'Months', min: 0, max: 600 },
    { key: 'manufacturingProcess', label: 'Manufacturing Process', type: 'text', maxLength: 80, suggestions: ['Chemical', 'Natural', 'Herbal', 'Handmade'] },
    { key: 'organic', label: 'Organic', type: 'select', options: ['Yes', 'No'] },
  ] },
  { title: 'Dimensions', note: 'Product size (not the package).', fields: [
    { key: 'productHeightCm', label: 'Height', type: 'number', unit: 'cm', min: 0, max: 1000 },
    { key: 'productWidthCm', label: 'Width', type: 'number', unit: 'cm', min: 0, max: 1000 },
    { key: 'productDepthCm', label: 'Depth', type: 'number', unit: 'cm', min: 0, max: 1000 },
    many('otherDimensions', 'Other Dimensions'),
  ] },
  { title: 'In the box', fields: [many('itemsIncluded', 'Items Included')] },
  { title: 'Additional features', fields: [many('otherFeatures', 'Other Features')] },
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
    { key: 'referenceLink', label: 'Same product on another site (link)', type: 'url', maxLength: 500, placeholder: mp === 'AMAZON' ? 'Flipkart / brand website link' : 'Amazon / brand website link', help: 'Optional — we fill the product details from it' },
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
    marketplace: 'FLIPKART', kind: 'MAPPING', draft: false, fixed: FLIPKART_FIXED, title: 'Flipkart — map to an existing product',
    intro: 'The product is already on Flipkart (it has an FSN). We add your offer to it.',
    sections: [
      { title: 'Request details', fields: [
        { key: 'productLink', label: 'Flipkart product link or FSN', type: 'text', required: true, maxLength: 500, placeholder: 'https://www.flipkart.com/… or FSN', help: 'No need to add the product name — we take it from the Flipkart listing' },
      ] },
      ...flipkartCommercial,
    ],
  },
  {
    marketplace: 'FLIPKART', kind: 'NEW_LISTING', draft: false, fixed: FLIPKART_FIXED, title: 'Flipkart — new listing',
    intro: 'The product is not on Flipkart yet. We create the catalog page and your listing.',
    sections: flipkartNewListing,
  },
  {
    // Owner's field list (7 Nov 2026), Seller Central "Add price and inventory" (Recommended). Always sold as New.
    marketplace: 'AMAZON', kind: 'MAPPING', draft: false, fixed: { condition: 'New', externalProductInfoEntity: 'HSN' }, title: 'Amazon — map to an existing ASIN',
    intro: 'The product is already on Amazon (it has an ASIN). We add your offer to it. Condition: New.',
    sections: [
      { title: 'Request details', fields: [
        { key: 'productLink', label: 'Amazon product link or ASIN', type: 'text', required: true, maxLength: 500, placeholder: 'https://www.amazon.in/dp/… or ASIN', help: 'No need to add the product name — we take it from the Amazon listing' },
      ] },
      { title: 'Add price and inventory', fields: [
        { key: 'audience', label: 'Audience', type: 'checks', options: ['Sell on Amazon', 'Amazon Business (B2B)'], blankAs: 'Sell on Amazon', help: 'Enable one or both. Nothing ticked = “Sell on Amazon” (default)' },
        { key: 'sellerSku', label: 'SKU', type: 'text', maxLength: 40, autoSku: true, placeholder: 'Example: ABC123', help: 'Optional — leave blank and SOLLUNA creates one for you' },
        { key: 'hsn', label: 'External Product Information (HSN)', type: 'text', required: true, placeholder: 'Example: 610510, 61051010', help: '6 to 8-digit HSN for the India marketplace' },
        { key: 'fulfilmentChannel', label: 'Fulfillment Channel', type: 'select', required: true, options: ['Fulfilled by Amazon (FBA)', 'Merchant Fulfilled (Self Ship / Easy Ship)'], help: 'FBA: Amazon stores, ships and handles customer service. Merchant Fulfilled: you ship yourself, or you pack and Amazon picks up (Easy Ship)' },
        { key: 'sellingPrice', label: 'Your Price', type: 'money', required: true, unit: 'INR', min: 1, help: 'Base price the buyer pays — not your bank settlement. Amazon fees, shipping and tax are deducted from it; ask your manager for your exact settlement' },
        { key: 'mrp', label: 'Maximum Retail Price', type: 'money', required: true, unit: 'INR', min: 1, help: 'The MRP printed on the pack (Legal Metrology Act). The most you can charge a customer' },
      ] },
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
/** Unique SKU for clients who leave Seller SKU blank, e.g. SOL-FK-7K2M9QXA. */
export function autoSku(mp: Marketplace) {
  const abc = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(8));
  return `SOL-${mp === 'AMAZON' ? 'AZ' : 'FK'}-${Array.from(bytes, (b) => abc[b % abc.length]).join('')}`;
}
const fields = (f: FormDef) => f.sections.flatMap((s) => s.fields);

/** Normalises and validates submitted values. Returns clean data (known keys only) and per-field errors. */
export function validateForm(def: FormDef, input: Record<string, unknown>, { partial = false } = {}) {
  const data: Record<string, string | number> = {};
  const errors: Record<string, string> = {};
  for (const f of fields(def)) {
    const raw = input[f.key];
    const str = raw === undefined || raw === null ? '' : String(raw).trim();
    if (!str) {
      if (partial) continue;
      if (f.blankAs !== undefined) data[f.key] = f.blankAs;
      else if (f.autoSku) data[f.key] = autoSku(def.marketplace);
      else if (f.required) errors[f.key] = `${f.label} is required`;
      continue;
    }
    if (f.type === 'number' || f.type === 'money') {
      const n = Number(str.replace(/,/g, ''));
      if (!Number.isFinite(n)) { errors[f.key] = `${f.label} must be a number`; continue; }
      if (f.min !== undefined && n < f.min) { errors[f.key] = `${f.label} must be at least ${f.min}`; continue; }
      if (f.max !== undefined && n > f.max) { errors[f.key] = `${f.label} must be at most ${f.max}`; continue; }
      data[f.key] = f.type === 'money' ? Math.round(n * 100) / 100 : n;
    } else if (f.type === 'select') {
      if (f.options && !f.options.includes(str)) { errors[f.key] = `Choose a valid ${f.label}`; continue; }
      data[f.key] = str;
    } else if (f.type === 'list') {
      const items = [...new Set(str.split(/[\n,]/).map((x) => x.trim()).filter(Boolean))];
      if (f.maxItems && items.length > f.maxItems) { errors[f.key] = `${f.label}: at most ${f.maxItems} values`; continue; }
      const joined = items.join('\n');
      if (f.maxLength && joined.length > f.maxLength) { errors[f.key] = `${f.label} is too long (max ${f.maxLength})`; continue; }
      if (!items.length) { if (f.required) errors[f.key] = `${f.label} is required`; continue; }
      data[f.key] = joined;
    } else if (f.type === 'checks') {
      const picked = [...new Set(str.split('\n').map((x) => x.trim()).filter(Boolean))];
      if (picked.some((x) => !f.options?.includes(x))) { errors[f.key] = `Choose a valid ${f.label}`; continue; }
      data[f.key] = (f.options ?? []).filter((o) => picked.includes(o)).join('\n');
    } else if (f.type === 'images') {
      const ids = [...new Set(str.split(',').map((x) => x.trim()).filter(Boolean))];
      if (ids.some((x) => !/^[a-z0-9]{20,40}$/i.test(x))) { errors[f.key] = `${f.label}: upload the images again`; continue; }
      if (f.maxItems && ids.length > f.maxItems) { errors[f.key] = `${f.label}: at most ${f.maxItems} images`; continue; }
      data[f.key] = ids.join(',');
    } else if (f.type === 'date') {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(str) || Number.isNaN(Date.parse(str))) { errors[f.key] = `${f.label} must be a date`; continue; }
      data[f.key] = str;
    } else {
      if (f.maxLength && str.length > f.maxLength) { errors[f.key] = `${f.label} is too long (max ${f.maxLength})`; continue; }
      data[f.key] = str;
    }
  }
  if (typeof data.mrp === 'number' && typeof data.sellingPrice === 'number' && data.sellingPrice > data.mrp) errors.sellingPrice = 'Selling price cannot be more than MRP';
  if (typeof data.hsn === 'string') {
    const amazonMapping = def.marketplace === 'AMAZON' && def.kind === 'MAPPING';
    if (!(amazonMapping ? /^\d{6,8}$/ : /^\d{4,8}$/).test(data.hsn)) errors.hsn = `HSN must be ${amazonMapping ? 6 : 4} to 8 digits`;
  }
  if (typeof data.productLink === 'string') {
    const ref = productRef(def.marketplace, data.productLink);
    if (ref) data.productRef = ref.id;
    else if (!/^https?:\/\//i.test(data.productLink)) errors.productLink = `Paste the product page link or a valid ${def.marketplace === 'AMAZON' ? 'ASIN (10 characters)' : 'FSN (16 characters)'}`;
  }
  if (!partial && def.fixed) Object.assign(data, def.fixed);
  return { data, errors };
}
