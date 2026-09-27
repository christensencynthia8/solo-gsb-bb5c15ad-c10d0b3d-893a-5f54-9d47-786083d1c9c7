'use strict';
/**
 * 备选节目单（top-K，K=3）的随机对拍：
 * 小规模实例（n ≤ 6）下，用"枚举全部可行编排 + 完整排序"暴力求前 3 条，
 * 与 solver 返回的 alternatives 逐条核对（顺序、代价、价值完全一致）。
 *
 * 重点回归：次优编排与最优编排经过同一中间状态但前缀不同——
 * 每个 DP 状态只保留一条最优路径的实现会漏掉这些候选。
 */
const { solve } = require('./solver');

let seed = 20260926;
function rnd() { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; }
function ri(n) { return Math.floor(rnd() * n); }

function perms(arr) {
  const out = [];
  const rec = (a, k) => {
    if (k === a.length) { out.push(a.slice()); return; }
    for (let i = k; i < a.length; i++) {
      [a[k], a[i]] = [a[i], a[k]];
      rec(a, k + 1);
      [a[k], a[i]] = [a[i], a[k]];
    }
  };
  rec(arr, 0);
  return out;
}

/** 与求解器一致的候选比较：下标字典序（短序列在前）。 */
function lexCmp(a, b) {
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return a.length - b.length;
}

/** 暴力枚举全部可行编排，按备选规则排序后返回 [{ cost, order(下标), value }]。 */
function bruteAll(scenes, constraints, mode, timeLimit, opLimit) {
  const n = scenes.length;
  const cap = (opLimit === undefined || opLimit === null) ? Infinity : opLimit;
  const idx = new Map(scenes.map((s, i) => [s.id, i]));
  const props = scenes.map(s => new Set(s.props));
  let reqMask = 0;
  scenes.forEach((s, i) => { if (mode === 'timed' && s.required) reqMask |= 1 << i; });

  const deps = (constraints.dependencies || []).map(d => [idx.get(d.before), idx.get(d.after)]);
  const fixedSets = new Map();
  for (const f of constraints.fixedPositions || []) {
    const g = idx.get(f.sceneId);
    if (!fixedSets.has(g)) fixedSets.set(g, new Set());
    fixedSets.get(g).add(f.position - 1);
  }
  const bad = Array.from({ length: n }, () => Array(n).fill(false));
  for (const f of constraints.forbiddenAdjacencies || []) {
    bad[idx.get(f.a)][idx.get(f.b)] = true;
    bad[idx.get(f.b)][idx.get(f.a)] = true;
  }
  const setup = scenes.map((_, i) => props[i].size);
  const ccost = (a, b) => {
    let c = 0;
    for (const p of props[a]) if (!props[b].has(p)) c++;
    for (const p of props[b]) if (!props[a].has(p)) c++;
    return c;
  };

  const out = [];
  const considerPerm = (perm) => {
    const inSet = (g) => perm.includes(g);
    for (const [a, b] of deps) {
      if (inSet(a) && inSet(b) && perm.indexOf(a) >= perm.indexOf(b)) return;
    }
    for (const g of perm) {
      const fs = fixedSets.get(g);
      if (fs) {
        const pos = perm.indexOf(g);
        for (const p of fs) if (p !== pos) return;
      }
    }
    for (let i = 0; i + 1 < perm.length; i++) {
      if (bad[perm[i]][perm[i + 1]]) return;
    }
    let cost = 0;
    if (perm.length) {
      if (setup[perm[0]] > cap) return;
      cost += setup[perm[0]];
      for (let i = 1; i < perm.length; i++) {
        const e = ccost(perm[i - 1], perm[i]);
        if (e > cap) return;
        cost += e;
      }
    }
    let value = 0;
    if (mode === 'timed') {
      for (const g of perm) if (!scenes[g].required) value += scenes[g].value;
    }
    out.push({ cost, order: perm.slice(), value });
  };

  if (mode === 'classic') {
    for (const perm of perms(scenes.map((_, i) => i))) considerPerm(perm);
  } else {
    // mask = 0 时 perms([]) 产生空排列，即空节目单（仅无必演项时可达）
    for (let mask = 0; mask < (1 << n); mask++) {
      if ((mask & reqMask) !== reqMask) continue;
      const members = [];
      let dur = 0;
      for (let i = 0; i < n; i++) {
        if (mask & (1 << i)) { members.push(i); dur += scenes[i].duration; }
      }
      if (dur > timeLimit) continue;
      for (const perm of perms(members)) considerPerm(perm);
    }
  }

  out.sort((x, y) => {
    if (mode === 'timed' && x.value !== y.value) return y.value - x.value;
    if (x.cost !== y.cost) return x.cost - y.cost;
    return lexCmp(x.order, y.order);
  });
  return out;
}

