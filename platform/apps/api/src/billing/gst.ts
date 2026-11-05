/**
 * GST rules for SOLLUNA's own subscription invoices (CGST Act s.31, Rule 46).
 * Prices are GST-EXCLUSIVE: the plan price is the taxable value; GST is added on top.
 *  - Intra-state supply (supplier state = place of supply): CGST + SGST, each half the rate.
 *  - Inter-state supply: IGST at the full rate.
 * Place of supply for these services (IGST Act s.12(2)): the recipient's GSTIN state if registered,
 * otherwise the recipient's address on record.
 */

export const STATES: Record<string, string> = {
  '01': 'Jammu and Kashmir', '02': 'Himachal Pradesh', '03': 'Punjab', '04': 'Chandigarh', '05': 'Uttarakhand', '06': 'Haryana',
  '07': 'Delhi', '08': 'Rajasthan', '09': 'Uttar Pradesh', '10': 'Bihar', '11': 'Sikkim', '12': 'Arunachal Pradesh', '13': 'Nagaland',
  '14': 'Manipur', '15': 'Mizoram', '16': 'Tripura', '17': 'Meghalaya', '18': 'Assam', '19': 'West Bengal', '20': 'Jharkhand',
  '21': 'Odisha', '22': 'Chhattisgarh', '23': 'Madhya Pradesh', '24': 'Gujarat', '26': 'Dadra and Nagar Haveli and Daman and Diu',
  '27': 'Maharashtra', '29': 'Karnataka', '30': 'Goa', '31': 'Lakshadweep', '32': 'Kerala', '33': 'Tamil Nadu', '34': 'Puducherry',
  '35': 'Andaman and Nicobar Islands', '36': 'Telangana', '37': 'Andhra Pradesh', '38': 'Ladakh', '97': 'Other Territory',
};

const GSTIN_RE = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/** GSTIN check digit (mod-36 weighted checksum used by GSTN). */
export function gstinCheckDigit(first14: string): string {
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const p = CHARS.indexOf(first14[i]) * (i % 2 === 0 ? 1 : 2);
    sum += Math.floor(p / 36) + (p % 36);
  }
  return CHARS[(36 - (sum % 36)) % 36];
}

export function isValidGstin(g: string): boolean {
  return GSTIN_RE.test(g) && g.slice(0, 2) in STATES && gstinCheckDigit(g.slice(0, 14)) === g[14];
}

export const stateOfGstin = (g: string) => g.slice(0, 2);

export interface TaxBreakup { taxablePaise: number; rateBps: number; intraState: boolean; cgstPaise: number; sgstPaise: number; igstPaise: number; taxPaise: number; totalPaise: number }

export function computeGst(taxablePaise: number, supplierState: string, placeOfSupply: string, rateBps = 1800): TaxBreakup {
  const intraState = supplierState === placeOfSupply;
  const half = Math.round((taxablePaise * rateBps) / 2 / 10_000);
  const cgstPaise = intraState ? half : 0;
  const sgstPaise = intraState ? half : 0;
  const igstPaise = intraState ? 0 : Math.round((taxablePaise * rateBps) / 10_000);
  const taxPaise = cgstPaise + sgstPaise + igstPaise;
  return { taxablePaise, rateBps, intraState, cgstPaise, sgstPaise, igstPaise, taxPaise, totalPaise: taxablePaise + taxPaise };
}

/** Indian financial year (April–March), e.g. 2026-11-05 → "2026-27". */
export function financialYear(d: Date): string {
  const y = d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1;
  return `${y}-${String((y + 1) % 100).padStart(2, '0')}`;
}

/** Invoice number ≤ 16 chars, unique per FY (Rule 46(b)): SOL/26-27/00001. */
export const invoiceNumber = (fy: string, seq: number) => `SOL/${fy.slice(2)}/${String(seq).padStart(5, '0')}`;

const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
function below100(n: number) { return n < 20 ? ONES[n] : `${TENS[Math.floor(n / 10)]}${n % 10 ? ' ' + ONES[n % 10] : ''}`; }
function below1000(n: number) { return n >= 100 ? `${ONES[Math.floor(n / 100)]} Hundred${n % 100 ? ' ' + below100(n % 100) : ''}` : below100(n); }
function indianWords(n: number): string {
  if (n === 0) return 'Zero';
  const parts: string[] = [];
  const crore = Math.floor(n / 1e7); n %= 1e7;
  const lakh = Math.floor(n / 1e5); n %= 1e5;
  const thousand = Math.floor(n / 1e3); n %= 1e3;
  if (crore) parts.push(`${indianWords(crore)} Crore`);
  if (lakh) parts.push(`${below100(lakh)} Lakh`);
  if (thousand) parts.push(`${below100(thousand)} Thousand`);
  if (n) parts.push(below1000(n));
  return parts.join(' ');
}

/** 235882 → "Rupees Two Thousand Three Hundred Fifty Eight and Eighty Two Paise Only" */
export function amountInWords(paise: number): string {
  const rupees = Math.floor(paise / 100), p = paise % 100;
  return `Rupees ${indianWords(rupees)}${p ? ` and ${below100(p)} Paise` : ''} Only`;
}
