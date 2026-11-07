// Stand-in for the Claude Messages API used by the product lookup, so tests never call (or pay for) the real API.
// Links containing "notfound" → found:false; "pause" → first reply pauses (pause_turn) and must be resumed.
import { createServer } from 'node:http';

export const PRODUCT = {
  found: true, product_name: 'Roff Cera Clean Tile Cleaner 1 L', brand: 'Roff', category: 'Home Cleaning > Tile & Floor Cleaners', mrp_inr: 249,
  hsn_suggestion: '34022090', gst_rate_suggestion: 18, length_cm: 9, breadth_cm: 6, height_cm: 27, weight_kg: 1.1, country_of_origin: 'India',
  manufacturer: 'Pidilite Industries Ltd, Mumbai 400021', packer: 'Pidilite Industries Ltd, Mumbai 400021', importer: null, shelf_life_months: 24,
  key_features: ['Removes tough stains', 'Safe on tiles'], description: 'Professional tile and floor cleaner.', variants: '500 ml, 1 L',
  image_urls: ['https://example.com/img1.jpg'], barcode: '8901234567897', sources: ['https://www.flipkart.com/roff/p/itm1?pid=TCLFX7ZGHYQ2KJWE', 'https://www.pidilite.com/roff'], notes: 'HSN is a suggestion.',
};

export async function startClaudeMock() {
  const calls = [];
  const server = createServer((req, res) => {
    let raw = ''; req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const body = JSON.parse(raw || '{}');
      calls.push({ url: req.url, headers: req.headers, body });
      const text = JSON.stringify(body.messages?.[0]?.content ?? '').toLowerCase();
      const reply = (content, stop_reason) => res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({
        id: `msg_${calls.length}`, type: 'message', role: 'assistant', model: body.model, content, stop_reason, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 10 },
      }));
      if (text.includes('pause') && body.messages.length === 1) return reply([{ type: 'server_tool_use', id: 'srvtoolu_1', name: 'web_search', input: { query: 'product' } }], 'pause_turn');
      const input = text.includes('notfound') ? { ...PRODUCT, found: false } : PRODUCT;
      reply([{ type: 'tool_use', id: `toolu_${calls.length}`, name: 'submit_product_details', input }], 'tool_use');
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { port: server.address().port, calls, close: () => server.close() };
}
