// Builds a small .xlsx (stored zip, inline strings) for tests — shaped like Flipkart's Profit and Loss Report,
// with made-up SKUs and numbers (never real client data).
import { crc32 } from 'node:zlib';

function zip(files) {
  const locals = []; const centrals = []; let offset = 0;
  for (const [name, text] of files) {
    const data = Buffer.from(text, 'utf8'); const nameBuf = Buffer.from(name); const crc = crc32(data) >>> 0;
    const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt32LE(crc, 14); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(nameBuf.length, 26);
    const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt32LE(crc, 16); central.writeUInt32LE(data.length, 20); central.writeUInt32LE(data.length, 24); central.writeUInt16LE(nameBuf.length, 28); central.writeUInt32LE(offset, 42);
    locals.push(local, nameBuf, data); centrals.push(central, nameBuf);
    offset += 30 + nameBuf.length + data.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const col = (i) => { let s = ''; i++; while (i) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };
function sheetXml(rows) {
  const body = rows.map((r, ri) => `<row r="${ri + 1}">${r.map((v, ci) => (v === null || v === undefined ? '' : typeof v === 'number' ? `<c r="${col(ci)}${ri + 1}"><v>${v}</v></c>` : `<c r="${col(ci)}${ri + 1}" t="inlineStr"><is><t>${esc(v)}</t></is></c>`)).join('')}</row>`).join('');
  return `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${body}</sheetData></worksheet>`;
}
export function makeXlsx(sheets) {
  const names = Object.keys(sheets);
  return zip([
    ['[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>'],
    ['xl/workbook.xml', `<?xml version="1.0"?><workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${names.map((n, i) => `<sheet name="${esc(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`],
    ['xl/_rels/workbook.xml.rels', `<?xml version="1.0"?><Relationships>${names.map((n, i) => `<Relationship Id="rId${i + 1}" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}</Relationships>`],
    ...names.map((n, i) => [`xl/worksheets/sheet${i + 1}.xml`, sheetXml(sheets[n])]),
  ]);
}

/** A Flipkart-style P&L for one month with two SKUs. */
export function flipkartPl(period = '2026-10', completeness = 98.2) {
  const [y, m] = period.split('-');
  const last = new Date(Date.UTC(Number(y), Number(m), 0)).getUTCDate();
  const header = ['SKU ID', null, 'Gross Units (#)', 'Returned & Cancelled Units', 'Returned & Cancelled Units (Breakup)', null, null, 'Net Units (#)', null, 'Estimated Net Sales (INR)', 'Sum of Order Item Value', null, 'Accounted Net Sales (Seller Price) ', 'Total Expenses (INR)', 'Total Expenses (Breakup)', 'Bank Settlement [Projected] (INR)', 'Input Tax Credits (INR)', 'Net Earnings (INR)', 'Earnings per unit (INR)', 'Bank Settlement [Projected] (INR)', 'Amount Settled (INR)', 'Amount Pending (INR)'];
  const sub = [null, null, null, 'RTO (Logistics Return)', 'RVP (Customer Return)', 'Cancellations', null, null, null, null, null, null, null, null, 'Commission Fee'];
  const row = (sku, gross, ret, net, sales, exp, bank, earn, settled, pending) => [sku, null, gross, ret, 0, 0, ret, net, null, sales, sales, null, sales, exp, exp, bank, earn - bank, earn, net ? Math.round((earn / net) * 100) / 100 : 0, bank, settled, pending];
  return makeXlsx({
    'Overall Summary': [[null], ['Report Specifications'], [null], ['Report Type:', 'Profit & Loss Report'], ['Orders Recieved During:', `${period}-01 to ${period}-${last}`], ['Generated on:', '2026-11-10'], [null], ['PNL Summary'], ['Item', 'Amount (INR)', 'Units'], ['Gross Sales', 20000, 150], ...(completeness < 100 ? [[`--- Incomplete data, Accounting & Collection in progress [${completeness}% Completed]`]] : []), ['Bank Settlement (Projected)', 12500, null]],
    'SKU-level P&L': [header, sub, row('BIKE POLISH - 1', 100, 20, 80, 8000, -800, 7200, 7500, 6000, 1200), row('RUBBING COMPOUND 100G - 1', 50, 10, 40, 6000, -700, 5300, 5450, 5300, 0)],
    'Orders P&L': [['Order Date', 'Order ID']],
    'Report Help': [['Report Description']],
  });
}
