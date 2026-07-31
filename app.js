// ---- App state ----
const state = {
  scene: 0,   // index into SCENES
  orgFilter: null   // highlighted company chip, or null = show all equally
};

// ---- Layout (the svg is scaled responsively via viewBox) ----
const W = 900, H = 520;
const M = { top: 40, right: 72, bottom: 55, left: 24 };   // Y axis lives on the RIGHT
const iw = W - M.left - M.right;   // inner plot width
const ih = H - M.top - M.bottom;   // inner plot height

// ---- Palette: colors are declared in CSS (:root) and read back here ----
const cssVar = (name, fallback) =>
  getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;

const C = {
  bg:        cssVar('--bg', '#0e1117'),
  ink:       cssVar('--ink', '#e6edf3'),
  muted:     cssVar('--muted', '#8b949e'),
  accent:    cssVar('--accent', '#58a6ff'),   // trend lines, bands
  accentSoft:cssVar('--accent-soft', '#7cc0ff'),   // scale-up arrow
  zone:      cssVar('--efficient', '#3fb950'),   // on-device zone + its arrow
  frontier:  cssVar('--dot-frontier', '#ffb7c5'),   // frontier dots (cherry blossom)
  efficient: cssVar('--dot-efficient', '#a4d65e')   // on-device dots (yellow-green)
};

// ---- Company brand colors (Google & DeepMind merged; unbranded labs share grey) ----
const ORG_COLORS = {
  'OpenAI':    '#e5484d',   // red
  'Anthropic': '#b55937',   // sienna
  'Google':    '#188038',   // dark green
  'Meta':      '#0866ff',   // blue
  'Microsoft': '#ffb900',   // yellow
  'NVIDIA':    '#a855f7',   // purple
  'xAI':       '#e6edf3'
};
const OTHER_COLOR = '#6e7681';

// Marker settings 
const DOT_R = 6;
const OPACITY = { dot: 0.9, faded: 0.08, band: 0.10, line: 0.5 };
const STAR = d3.symbol().type(d3.symbolStar).size(220)();   // GPT-3 landmark marker

// ---- Scales (domains hug the data so each scatter fills the plot) ----
const x = d3.scaleTime()  // publication date
  .domain([new Date('2012-01-01'), new Date('2025-10-01')]).range([0, iw]);

const yFlop = d3.scaleLog()  // training compute on Y
  .domain([2e17, 8e26]).range([ih, 0]).clamp(true);

const xFlop = d3.scaleLog()  // training compute on X
  .domain([2e17, 8e26]).range([0, iw]).clamp(true);

const yParam = d3.scaleLog()  // model size on Y
  .domain([4e7, 3e12]).range([ih, 0]).clamp(true);

const xCompute = d3.scaleLog()  // scene 2: compute on X
  .domain([1.5e22, 8e26]).range([0, iw]).clamp(true);

const yEci = d3.scaleLinear()  // scene 2: capability on Y
  .domain([99, 152]).range([ih, 0]).clamp(true);

const BAND_HALF = 0.834;  // Trend band thickness

// Upper bound of the on-device zone
const ON_DEVICE_MAX = 4e9;

// Default source caption
const DEFAULT_SRC = 'Data: Epoch AI — Notable & Frontier AI Models dataset (CC-BY). ' +
  'Training-compute and parameter values are order-of-magnitude estimates.';

// ---- Data prep ----
// Normalize builder names: Google/DeepMind -> "Google"; Meta AI -> "Meta".
function normOrg(o){
  if(!o) return 'Other';
  if(/deepmind/i.test(o) || o === 'Google') return 'Google';
  if(/^meta/i.test(o)) return 'Meta';
  return o;
}

MODEL_DATA.forEach(d => { d.dt = new Date(d.date); d.orgN = normOrg(d.org); });
if(typeof ECI_DATA !== 'undefined') ECI_DATA.forEach(d => { d.orgN = normOrg(d.org); });

const isEfficient = d => d.category === 'efficient';
const withFlop    = () => MODEL_DATA.filter(d => d.flop);
const withParams  = () => MODEL_DATA.filter(d => d.params);
const withBoth    = () => MODEL_DATA.filter(d => d.params && d.flop);

const svg = d3.select('#chart')
  .attr('viewBox', `0 0 ${W} ${H}`)
  .attr('preserveAspectRatio', 'xMidYMid meet');
const tip = d3.select('#tooltip');

