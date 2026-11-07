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
      if (String(body.system ?? '').includes('account manager at SOLLUNA')) return agentReply(body, res, calls.length);
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

// Manager agent stand-in. Only messages tagged "[agent-test]" get a reply; others get an empty turn (no chat bubble),
// so the rest of the test-suite is unaffected by the agent being on.
function agentReply(body, res, n) {
  const send = (content, stop_reason) => res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({
    id: `msg_a${n}`, type: 'message', role: 'assistant', model: body.model, content, stop_reason, stop_sequence: null,
    usage: { input_tokens: 1200, output_tokens: 80, cache_read_input_tokens: 1000, cache_creation_input_tokens: 200 },
  }));
  const last = body.messages[body.messages.length - 1];
  if (Array.isArray(last.content) && last.content.some((b) => b.type === 'tool_result')) {
    const out = last.content.map((b) => (typeof b.content === 'string' ? b.content : '')).join(' ');
    return send([{ type: 'text', text: `Done 👍 (${out})\n\nAnything else I can set up for you?` }], 'end_turn');
  }
  const text = (typeof last.content === 'string' ? last.content : JSON.stringify(last.content)).toLowerCase();
  const said = text.split('</client_facts>').pop();
  if (!said.includes('[agent-test]')) return send([], 'end_turn');
  if (said.includes('weather')) return send([{ type: 'text', text: 'I can only help with your SOLLUNA services and your Amazon / Flipkart business 🙂\n\nAnything on your listings or orders?' }], 'end_turn');
  if (said.includes('gst')) return send([
    { type: 'tool_use', id: `toolu_a${n}1`, name: 'remember', input: { key: 'gstin', value: '24ABCDE1234F1Z5' } },
    { type: 'tool_use', id: `toolu_a${n}2`, name: 'set_seller_account', input: { marketplace: 'FLIPKART', has_account: false, store_name: null, seller_id: null } },
  ], 'tool_use');
  if (said.includes('ads')) return send([{ type: 'tool_use', id: `toolu_a${n}`, name: 'create_service_request', input: { feature_key: 'ADS_MANAGEMENT', title: 'Run Flipkart ads', details: 'Client wants ads' } }], 'tool_use');
  if (said.includes('password')) return send([{ type: 'tool_use', id: `toolu_a${n}`, name: 'remember', input: { key: 'seller_password', value: 'abc123' } }], 'tool_use');
  return send([{ type: 'text', text: 'Hi! Tell me a bit about your business 🙂\n\nWhat do you sell?' }], 'end_turn');
}