function randomInstance() {
  const n = 1 + ri(6);
  const scenes = [];
  const propPool = ['p1', 'p2', 'p3', 'p4'];
  for (let i = 0; i < n; i++) {
    const ps = [];
    for (let k = 0; k < ri(3); k++) ps.push(propPool[ri(propPool.length)]);
    scenes.push({
      id: `s${i}`, name: `s${i}`, props: [...new Set(ps)],
      duration: ri(12),
      required: rnd() < 0.4,
      value: ri(8),
    });
  }
  const constraints = { dependencies: [], fixedPositions: [], forbiddenAdjacencies: [] };
  for (let k = 0; k < ri(4); k++) {
    const a = ri(n), b = ri(n);
    if (a !== b) constraints.dependencies.push({ before: `s${a}`, after: `s${b}` });
  }
  for (let k = 0; k < ri(3); k++) {
    constraints.fixedPositions.push({ sceneId: `s${ri(n)}`, position: 1 + ri(n) });
  }
  for (let k = 0; k < ri(3); k++) {
    const a = ri(n), b = ri(n);
    if (a !== b) constraints.forbiddenAdjacencies.push({ a: `s${a}`, b: `s${b}` });
  }
  return {
    scenes, constraints,
    mode: rnd() < 0.5 ? 'classic' : 'timed',
    timeLimit: 1 + ri(n * 13),
    opLimit: rnd() < 0.5 ? 1 + ri(4) : null,
  };
}

const N = Number(process.argv[2] || 300);
let tested = 0;
for (let it = 0; it < N; it++) {
  const { scenes, constraints, mode, timeLimit, opLimit } = randomInstance();
  const r = solve(scenes, constraints, { mode, timeLimit, opLimit, alternatives: 3 });
  const top = bruteAll(scenes, constraints, mode, timeLimit, opLimit).slice(0, 3);
  tested++;

  const dump = () => JSON.stringify({
    scenes, constraints, mode, timeLimit, opLimit,
    got: r.ok ? r.alternatives && r.alternatives.map(a => ({ order: a.order, cost: a.totalCost, value: a.totalValue })) : r.conflict,
    exp: top.map(t => ({ order: t.order.map(i => scenes[i].id), cost: t.cost, value: t.value })),
  }, null, 1);

  if (top.length === 0) {
    if (r.ok) {
      console.log('MISMATCH: 暴力无可行编排但 solver 有解', dump());
      process.exit(1);
    }
    continue;
  }
  if (!r.ok) {
    console.log('MISMATCH: 暴力有可行编排但 solver 无解', dump());
    process.exit(1);
  }
  if (!Array.isArray(r.alternatives)) {
    console.log('MISMATCH: 响应缺少 alternatives', dump());
    process.exit(1);
  }
  if (r.alternatives.length !== top.length) {
    console.log('MISMATCH: 备选条数不一致', dump());
    process.exit(1);
  }
  // 单条结果的目标值必须与暴力最优一致（顺序可因并列而不同）
  if (r.totalCost !== top[0].cost || (mode === 'timed' && r.totalValue !== top[0].value)) {
    console.log('MISMATCH: 单条结果目标值与暴力最优不一致', dump());
    process.exit(1);
  }
  for (let i = 0; i < top.length; i++) {
    const a = r.alternatives[i];
    const expIds = top[i].order.map(g => scenes[g].id);
    if (JSON.stringify(a.order) !== JSON.stringify(expIds)
        || a.totalCost !== top[i].cost
        || (mode === 'timed' && a.totalValue !== top[i].value)) {
      console.log(`MISMATCH: 第 ${i + 1} 条备选不一致`, dump());
      process.exit(1);
    }
  }
}
console.log(`备选节目单随机对拍 ${tested} 例全部一致 ✔`);