// ---- Helpers ----
// ---- Company highlighting ----
const orgColor = d => ORG_COLORS[d.orgN] || OTHER_COLOR;

// Does a point match the active chip? ("Other" matches any unbranded builder.)
function orgMatch(d){
  if(!state.orgFilter) return true;
  if(state.orgFilter === 'Other') return !ORG_COLORS[d.orgN];
  return d.orgN === state.orgFilter;
}

// Full opacity when nothing is highlighted; otherwise fade everything unmatched.
const dotOpacity = d => (orgMatch(d) ? OPACITY.dot : OPACITY.faded);

// ---- Formatting ----
const fmtFlop = v => v ? d3.format('.1e')(v).replace('e+', 'e') + ' FLOP' : 'n/a';
const fmtParam = v => !v ? 'n/a' : (v >= 1e9 ? (v / 1e9) + 'B params' : (v / 1e6) + 'M params');
const est = flag => flag ? ' <i>(est.)</i>' : '';

// Tooltip bodies
const tipModel = d => `<b>${d.model}</b><br>${d.org} &middot; ${d.date}<br>
  Compute: ${fmtFlop(d.flop)}${est(d.flopEst)}<br>Size: ${fmtParam(d.params)}${est(d.paramsEst)}`;
const tipEci = d => `<b>${d.model}</b><br>${d.orgN}${d.date ? ' &middot; ' + d.date : ''}<br>
  Capability (ECI): <b>${d.eci}</b><br>Compute: ${fmtFlop(d.flop)}${est(d.flopEst)}`;

// ---- statistics ----
// Ordinary least-squares fit of fy(row) on fx(row); `at(v)` predicts y for a given x.
function linFit(rows, fx, fy){
  const xs = rows.map(fx), ys = rows.map(fy), n = xs.length;
  const sx = d3.sum(xs), sy = d3.sum(ys),
        sxy = d3.sum(xs.map((v, i) => v * ys[i])),
        sxx = d3.sum(xs.map(v => v * v));
  const slope = (n * sxy - sx * sy) / (n * sxx - sx * sx);
  const intercept = (sy - slope * sx) / n;
  return { slope, intercept, at: v => slope * v + intercept };
}

// A straight line through two points in (u, log10 params) space, where `u` is
// whatever quantity the X axis encodes (a timestamp, or log10 of compute)
function logLine(u1, lp1, u2, lp2){
  const m = (lp2 - lp1) / (u2 - u1), b = lp1 - m * u1;
  return u => m * u + b;
}

// Convert log params to pixel Y
function yParamLog(lp){
  const [lo, hi] = yParam.domain(), a = Math.log10(lo), b = Math.log10(hi);
  return ih * (1 - (lp - a) / (b - a));
}

let uidSeq = 0;
const uid = prefix => `${prefix}-${++uidSeq}`;   // Unique SVG ids

// ---- chart pieces ----
// Wipe the SVG and return the inner plot group.
function freshCanvas(){
  svg.selectAll('*').remove();
  return svg.append('g').attr('transform', `translate(${M.left},${M.top})`);
}

function axisLabelX(g, label){
  g.append('text').attr('class', 'axis-label')
    .attr('x', iw / 2).attr('y', ih + 45).attr('text-anchor', 'middle')
    .text(label);
}

// Time X axis (publication year)
function drawXAxisTime(g){
  g.append('g').attr('class', 'axis').attr('transform', `translate(0,${ih})`)
    .call(d3.axisBottom(x).ticks(7).tickFormat(d3.timeFormat('%Y')));
  axisLabelX(g, 'Publication Year');
}

// Log X axis (training compute)
function drawXAxisLog(g, scale, label){
  g.append('g').attr('class', 'axis').attr('transform', `translate(0,${ih})`)
    .call(d3.axisBottom(scale).ticks(8, '~e'));
  axisLabelX(g, label);
}

// Y axis, always on the RIGHT. Returns the label so callers can emphasize it.
function drawYAxis(g, scale, label, opts = {}){
  const ax = g.append('g').attr('class', 'axis').attr('transform', `translate(${iw},0)`)
    .call(d3.axisRight(scale).ticks(10, opts.linear ? null : '~e'));
  if(opts.animate) ax.attr('opacity', 0).transition().duration(700).attr('opacity', 1);
  return g.append('text').attr('class', 'axis-label')
    .attr('transform', 'rotate(-90)')
    .attr('x', -ih / 2).attr('y', iw + 56).attr('text-anchor', 'middle')
    .text(label);
}

