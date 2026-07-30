// server.js — cloud-ready for Railway
import { Server }               from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport }  from '@modelcontextprotocol/sdk/server/stdio.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { WebSocketServer }       from 'ws';
import http                      from 'http';
import fs                        from 'fs';
import path                      from 'path';
import { barChart, lineChart, comboChart } from './chart-svg.js';

const WS_PORT   = parseInt(process.env.WS_PORT || '9001');
const HTTP_PORT = parseInt(process.env.PORT    || '3000');

let figmaSocket = null;
const pending   = new Map();
let msgCounter  = 0;

// Health check — Railway pings this to confirm the service is alive
http.createServer((_, res) => {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ status: 'ok', figmaConnected: figmaSocket !== null }));
}).listen(HTTP_PORT, '0.0.0.0', () => console.error(`[MCP] Health check on :${HTTP_PORT}`));

// WebSocket server — Figma plugin connects here
const wss = new WebSocketServer({ port: WS_PORT });
wss.on('connection', (ws) => {
  figmaSocket = ws;
  console.error('[MCP] Figma plugin connected');
  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw.toString());
      if (msg.id && pending.has(msg.id)) {
        const { resolve, reject } = pending.get(msg.id);
        pending.delete(msg.id);
        msg.error ? reject(new Error(msg.error)) : resolve(msg.result);
      }
    } catch(e) {}
  });
  ws.on('close', () => { figmaSocket = null; console.error('[MCP] Plugin disconnected'); });
});

function sendToFigma(command, payload = {}) {
  return new Promise((resolve, reject) => {
    if (!figmaSocket || figmaSocket.readyState !== 1)
      return reject(new Error('Figma plugin not connected. Open Figma and run the VizX Claude Bridge plugin.'));
    const id = `msg_${++msgCounter}`;
    const t = setTimeout(() => { pending.delete(id); reject(new Error(`Timeout: ${command}`)); }, 10000);
    pending.set(id, {
      resolve: v => { clearTimeout(t); resolve(v); },
      reject:  e => { clearTimeout(t); reject(e);  }
    });
    figmaSocket.send(JSON.stringify({ id, command, payload }));
  });
}

const ok  = t => ({ content: [{ type: 'text', text: t }] });
const err = t => ({ content: [{ type: 'text', text: `Error: ${t}` }], isError: true });

function saveJson(data, filePath) {
  const abs = path.resolve(filePath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, JSON.stringify(data, null, 2), 'utf8');
  return abs;
}

const TOOLS = [
  { name: 'ping_figma',     description: 'Check Figma plugin connection.',             inputSchema: { type: 'object', properties: {} } },
  { name: 'list_frames',    description: 'List all frames on the current Figma page.', inputSchema: { type: 'object', properties: {} } },
  { name: 'create_slide',   description: 'Create a pitchbook slide frame.',             inputSchema: { type: 'object', required: ['name','headline'], properties: { name:{type:'string'}, headline:{type:'string'}, tag:{type:'string'}, sub:{type:'string'}, x:{type:'number'}, y:{type:'number'}, width:{type:'number'}, height:{type:'number'} } } },
  { name: 'add_stat_cards', description: 'Add KPI stat cards to a frame.',             inputSchema: { type: 'object', required: ['frameId','stats'], properties: { frameId:{type:'string'}, stats:{type:'array',items:{type:'object'}} } } },
  { name: 'add_chart',      description: 'Add a chart as editable SVG vectors.',        inputSchema: { type: 'object', required: ['frameId','type','labels','datasets'], properties: { frameId:{type:'string'}, type:{type:'string',enum:['bar','stacked_bar','line','horizontal_bar','combo']}, labels:{type:'array',items:{type:'string'}}, datasets:{type:'array'}, fmt:{type:'string',enum:['dollar','pct','x']} } } },
  { name: 'add_legend',     description: 'Add a color legend.',                         inputSchema: { type: 'object', required: ['frameId','items'], properties: { frameId:{type:'string'}, items:{type:'array'} } } },
  { name: 'add_text',       description: 'Add a text node.',                            inputSchema: { type: 'object', required: ['frameId','text'], properties: { frameId:{type:'string'}, text:{type:'string'}, fontSize:{type:'number'}, fontWeight:{type:'string'}, color:{type:'string'}, x:{type:'number'}, y:{type:'number'}, width:{type:'number'} } } },
  { name: 'update_text',    description: 'Edit an existing text node by name.',         inputSchema: { type: 'object', required: ['frameId','nodeName','newText'], properties: { frameId:{type:'string'}, nodeName:{type:'string'}, newText:{type:'string'} } } },
  { name: 'delete_node',    description: 'Delete a node by ID.',                        inputSchema: { type: 'object', required: ['nodeId'], properties: { nodeId:{type:'string'} } } },
  { name: 'focus_frame',    description: 'Zoom viewport to a frame.',                   inputSchema: { type: 'object', required: ['frameId'], properties: { frameId:{type:'string'} } } },
  { name: 'set_fill_color', description: 'Set fill color of a node.',                   inputSchema: { type: 'object', required: ['nodeId','color'], properties: { nodeId:{type:'string'}, color:{type:'string'} } } },
  { name: 'duplicate_frame',description: 'Duplicate a frame.',                          inputSchema: { type: 'object', required: ['frameId'], properties: { frameId:{type:'string'}, newName:{type:'string'}, offsetX:{type:'number'} } } },
  { name: 'dump_components_to_json', description: 'Dump all components and component sets from Figma to JSON.', inputSchema: { type: 'object', properties: { pageOnly:{type:'boolean', description:'Limit to current page (default true)'}, filePath:{type:'string', description:'Optional absolute path to write JSON file'} } } },
  { name: 'dump_tokens_to_json',     description: 'Dump local styles and variables (tokens) from Figma to JSON.', inputSchema: { type: 'object', properties: { filePath:{type:'string', description:'Optional absolute path to write JSON file'} } } },
  { name: 'dump_selection_to_json',  description: 'Dump the currently selected Figma nodes to JSON.', inputSchema: { type: 'object', properties: { filePath:{type:'string', description:'Optional absolute path to write JSON file'} } } },
];

