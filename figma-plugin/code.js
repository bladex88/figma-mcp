// code.js — Figma plugin main thread
// Receives commands from the UI (which holds the WebSocket) and executes them on the canvas.

figma.showUI(__html__, { width: 320, height: 280 });

// ── Helpers ──────────────────────────────────────────────────────────────────
function hexToRgb(hex) {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3
    ? h.split('').map(c => c + c).join('')
    : h, 16);
  return { r: ((n >> 16) & 255) / 255, g: ((n >> 8) & 255) / 255, b: (n & 255) / 255 };
}

async function loadFonts() {
  await Promise.all([
    figma.loadFontAsync({ family: 'Inter', style: 'Regular' }),
    figma.loadFontAsync({ family: 'Inter', style: 'Bold' }),
    figma.loadFontAsync({ family: 'Inter', style: 'Medium' }),
  ]);
}

function nextPosition() {
  const frames = figma.currentPage.findAll(n => n.type === 'FRAME' && n.parent === figma.currentPage);
  if (frames.length === 0) return { x: 100, y: 100 };
  const maxX = Math.max(...frames.map(f => f.x + f.width));
  return { x: maxX + 60, y: frames[0].y };
}

// ── Command handlers ─────────────────────────────────────────────────────────
const handlers = {

  ping: async () => ({
    pageName:   figma.currentPage.name,
    frameCount: figma.currentPage.findAll(n => n.type === 'FRAME' && n.parent === figma.currentPage).length
  }),

  list_frames: async () => {
    const frames = figma.currentPage.findAll(n => n.type === 'FRAME' && n.parent === figma.currentPage);
    return {
      frames: frames.map(f => ({ id: f.id, name: f.name, width: f.width, height: f.height, x: f.x, y: f.y }))
    };
  },

  create_slide: async ({ name, headline, tag, sub, x, y, width = 900, height = 560 }) => {
    await loadFonts();
    const pos = (x != null && y != null) ? { x, y } : nextPosition();

    const frame = figma.createFrame();
    frame.name   = name || headline;
    frame.resize(width, height);
    frame.x      = pos.x;
    frame.y      = pos.y;
    frame.fills  = [{ type: 'SOLID', color: { r: 1, g: 1, b: 1 } }];
    frame.cornerRadius = 16;

    // top accent bar
    const bar = figma.createRectangle();
    bar.name   = 'accent-bar';
    bar.resize(width, 3);
    bar.x = 0; bar.y = 0;
    bar.fills = [{ type: 'SOLID', color: hexToRgb('#0e0e0e') }];
    frame.appendChild(bar);

    let curY = 36;

    // tag
    if (tag) {
      const tagNode = figma.createText();
      tagNode.name        = 'tag';
      tagNode.characters  = tag.toUpperCase();
      tagNode.fontSize    = 10;
      tagNode.fontName    = { family: 'Inter', style: 'Medium' };
      tagNode.fills       = [{ type: 'SOLID', color: hexToRgb('#aaaaaa') }];
      tagNode.letterSpacing = { value: 14, unit: 'PERCENT' };
      tagNode.x           = 40;
      tagNode.y           = curY;
      frame.appendChild(tagNode);
      curY += 22;
    }

    // headline
    const hl = figma.createText();
    hl.name       = 'headline';
    hl.characters = headline;
    hl.fontSize   = 22;
    hl.fontName   = { family: 'Inter', style: 'Bold' };
    hl.fills      = [{ type: 'SOLID', color: hexToRgb('#0e0e0e') }];
    hl.x          = 40;
    hl.y          = curY;
    hl.textAutoResize = 'HEIGHT';
    hl.resize(width - 80, hl.height);
    frame.appendChild(hl);
    curY += hl.height + 8;

    // sub
    if (sub) {
      const subNode = figma.createText();
      subNode.name       = 'sub';
      subNode.characters = sub;
      subNode.fontSize   = 13;
      subNode.fontName   = { family: 'Inter', style: 'Regular' };
      subNode.fills      = [{ type: 'SOLID', color: hexToRgb('#888888') }];
      subNode.x          = 40;
      subNode.y          = curY;
      subNode.textAutoResize = 'HEIGHT';
      subNode.resize(width - 80, subNode.height);
      frame.appendChild(subNode);
    }

    figma.currentPage.appendChild(frame);
    figma.viewport.scrollAndZoomIntoView([frame]);
    return { frameId: frame.id };
  },

  add_stat_cards: async ({ frameId, stats }) => {
    await loadFonts();
    const frame = figma.getNodeById(frameId);
    if (!frame) throw new Error(`Frame ${frameId} not found`);

    const cardW  = Math.floor((frame.width - 80 - (stats.length - 1) * 12) / stats.length);
    const cardH  = 72;
    // place below existing content
    const children = frame.children;
    let yOff = 40;
    if (children.length > 0) {
      const lastChild = children[children.length - 1];
      yOff = lastChild.y + lastChild.height + 20;
    }

    stats.forEach((s, i) => {
      const card = figma.createFrame();
      card.name   = `stat-${s.label}`;
      card.resize(cardW, cardH);
      card.x      = 40 + i * (cardW + 12);
      card.y      = yOff;
      card.fills  = [{ type: 'SOLID', color: hexToRgb('#f7f6f3') }];
      card.cornerRadius = 10;

      const valNode = figma.createText();
      valNode.characters = s.value;
      valNode.fontSize   = 24;
      valNode.fontName   = { family: 'Inter', style: 'Bold' };
      valNode.fills      = [{ type: 'SOLID', color: hexToRgb('#0e0e0e') }];
      valNode.x = 14; valNode.y = 12;
      card.appendChild(valNode);

      const lblNode = figma.createText();
      lblNode.characters = s.label;
      lblNode.fontSize   = 10;
      lblNode.fontName   = { family: 'Inter', style: 'Regular' };
      lblNode.fills      = [{ type: 'SOLID', color: hexToRgb('#999999') }];
      lblNode.x = 14; lblNode.y = 44;
      card.appendChild(lblNode);

      frame.appendChild(card);
    });

    return { added: stats.length };
  },

  add_svg: async ({ frameId, svg, name }) => {
    const frame = figma.getNodeById(frameId);
    if (!frame) throw new Error(`Frame ${frameId} not found`);

    const svgNode = figma.createNodeFromSvg(svg);
    svgNode.name  = name || 'chart';

    const children  = frame.children;
    let yOff = 40;
    if (children.length > 0) {
      const lastChild = children[children.length - 1];
      yOff = lastChild.y + lastChild.height + 20;
    }

    const targetW = frame.width - 80;
    const scale   = targetW / svgNode.width;
    svgNode.resize(targetW, svgNode.height * scale);
    svgNode.x = 40;
    svgNode.y = yOff;

    frame.appendChild(svgNode);
    return { nodeId: svgNode.id };
  },

  add_legend: async ({ frameId, items }) => {
    await loadFonts();
    const frame = figma.getNodeById(frameId);
    if (!frame) throw new Error(`Frame ${frameId} not found`);

    const children = frame.children;
    let yOff = 40;
    if (children.length > 0) {
      const last = children[children.length - 1];
      yOff = last.y + last.height + 12;
    }

    const group = figma.createFrame();
    group.name   = 'legend';
    group.fills  = [];
    group.resize(frame.width - 80, 20);
    group.x = 40; group.y = yOff;
    group.layoutMode = 'HORIZONTAL';
    group.itemSpacing = 16;
    group.primaryAxisSizingMode = 'AUTO';

    for (const item of items) {
      const dot = figma.createRectangle();
      dot.resize(8, 8); dot.y = 6;
      dot.fills = [{ type: 'SOLID', color: hexToRgb(item.color || '#0e0e0e') }];
      dot.cornerRadius = 2;

      const lbl = figma.createText();
      lbl.characters = item.label;
      lbl.fontSize   = 11;
      lbl.fontName   = { family: 'Inter', style: 'Regular' };
      lbl.fills      = [{ type: 'SOLID', color: hexToRgb('#888888') }];

      const pair = figma.createFrame();
      pair.fills = [];
      pair.layoutMode = 'HORIZONTAL';
      pair.itemSpacing = 6;
      pair.primaryAxisSizingMode = 'AUTO';
      pair.counterAxisSizingMode = 'AUTO';
      pair.appendChild(dot);
      pair.appendChild(lbl);
      group.appendChild(pair);
    }

    frame.appendChild(group);
    return { nodeId: group.id };
  },

  add_text: async ({ frameId, text, fontSize = 14, fontWeight = 'regular', color = '#0e0e0e', x = 40, y, width }) => {
    await loadFonts();
    const frame = figma.getNodeById(frameId);
    if (!frame) throw new Error(`Frame ${frameId} not found`);

    const style = fontWeight === 'bold' ? 'Bold' : 'Regular';
    const node  = figma.createText();
    node.characters = text;
    node.fontSize   = fontSize;
    node.fontName   = { family: 'Inter', style };
    node.fills      = [{ type: 'SOLID', color: hexToRgb(color) }];
    node.x          = x;

    if (y != null) {
      node.y = y;
    } else {
      const children = frame.children;
      node.y = children.length > 0
        ? children[children.length - 1].y + children[children.length - 1].height + 12
        : 40;
    }

    if (width) {
      node.textAutoResize = 'HEIGHT';
      node.resize(width, node.height);
    }

    frame.appendChild(node);
    return { nodeId: node.id };
  },

  update_text: async ({ frameId, nodeName, newText }) => {
    await loadFonts();
    const frame = figma.getNodeById(frameId);
    if (!frame) throw new Error(`Frame ${frameId} not found`);
    const node = frame.findOne(n => n.type === 'TEXT' && n.name === nodeName);
    if (!node) throw new Error(`Text node "${nodeName}" not found`);
    node.characters = newText;
    return { nodeId: node.id };
  },

  delete_node: async ({ nodeId }) => {
    const node = figma.getNodeById(nodeId);
    if (!node) throw new Error(`Node ${nodeId} not found`);
    node.remove();
    return { deleted: nodeId };
  },

  focus_frame: async ({ frameId }) => {
    const frame = figma.getNodeById(frameId);
    if (!frame) throw new Error(`Frame ${frameId} not found`);
    figma.viewport.scrollAndZoomIntoView([frame]);
    return { ok: true };
  },

  set_fill_color: async ({ nodeId, color }) => {
    const node = figma.getNodeById(nodeId);
    if (!node) throw new Error(`Node ${nodeId} not found`);
    node.fills = [{ type: 'SOLID', color: hexToRgb(color) }];
    return { ok: true };
  },

  duplicate_frame: async ({ frameId, newName, offsetX = 960 }) => {
    const frame = figma.getNodeById(frameId);
    if (!frame) throw new Error(`Frame ${frameId} not found`);
    const clone = frame.clone();
    clone.name  = newName || `${frame.name} copy`;
    clone.x     = frame.x + offsetX;
    clone.y     = frame.y;
    figma.currentPage.appendChild(clone);
    figma.viewport.scrollAndZoomIntoView([clone]);
    return { newFrameId: clone.id };
  },

  dump_components: async ({ pageOnly = true }) => {
    const scope = pageOnly ? figma.currentPage : figma.root;
    const nodes = scope.findAll(n => n.type === 'COMPONENT' || n.type === 'COMPONENT_SET');
    return {
      count: nodes.length,
      pageOnly,
      components: nodes.map(c => ({
        id: c.id,
        name: c.name,
        type: c.type,
        description: c.description || '',
        ...(c.type === 'COMPONENT_SET' ? {
          variantGroupProperties: (c.variantGroupProperties || []).map(p => ({
            name: p.name,
            type: p.type,
            values: p.values
          })),
          variants: c.children.filter(v => v.type === 'COMPONENT').map(v => ({
            id: v.id,
            name: v.name,
          }))
        } : {})
      }))
    };
  },

  dump_tokens: async () => {
    const paints = figma.getLocalPaintStyles().map(s => ({
      id: s.id, name: s.name, paints: s.paints.map(p => ({
        type: p.type,
        color: p.type === 'SOLID' && p.color ? { r: p.color.r, g: p.color.g, b: p.color.b } : null,
        opacity: p.type === 'SOLID' && p.opacity != null ? p.opacity : null
      }))
    }));
    const texts = figma.getLocalTextStyles().map(s => ({
      id: s.id, name: s.name, fontSize: s.fontSize, fontName: s.fontName,
      lineHeight: s.lineHeight, letterSpacing: s.letterSpacing
    }));
    const effects = figma.getLocalEffectStyles().map(s => ({
      id: s.id, name: s.name, effects: s.effects.map(e => ({
        type: e.type,
        color: e.color ? { r: e.color.r, g: e.color.g, b: e.color.b, a: e.color.a } : null,
        offset: e.offset, radius: e.radius, spread: e.spread
      }))
    }));
    let variables = [];
    try {
      variables = figma.variables.getLocalVariableCollections().map(col => ({
        id: col.id, name: col.name,
        modes: col.modes.map(m => ({ name: m.name, modeId: m.modeId })),
        variables: col.variableIds.map(vid => {
          const v = figma.variables.getVariableById(vid);
          return v ? { id: v.id, name: v.name, resolvedType: v.resolvedType } : null;
        }).filter(Boolean)
      }));
    } catch (e) { /* variables API may not be available in older Figma versions */ }
    return { paints, texts, effects, variables };
  },

  dump_selection: async () => {
    const nodes = figma.currentPage.selection;
    return {
      count: nodes.length,
      nodes: nodes.map(n => ({
        id: n.id,
        name: n.name,
        type: n.type,
        x: n.x, y: n.y, width: n.width, height: n.height
      }))
    };
  }
};

// ── Message bridge from UI ───────────────────────────────────────────────────
figma.ui.onmessage = async (msg) => {
  const { id, command, payload } = msg;
  try {
    const handler = handlers[command];
    if (!handler) throw new Error(`Unknown command: ${command}`);
    const result = await handler(payload || {});
    figma.ui.postMessage({ id, result });
  } catch (e) {
    figma.ui.postMessage({ id, error: e.message });
  }
};