// ---- marks ----
// Scatter dots, colored by `fill`, faded when a company chip is active.
function drawDots(g, pts, fx, fy, fill){
  return g.selectAll('.dot').data(pts).join('circle')
    .attr('class', 'dot')
    .attr('cx', fx).attr('cy', fy).attr('r', DOT_R)
    .attr('fill', fill)
    .attr('stroke', C.bg).attr('stroke-width', 1)
    .attr('opacity', dotOpacity);
}

// Dot fill by narrative category: on-device green vs frontier pink.
const categoryFill = d => isEfficient(d) ? C.efficient : C.frontier;

// GPT-3 landmark: a ★ instead of a circle, with its name alongside.
function drawLandmark(g, d, cx, cy, fill, side){
  const left = side === 'left';
  g.append('path').datum(d).attr('class', 'dot')
    .attr('d', STAR).attr('transform', `translate(${cx},${cy})`)
    .attr('fill', fill).attr('stroke', C.bg).attr('stroke-width', 1)
    .attr('opacity', dotOpacity(d));
  g.append('text').attr('class', 'landmark-label')
    .attr('x', cx + (left ? -12 : 12)).attr('y', cy + 4)
    .attr('text-anchor', left ? 'end' : 'start')
    .attr('fill', C.muted).attr('font-size', 11)
    .attr('opacity', dotOpacity(d))
    .text('GPT-3');
}

// Dashed guide line 
function dashedLine(g, points, fx, fy, opacity = OPACITY.line){
  g.append('path').datum(points)
    .attr('fill', 'none').attr('stroke', C.accent).attr('stroke-dasharray', '5 5')
    .attr('opacity', opacity).attr('stroke-width', 1.5)
    .attr('d', d3.line().x(fx).y(fy));
}

// Draw trend band
function drawBand(g, { u0, u1, line, xOf, color, half = BAND_HALF }){
  const clipId = uid('band');
  g.append('clipPath').attr('id', clipId)
    .append('rect').attr('width', iw).attr('height', ih);
  const edge = (u, off) => [xOf(u), yParamLog(line(u) + off)];
  g.append('path').attr('clip-path', `url(#${clipId})`)
    .attr('d', d3.line()([edge(u0, half), edge(u1, half),
                          edge(u1, -half), edge(u0, -half)]) + 'Z')
    .attr('fill', color).attr('opacity', OPACITY.band);
}

// Arrowhead marker definitions; returns the id to reference via marker-end.
function defineArrowhead(g, color){
  const id = uid('arrow');
  g.append('defs').append('marker').attr('id', id).attr('markerUnits', 'userSpaceOnUse')
    .attr('viewBox', '0 0 10 10').attr('refX', 8).attr('refY', 5)
    .attr('markerWidth', 9).attr('markerHeight', 9).attr('orient', 'auto')
    .append('path').attr('d', 'M0,0 L10,5 L0,10 z').attr('fill', color);
  return id;
}

// A thin directional arrow between two pixel points.
function drawArrow(g, p0, p1, color, markerId){
  return g.append('path').attr('d', `M${p0[0]},${p0[1]} L${p1[0]},${p1[1]}`)
    .attr('fill', 'none').attr('stroke', color).attr('stroke-width', 2)
    .attr('opacity', 0.9).attr('marker-end', `url(#${markerId})`);
}

// The "on-device zone": dashed ceiling, left-edge bracket, rotated label.
// Used by scenes 3 and 4.
function drawOnDeviceZone(g){
  const zTop = yParam(ON_DEVICE_MAX), zBot = ih;
  g.append('line')
    .attr('x1', 0).attr('x2', iw).attr('y1', zTop).attr('y2', zTop)
    .attr('stroke', C.zone).attr('stroke-dasharray', '4 3').attr('opacity', .5);
  g.append('path')
    .attr('d', `M9,${zTop} H2 V${zBot} H9`)
    .attr('fill', 'none').attr('stroke', C.zone).attr('opacity', .7).attr('stroke-width', 1.5);
  g.append('text')
    .attr('transform', `translate(20,${(zTop + zBot) / 2}) rotate(-90)`)
    .attr('text-anchor', 'middle').attr('fill', C.zone)
    .attr('font-size', 11).attr('font-weight', 600)
    .text('On-device zone (≤ ~4B params)');
}

