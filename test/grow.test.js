// 养成规则：先天特质、后天性格、胖瘦、慢慢发现特质
const test = require('node:test');
const assert = require('node:assert/strict');
const G = require('../src/renderer/grow.js');

test('特质：同一个种子永远同一套，宠物 id 当种子时组里每台电脑都一样', () => {
  const a = G.traitsFromSeed(G.seedFrom('3f0a1c2e-pet')), b = G.traitsFromSeed(G.seedFrom('3f0a1c2e-pet'));
  assert.deepEqual(a, b);
  assert.notDeepEqual(a, G.traitsFromSeed(G.seedFrom('another-pet')));
  for (const k of G.TRAITS) assert.ok(a[k] >= -1 && a[k] <= 1, k);
});

test('特质：大多数狗靠近一般，特别突出的少', () => {
  let strong = 0, n = 0;
  for (let s = 1; s <= 400; s++) for (const v of Object.values(G.traitsFromSeed(s))) { n++; if (Math.abs(v) > 0.7) strong++; }
  assert.ok(strong / n < 0.15, `突出的占 ${(strong / n * 100).toFixed(1)}%`);
  assert.ok(strong > 0, '但也不是一个都没有');
});

test('特质有得有失：贪吃的吃得更撑、常去碗边；胃大的扛饿；活泼的累得快', () => {
  const e = G.effects({ appetite: 1, stomach: 1, energy: 1 });
  assert.ok(e.snackMul > 2 && e.fullAt > 0.97);
  assert.ok(e.digestMul < 1, '胃大消化慢');
  assert.ok(e.drainMul > 1 && e.walkMul > 1 && e.lieMul < 1);
  const z = G.effects({});
  assert.equal(z.snackMul, 1); assert.equal(z.digestMul, 1); assert.equal(z.attentionMul, 1);
  const lazy = G.effects({ energy: -1, appetite: -1, stomach: -1 });
  assert.ok(lazy.drainMul < 1 && lazy.snackMul < 1 && lazy.fullAt < 0.96, '慵懒、挑嘴、胃小反过来');
});

test('性格：摸它、回应它慢慢变亲，晾着它慢慢变冷淡；一天最多变一点点', () => {
  let p = G.initPersona();
  for (let i = 0; i < 5; i++) p = G.personaAfter(p, 'answer', '2026-11-26');
  assert.ok(p.warmth > 0.04 && p.warmth < 0.06);
  for (let i = 0; i < 100; i++) p = G.personaAfter(p, 'pet', '2026-11-26');
  assert.ok(p.warmth <= 0.08 + 1e-9, '一天封顶');
  const capped = p.warmth;
  p = G.personaAfter(p, 'pet', '2026-11-26');
  assert.equal(p.warmth, capped, '封顶以后当天不再涨');
  p = G.personaAfter(p, 'pet', '2026-11-27');
  assert.ok(p.warmth > capped, '第二天又能涨');
  const q = G.personaAfter(G.initPersona(), 'ignored', 'd');
  assert.ok(q.warmth < 0);
  const d = G.personaDrift({ warmth: 0.6, boldness: -0.4 }, 7 * 24 * 3600);
  assert.ok(Math.abs(d.warmth - 0.3) < 1e-9 && Math.abs(d.boldness + 0.2) < 1e-9, '一周回一半');
});

test('胖瘦：一直吃撑五天胖满一档，饿着、走路慢慢瘦', () => {
  const day = 24 * 3600;
  assert.ok(Math.abs(G.weightTick(0, 5 * day, { belly: 0.95 }) - 1) < 1e-9);
  assert.equal(G.weightTick(0, day, { belly: 0.6 }), 0, '平常吃不胖');
  assert.ok(G.weightTick(0.5, day, { belly: 0.1, walking: true }) < 0.5 - 0.3);
  assert.equal(G.weightWord(0.7), '胖乎乎的');
  assert.equal(G.weightWord(0), '');
});

test('特质要攒够证据才写进日记，一般的特质不写，写过的不再写', () => {
  const traits = { appetite: 0.8, energy: 0.1, clingy: -0.6, stomach: 0, curious: 0 };
  assert.equal(G.discover(traits, { appetite: 3 }, []).length, 0, '证据不够');
  const found = G.discover(traits, { appetite: 8, energy: 50, clingy: 6 }, []);
  assert.deepEqual(found.map(f => f.trait), ['appetite', 'clingy']);
  assert.match(found[0].text, /馋/);
  assert.match(found[1].text, /独立/);
  assert.equal(G.discover(traits, { appetite: 8, clingy: 6 }, ['appetite', 'clingy']).length, 0);
});

test('养成存档：坏数据不会弄坏', () => {
  assert.equal(G.sanitizeGrow(null), null);
  assert.equal(G.sanitizeGrow({ seed: 'x' }), null);
  const g = G.sanitizeGrow({ seed: 7, weight: 9, persona: { warmth: -5 }, clues: { appetite: 3, bogus: 9 }, known: ['appetite', 'nope'] });
  assert.equal(g.weight, 1); assert.equal(g.persona.warmth, -1);
  assert.equal(g.clues.appetite, 3); assert.equal(g.clues.bogus, undefined);
  assert.deepEqual(g.known, ['appetite']);
  assert.equal(G.ageDays({ born: Date.now() - 3.5 * 864e5 }), 3);
});

test('值得记一笔的日子：只记新跨过的那一个', () => {
  assert.equal(G.ageMark(5, 0), 0);
  assert.equal(G.ageMark(8, 0), 7);
  assert.equal(G.ageMark(8, 7), 0, '记过了不再记');
  assert.equal(G.ageMark(120, 7), 100, '好几天没开：只记最近跨过的那个');
});