// ── MCP server ───────────────────────────────────────────────────────────────
const server = new Server(
  { name: 'figma-mcp', version: '1.0.0' },
  { capabilities: { tools: {} } }
);

// Use the correct Zod schemas from the SDK
server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: a } = req.params;
  try {
    if (name === 'ping_figma')     { const r = await sendToFigma('ping'); return ok(`Connected. Page: "${r.pageName}", frames: ${r.frameCount}`); }
    if (name === 'list_frames')    { const r = await sendToFigma('list_frames'); return ok(r.frames.map(f=>`• ${f.name} (${f.id})`).join('\n')||'(none)'); }
    if (name === 'create_slide')   { const r = await sendToFigma('create_slide', a); return ok(`Created "${a.name}" id:${r.frameId}`); }
    if (name === 'add_stat_cards') { await sendToFigma('add_stat_cards', a); return ok(`Added ${a.stats.length} stat cards`); }
    if (name === 'add_chart') {
      const { frameId, type, labels, datasets, fmt='dollar' } = a;
      let svg;
      if (type==='bar')              svg = barChart({ labels, datasets, stacked:false, fmt });
      else if (type==='stacked_bar') svg = barChart({ labels, datasets, stacked:true,  fmt });
      else if (type==='line')        svg = lineChart({ labels, datasets, fmt });
      else if (type==='horizontal_bar') svg = barChart({ labels, datasets, horizontal:true, fmt });
      else if (type==='combo')       svg = comboChart({ labels, barDatasets:datasets.filter(d=>d.chartType!=='line'), lineDatasets:datasets.filter(d=>d.chartType==='line'), fmtBar:fmt });
      else return err(`Unknown type: ${type}`);
      const r = await sendToFigma('add_svg', { frameId, svg, name:`${type} chart` });
      return ok(`Added ${type} chart (${r.nodeId})`);
    }
    if (name === 'add_legend')     { await sendToFigma('add_legend', a);      return ok('Legend added'); }
    if (name === 'add_text')       { const r=await sendToFigma('add_text',a); return ok(`Text added (${r.nodeId})`); }
    if (name === 'update_text')    { await sendToFigma('update_text', a);      return ok(`Updated "${a.nodeName}"`); }
    if (name === 'delete_node')    { await sendToFigma('delete_node', a);      return ok(`Deleted ${a.nodeId}`); }
    if (name === 'focus_frame')    { await sendToFigma('focus_frame', a);      return ok(`Focused`); }
    if (name === 'set_fill_color') { await sendToFigma('set_fill_color', a);   return ok(`Fill set to ${a.color}`); }
    if (name === 'duplicate_frame'){ const r=await sendToFigma('duplicate_frame',a); return ok(`Duplicated as "${a.newName}" (${r.newFrameId})`); }
    if (name === 'dump_components_to_json') {
      const r = await sendToFigma('dump_components', { pageOnly: a.pageOnly !== false });
      const text = JSON.stringify(r, null, 2);
      if (a.filePath) saveJson(r, a.filePath);
      return ok(text + (a.filePath ? `\n\nSaved to: ${path.resolve(a.filePath)}` : ''));
    }
    if (name === 'dump_tokens_to_json') {
      const r = await sendToFigma('dump_tokens');
      const text = JSON.stringify(r, null, 2);
      if (a.filePath) saveJson(r, a.filePath);
      return ok(text + (a.filePath ? `\n\nSaved to: ${path.resolve(a.filePath)}` : ''));
    }
    if (name === 'dump_selection_to_json') {
      const r = await sendToFigma('dump_selection');
      const text = JSON.stringify(r, null, 2);
      if (a.filePath) saveJson(r, a.filePath);
      return ok(text + (a.filePath ? `\n\nSaved to: ${path.resolve(a.filePath)}` : ''));
    }
    return err(`Unknown tool: ${name}`);
  } catch(e) { return err(e.message); }
});

const transport = new StdioServerTransport();
await server.connect(transport);
console.error(`[MCP] Started — WS :${WS_PORT}, HTTP :${HTTP_PORT}`);