// ---- text: annotations, corner notes, free-standing callouts ----
// Annotation helpers
function drawAnnotations(g, notes){
  const makeAnnotations = d3.annotation()
    .type(d3.annotationCalloutElbow)
    .notePadding(8)
    .annotations(notes.map(n => ({
      note: { title: n.title, label: n.label, wrap: n.wrap || 190, align: n.align || 'left' },
      x: n.x, y: n.y, dx: n.dx, dy: n.dy,
      color: C.ink,
      subject: { radius: 10, radiusPadding: 3 }
    })));
  g.append('g').attr('class', 'annotation-group').call(makeAnnotations);
}

// Title + muted body text block, anchored at (tx, ty)
function textBlock(g, tx, ty, title, lines, anchor = 'start'){
  const grp = g.append('g');
  grp.append('text').attr('x', tx).attr('y', ty).attr('text-anchor', anchor)
    .attr('fill', C.ink).attr('font-size', 13).attr('font-weight', 600).text(title);
  lines.forEach((ln, i) =>
    grp.append('text').attr('x', tx).attr('y', ty + 18 + i * 16).attr('text-anchor', anchor)
      .attr('fill', C.muted).attr('font-size', 12).text(ln));
  return grp;
}

// Greedy word wrap at ~`max` characters per line.
function wrapText(label, max = 52){
  const lines = [];
  let line = '';
  (label || '').split(' ').forEach(w => {
    if((line + ' ' + w).trim().length > max){ lines.push(line.trim()); line = w; }
    else line = (line + ' ' + w).trim();
  });
  if(line) lines.push(line.trim());
  return lines;
}

// Fixed note pinned to the TOP-LEFT of the plot
function cornerNote(g, title, label){
  textBlock(g, 6, 18, title, wrapText(label));
}

// ---- legends (bottom-right of the plot) ----
function drawLegend(g, items, boxW){
  const rowH = 16, boxH = items.length * rowH + 8;
  const lg = g.append('g').attr('class', 'legend')
    .attr('transform', `translate(${iw - boxW - 6},${ih - boxH})`);
  lg.append('rect').attr('x', -8).attr('y', -4).attr('width', boxW).attr('height', boxH)
    .attr('rx', 6).attr('fill', C.bg).attr('opacity', .6);
  items.forEach((it, i) => {
    const row = lg.append('g').attr('transform', `translate(0,${i * rowH + 10})`);
    row.append('circle').attr('r', 5).attr('cx', 4).attr('cy', -4).attr('fill', it.c);
    row.append('text').attr('x', 16).attr('y', 0).text(it.t);
  });
}

// Company legend (Scene 1)
function drawCompanyLegend(g, pts){
  const items = orgsPresent(pts).map(o => ({ c: ORG_COLORS[o] || OTHER_COLOR, t: o }));
  drawLegend(g, items, 140);
}

// Category legend (Scenes 3–4)
const drawCategoryLegend = g =>
  drawLegend(g, [{ c: C.frontier, t: 'Frontier' }, { c: C.efficient, t: 'Efficient' }], 104);

// Distinct organizations in display order alphabetically, then "Other".
function orgsPresent(pts){
  const present = Array.from(new Set(pts.map(d => d.orgN)));
  const branded = present.filter(o => ORG_COLORS[o]).sort();
  return present.some(o => !ORG_COLORS[o]) ? [...branded, 'Other'] : branded;
}

// Tooltip
function attachTooltip(sel, fmt){
  sel.on('mousemove', (event, d) => {
      tip.style('opacity', 1)
         .style('left', (event.clientX + 14) + 'px')
         .style('top', (event.clientY + 14) + 'px')
         .html(fmt(d));
    })
    .on('mouseout', () => tip.style('opacity', 0));
}

// ---- scenes (storyboard order) ----
const SCENES = [

// ---------------- Scene 1: the compute explosion & the race ----------------
{
  title: 'The Compute Explosion & the Race',
  sub: 'Training compute of notable AI models, 2012–2025 (log scale) — each step up is 10× more compute. Frontier training compute grew ~4–5× every year for a decade, about ten orders of magnitude in all. Dots are colored by the company that built the model (GPT-3, marked with a ★, is the landmark that opened the language-model era). Filter to a company to trace its path up the frontier.',
  hint: 'X = Publication Year, Y = Training Compute (FLOP, log). Click a company chip to highlight it; hover any dot for details.',
  filters: true,
  brandChips: true,   // this is the one scene whose dots are brand-colored
  data: withFlop,
  render(g){
    drawXAxisTime(g);
    drawYAxis(g, yFlop, 'Training Compute (FLOP, log scale)');

    const pts = this.data();
    const gpt3 = pts.find(d => d.model === 'GPT-3 175B');

    // Trend line for frontier models
    const fit = linFit(pts.filter(d => !isEfficient(d)),
                       d => d.dt.getTime(), d => Math.log10(d.flop));
    const guide = [new Date('2012-06-01'), new Date('2025-09-01')]
      .map(dt => ({ dt, v: Math.pow(10, fit.at(dt.getTime())) }));
    dashedLine(g, guide, d => x(d.dt), d => yFlop(d.v), .4);

    drawDots(g, pts.filter(d => d !== gpt3), d => x(d.dt), d => yFlop(d.flop), orgColor);
    if(gpt3) drawLandmark(g, gpt3, x(gpt3.dt), yFlop(gpt3.flop), orgColor(gpt3), 'right');

    attachTooltip(g.selectAll('.dot'), d => tipModel(d) + `<br><i>${d.country}</i>`);

    // When a company is selected, annotate its top model; otherwise a general note.
    const sel = state.orgFilter &&
      pts.filter(orgMatch).sort((a, b) => b.flop - a.flop)[0];
    if(sel){
      drawAnnotations(g, [{
        title: `${state.orgFilter}'s frontier`,
        label: `${sel.model} — ${fmtFlop(sel.flop)}`,
        x: x(sel.dt), y: yFlop(sel.flop), dx: -120, dy: -30
      }]);
    } else {
      cornerNote(g, 'A widening race',
        'Early on, just a few labs (Google, OpenAI). Lately the frontier is crowded — xAI, Meta, Anthropic, and Chinese labs.');
    }
    drawCompanyLegend(g, pts);
  }
},

// ---------------- Scene 2: compute buys capability ----------------
{
  title: 'More Compute, More Capability',
  sub: "First, does training compute actually buy performance? Each dot is a model: X = training compute, Y = its capability score (Epoch Capabilities Index, a single number stitched across many benchmarks). The two rise together — a strong correlation (r ≈ 0.87). Compute isn't capability, but it's a good proxy for it.",
  hint: 'X = Training Compute (FLOP, log), Y = Capability (ECI). Click a company chip to highlight it; hover any dot for details.',
  src: 'Data: Epoch AI — ECI Benchmarks + Notable & Frontier AI Models (CC-BY). Capability = Epoch Capabilities Index (IRT fit, anchored Claude 3.5 Sonnet = 130); training-compute values are order-of-magnitude estimates.',
  filters: true,
  data: () => ECI_DATA,
  render(g){
    drawXAxisLog(g, xCompute, 'Training Compute (FLOP, log scale)');
    drawYAxis(g, yEci, 'Capability — Epoch Capabilities Index', { linear: true });

    const pts = this.data();

    // Regression line
    const fit = linFit(pts, d => Math.log10(d.flop), d => d.eci);
    const trend = d3.extent(pts, d => d.flop).map(c => ({ c, v: fit.at(Math.log10(c)) }));
    dashedLine(g, trend, d => xCompute(d.c), d => yEci(d.v));

    // Company highlighting by opacity
    drawDots(g, pts, d => xCompute(d.flop), d => yEci(d.eci), C.frontier);
    attachTooltip(g.selectAll('.dot'), tipEci);

    cornerNote(g, 'Strong link (r ≈ 0.87)',
      'More training compute → higher capability. Compute is a solid proxy for performance.');
  }
},

// ---------------- Scene 3: compute vs size ----------------
{
  title: 'Compute vs Size',
  sub: 'Putting size and compute on one plot: X = training compute, Y = model size. Along the main line, more compute & capability → bigger models — the frontier keeps growing. Meanwhile a second group breaks the pattern: models that grow more capable while staying small, optimizing memory to run on-device.',
  hint: 'X = Training Compute (FLOP, log), Y = Model Size (parameters, log). Click a company chip to highlight it; hover any dot for details.',
  filters: true,
  data: withBoth,
  render(g){
    drawXAxisLog(g, xFlop, 'Training Compute (FLOP, log scale)');
    drawYAxis(g, yParam, 'Model Size — Parameters (log scale)');

    const pts = this.data();

    // Scaling trend: anchored on the two extremes: AlexNet(bottom-left) and Llama4 Behemoth(top-right)
    const alex = pts.reduce((a, b) => a.flop <= b.flop ? a : b);
    const big  = pts.reduce((a, b) => a.params >= b.params ? a : b);
    const line = logLine(Math.log10(alex.flop), Math.log10(alex.params),
                         Math.log10(big.flop),  Math.log10(big.params));
    const [fmin, fmax] = d3.extent(pts, d => d.flop);

    // u here is log10(compute).
    drawBand(g, { u0: Math.log10(fmin), u1: Math.log10(fmax),
                  line, xOf: u => xFlop(Math.pow(10, u)), color: C.accent });
    dashedLine(g, [alex, big], d => xFlop(d.flop), d => yParam(d.params));
    drawOnDeviceZone(g);

    const gpt3 = pts.find(d => d.model === 'GPT-3 175B');
    drawDots(g, pts.filter(d => d !== gpt3),
             d => xFlop(d.flop), d => yParam(d.params), categoryFill);
    if(gpt3) drawLandmark(g, gpt3, xFlop(gpt3.flop), yParam(gpt3.params), C.frontier, 'left');

    attachTooltip(g.selectAll('.dot'), tipModel);

    // Mistral 7B: same compute as GPT-3, smaller size
    const tiny = pts.find(d => d.model === 'Mistral 7B') ||
                 pts.filter(isEfficient).sort((a, b) => a.params - b.params)[0];
    const anchor = 5e20;   // for the "Scaling trend" callout on the band
    drawAnnotations(g, [
      { title: 'Scaling trend',
        label: 'More training compute → larger models. Compute and size rise together along this line.',
        x: xFlop(anchor),
        y: yParamLog(line(Math.log10(anchor)) + BAND_HALF),
        dx: -150, dy: -60 },
      { title: 'Small but capable',
        label: `${tiny.model} sits at GPT-3's compute (≈ its capability), yet is far smaller — trading raw size for memory-efficiency to fit on-device.`,
        x: xFlop(tiny.flop), y: yParam(tiny.params), dx: 28, dy: 22 }
    ]);
    drawCategoryLegend(g);
  }
},

// ---------------- Scene 4: small is the new big ----------------
{
  title: 'Small Is the New Big',
  sub: "This view plots model SIZE over TIME. The frontier keeps ballooning into hundreds of billions of parameters (pink dots) — yet a second class of smaller models (green), compact enough to run on phones and AI glasses, clusters in the 'on-device zone.' Notice these efficient models only begin appearing in the last few years — a recent break from the decade-long scale-up race. AI's evolution has now diverged into two major branches: an ever-larger frontier, and a new wave of compact, memory-efficient models built to run on-device.",
  hint: 'X = Publication Year, Y = Model Size (parameters, log). Click a company chip to highlight it; hover any dot for details.',
  filters: true,
  data: withParams,
  render(g){
    drawXAxisTime(g);
    drawYAxis(g, yParam, 'Model Size — Parameters (log scale)');

    const pts = this.data();
    drawOnDeviceZone(g);

    const ms = s => new Date(s).getTime();
    const lineOf = (a, b) => logLine(a.dt.getTime(), Math.log10(a.params),
                                     b.dt.getTime(), Math.log10(b.params));

    // Two directions out of the same history
    const alex = pts.reduce((a, b) => a.dt <= b.dt ? a : b);   // earliest
    const big  = pts.reduce((a, b) => a.params >= b.params ? a : b);   // largest
    const scaleUp = lineOf(alex, big);
    const [t0, t1] = d3.extent(pts, d => d.dt.getTime());
    drawBand(g, { u0: t0, u1: t1, line: scaleUp,
                  xOf: t => x(new Date(t)), color: C.accent });

    // Scale-up arrow, riding just above the blue band.
    const blueHead = defineArrowhead(g, C.accentSoft);
    const upOff = BAND_HALF + 0.35;
    const at = (line, t, off) => [x(new Date(t)), yParamLog(line(t) + off)];
    const a0 = ms('2013-01-01'), a1 = ms('2021-01-01'), aMid = (a0 + a1) / 2;
    drawArrow(g, at(scaleUp, a0, upOff), at(scaleUp, a1, upOff), C.accentSoft, blueHead);

    // Label for scale-up arrow
    const blueMid = at(scaleUp, aMid, upOff);
    textBlock(g, blueMid[0], blueMid[1] - 50, 'Top-end size keeps climbing',
      [`from AlexNet's ~60M to ${big.model}'s`, '~2 trillion parameters.'], 'end');

    // On-device arrow running parallel to the Chinchilla -> Gemma 3 line
    const chin = pts.find(d => d.model === 'Chinchilla');
    const gem  = pts.find(d => d.model === 'Gemma 3 1B');
    if(chin && gem){
      const down = lineOf(chin, gem), downOff = -(BAND_HALF + 0.30);
      const gS = ms('2022-01-01'), gE = ms('2025-01-01'), gMid = (gS + gE) / 2;
      const SHIFT_PX = 32;
      const onDevice = t => [x(new Date(t)) + SHIFT_PX, yParamLog(down(t) + downOff)];
      const p0 = onDevice(gS), p1 = onDevice(gMid);

      const greenHead = defineArrowhead(g, C.zone);
      drawArrow(g, p0, p1, C.zone, greenHead)
        .attr('opacity', 0).transition().delay(650).duration(500).attr('opacity', .9);

      const label = textBlock(g, (p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2 + 24,
        'New Wave', ['Memory-Efficient Models'], 'end').attr('opacity', 0);
      label.transition().delay(950).duration(500).attr('opacity', 1);   
    }

    drawDots(g, pts, d => x(d.dt), d => yParam(d.params), categoryFill);

    // Animation for the green (efficient) dots
    g.selectAll('.dot').filter(isEfficient)
      .attr('opacity', 0).attr('r', 0)
      .transition().delay((d, i) => 150 + i * 70).duration(450)
      .attr('r', DOT_R).attr('opacity', dotOpacity);

    attachTooltip(g.selectAll('.dot'), tipModel);
    drawCategoryLegend(g);
  }
}
];

// ---- controller: render loop + triggers ----
// Step navigation
function renderSteps(){
  d3.select('#steps').selectAll('button').data(SCENES).join('button')
    .attr('class', (d, i) => 'step-dot' + (i === state.scene ? ' active' : ''))
    .attr('title', d => d.title)
    .attr('aria-label', (d, i) => `Scene ${i + 1}: ${d.title}`)
    .text((d, i) => i + 1)
    .on('click', (e, d) => goToScene(SCENES.indexOf(d)));
}

// Company filters
function renderFilters(){
  const bar = d3.select('#filterbar');
  bar.selectAll('*').remove();

  const sc = SCENES[state.scene];
  if(!sc.filters) return;
  bar.append('span').attr('class', 'lbl').text('Highlight company:');

  // In category-colored scenes(2-4), the chips fall back to the neutral accent styling
  const chipColor = d => (sc.brandChips && d !== 'All') ? (ORG_COLORS[d] || OTHER_COLOR) : null;
  const isOn = d => (d === 'All') ? !state.orgFilter : d === state.orgFilter;

  bar.selectAll('button').data(['All', ...orgsPresent(sc.data())]).join('button')
    .attr('class', d => 'chip' + (isOn(d) ? ' active' : ''))
    .attr('aria-pressed', d => isOn(d))
    .style('border-color', chipColor)
    .style('color', d => isOn(d) ? null : chipColor(d))          // active -> CSS accent
    .style('background', d => (isOn(d) && d !== 'All') ? chipColor(d) : null)
    .text(d => d)
    .on('click', (e, d) => {
      state.orgFilter = (d === 'All') ? null : d;
      render();
    });
}

function render(){
  const sc = SCENES[state.scene];
  d3.select('#sceneTitle').text(sc.title);
  d3.select('#sceneSub').text(sc.sub);
  d3.select('#hint').text(sc.hint);
  d3.select('#srcNote').text(sc.src || DEFAULT_SRC);
  d3.select('#progress').text(`Scene ${state.scene + 1} of ${SCENES.length}`);
  d3.select('#prev').property('disabled', state.scene === 0);
  d3.select('#next').property('disabled', state.scene === SCENES.length - 1);
  renderSteps();
  renderFilters();
  sc.render(freshCanvas());
}

// Changing scene clears the company highlight
function goToScene(i){
  if(i < 0 || i >= SCENES.length || i === state.scene) return;
  state.scene = i;
  state.orgFilter = null;
  render();
}

// Navigation buttons
d3.select('#next').on('click', () => goToScene(state.scene + 1));
d3.select('#prev').on('click', () => goToScene(state.scene - 1));

render();
