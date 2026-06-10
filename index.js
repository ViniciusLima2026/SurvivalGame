// ================================================
//  RPG SURVIVAL — Servidor Autoritativo
//  Render.com — 24h online
// ================================================

const admin = require('firebase-admin');
const http  = require('http');

const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
admin.initializeApp({
  credential:  admin.credential.cert(serviceAccount),
  databaseURL: process.env.FIREBASE_DATABASE_URL,
});

const db = admin.database();

// ── Constantes ───────────────────────────────────
const WORLD          = 2400;
const MR             = 18;
const PR             = 16;
const MAX_MONSTERS   = 30;
const SPAWN_INTERVAL = 6000;
const MOVE_INTERVAL  = 120;
const CHASE_DIST     = 280;
const ATTACK_RANGE   = 170;
const ATTACK_COOLDOWN= 600;   // ms entre ataques por jogador
const MAX_SPEED      = 6;     // px por tick — speedhack prevention
const CONTACT_DAMAGE_CD = 900; // ms

// ── UIDs de administradores autorizados ──────────
const ADMIN_UIDS = new Set([
  '4pM7wRj1G8MvOos3WQIoYLziaCP2',
]);

// ── Estado do servidor ───────────────────────────
let players      = {};
let monsters     = {};
let monsterDirs  = {};
let attackCDs    = {};   // uid → timestamp último ataque
let contactCDs   = {};   // sessionKey → timestamp último dano de contato

// ── Escuta Firebase ──────────────────────────────
db.ref('players').on('value',  snap => { players  = snap.val() || {}; });
db.ref('monsters').on('value', snap => { monsters = snap.val() || {}; });

// ── Fila de intenções dos clientes ───────────────
db.ref('intents').on('child_added', async snap => {
  const intent = snap.val();
  const key    = snap.key;
  // Remove imediatamente para não reprocessar
  await snap.ref.remove();
  if (!intent || !intent.uid || !intent.type) return;
  handleIntent(intent);
});

// ── Roteador de intenções ────────────────────────
async function handleIntent(intent) {
  const { uid, type } = intent;

  switch (type) {

    case 'attack':
      await handleAttack(uid, intent.monsterId);
      break;

    case 'collect_coin':
      await handleCollectCoin(uid, intent.coinId);
      break;

    case 'collect_food':
      await handleCollectFood(uid, intent.foodId);
      break;

    case 'use_item':
      await handleUseItem(uid, intent.itemIndex);
      break;

    // ── Admin ──────────────────────────────────
    case 'admin_spawn_mob':
      if (!ADMIN_UIDS.has(uid)) return;
      adminSpawnMob(intent.mobType, intent.qty, intent.x, intent.y);
      break;

    case 'admin_spawn_item':
      if (!ADMIN_UIDS.has(uid)) return;
      adminSpawnItem(intent.itemType, intent.qty, intent.x, intent.y);
      break;

    case 'admin_save_me':
      if (!ADMIN_UIDS.has(uid)) return;
      adminSaveProfile(uid, intent.stats);
      break;

    case 'admin_save_player':
      if (!ADMIN_UIDS.has(uid)) return;
      adminSaveProfile(intent.targetUid, intent.stats);
      break;

    case 'admin_tp_to_player':
      if (!ADMIN_UIDS.has(uid)) return;
      adminTeleportTo(uid, intent.targetKey);
      break;

    case 'admin_tp_player_to_me':
      if (!ADMIN_UIDS.has(uid)) return;
      adminTeleportPlayerToMe(uid, intent.targetKey);
      break;
  }
}

// ── COMBATE autoritativo ─────────────────────────
async function handleAttack(uid, monsterId) {
  if (!monsterId) return;

  // Cooldown de ataque
  const now = Date.now();
  if (attackCDs[uid] && now - attackCDs[uid] < ATTACK_COOLDOWN) return;
  attackCDs[uid] = now;

  // Busca dados atuais
  const [mSnap, pSnap] = await Promise.all([
    db.ref(`monsters/${monsterId}`).once('value'),
    db.ref(`profiles/${uid}`).once('value'),
  ]);

  const m = mSnap.val();
  const p = pSnap.val();
  if (!m || !p) return;

  // Busca sessão do jogador para posição
  const sessionSnap = await db.ref('players').orderByChild('uid').equalTo(uid).once('value');
  let session = null;
  sessionSnap.forEach(s => { session = s.val(); });

  // Se não achou sessão, usa posição do perfil (fallback)
  const px = session ? session.x : (p.x || WORLD/2);
  const py = session ? session.y : (p.y || WORLD/2);

  // Valida distância
  const dist = Math.hypot(m.x - px, m.y - py);
  if (dist > ATTACK_RANGE) return;

  const damage = p.damage || 12;
  const newHp  = (m.hp || 0) - damage;

  // Notifica o cliente que atacou (para mostrar número flutuante)
  db.ref(`feedback/${uid}`).set({
    type: 'dmg_dealt', amount: damage,
    wx: m.x, wy: m.y, ts: now,
  });

  if (newHp <= 0) {
    await db.ref(`monsters/${monsterId}`).remove();
    await rewardPlayer(uid, p, m);
  } else {
    await db.ref(`monsters/${monsterId}/hp`).set(newHp);
  }
}

async function rewardPlayer(uid, profile, monster) {
  const xpGain  = monster.elite ? 30 : 15;
  const goldGain = monster.elite ? 5  : 2;

  let xp      = (profile.xp    || 0) + xpGain;
  let level   = profile.level  || 1;
  let maxHp   = profile.maxHp  || 120;
  let damage  = profile.damage || 12;
  let xpNext  = profile.xpNext || 100;
  let gold    = (profile.gold  || 0) + goldGain;
  let levelUp = false;

  if (xp >= xpNext) {
    xp     -= xpNext;
    level++;
    xpNext  = Math.round(xpNext * 1.5);
    maxHp  += 20;
    damage += 3;
    levelUp = true;
  }

  await db.ref(`profiles/${uid}`).update({ xp, level, maxHp, damage, xpNext, gold, hp: maxHp });

  // Drops no mundo
  dropCoin(monster.x, monster.y, goldGain);
  if (Math.random() < 0.35) dropFood(monster.x, monster.y);

  // Notifica cliente
  const feedback = { type: 'reward', xp: xpGain, gold: goldGain, ts: Date.now() };
  if (levelUp) { feedback.levelUp = true; feedback.level = level; }
  db.ref(`feedback/${uid}`).set(feedback);
}

// ── COLETA autoritativa ──────────────────────────
async function handleCollectCoin(uid, coinId) {
  if (!coinId) return;
  const [cSnap, pSnap] = await Promise.all([
    db.ref(`coins/${coinId}`).once('value'),
    db.ref(`profiles/${uid}`).once('value'),
  ]);
  const coin    = cSnap.val();
  const profile = pSnap.val();
  if (!coin || !profile) return;

  // Valida distância via sessão
  const sessionSnap = await db.ref('players').orderByChild('uid').equalTo(uid).once('value');
  let px = WORLD/2, py = WORLD/2;
  sessionSnap.forEach(s => { px = s.val().x; py = s.val().y; });

  if (Math.hypot(coin.x - px, coin.y - py) > PR + 20) return;

  await Promise.all([
    db.ref(`coins/${coinId}`).remove(),
    db.ref(`profiles/${uid}/gold`).set((profile.gold || 0) + (coin.value || 1)),
  ]);
  db.ref(`feedback/${uid}`).set({ type: 'coin', amount: coin.value, ts: Date.now() });
}

async function handleCollectFood(uid, foodId) {
  if (!foodId) return;
  const [fSnap, pSnap] = await Promise.all([
    db.ref(`foods/${foodId}`).once('value'),
    db.ref(`profiles/${uid}`).once('value'),
  ]);
  const food    = fSnap.val();
  const profile = pSnap.val();
  if (!food || !profile) return;

  const inv = profile.inventory ? Object.values(profile.inventory) : [];
  if (inv.length >= 16) return;

  // Empilha se já tem
  const idx = inv.findIndex(i => i.name === food.name && i.type === 'food');
  if (idx >= 0) inv[idx].qty = (inv[idx].qty || 1) + 1;
  else inv.push({ type:'food', name:food.name, icon:food.icon, heal:food.heal, qty:1 });

  await Promise.all([
    db.ref(`foods/${foodId}`).remove(),
    db.ref(`profiles/${uid}/inventory`).set(inv),
  ]);
  db.ref(`feedback/${uid}`).set({ type: 'food_collected', name: food.name, icon: food.icon, ts: Date.now() });
}

async function handleUseItem(uid, itemIndex) {
  const pSnap = await db.ref(`profiles/${uid}`).once('value');
  const p = pSnap.val();
  if (!p) return;

  const inv  = p.inventory ? Object.values(p.inventory) : [];
  const item = inv[itemIndex];
  if (!item || item.type !== 'food') return;

  const healed = Math.min(item.heal, (p.maxHp || 120) - (p.hp || p.maxHp));
  const newHp  = Math.min(p.maxHp || 120, (p.hp || p.maxHp) + item.heal);

  item.qty = (item.qty || 1) - 1;
  if (item.qty <= 0) inv.splice(itemIndex, 1);

  await db.ref(`profiles/${uid}`).update({ hp: newHp, inventory: inv });
  db.ref(`feedback/${uid}`).set({ type: 'healed', amount: healed, icon: item.icon, ts: Date.now() });
}

// ── DANO DE CONTATO autoritativo (servidor checa) ─
setInterval(async () => {
  const allPlayers = Object.entries(players).filter(([,p]) => p && p.alive);
  const now = Date.now();

  for (const [sessionKey, p] of allPlayers) {
    const uid = p.uid;
    if (!uid) continue;

    for (const [, m] of Object.entries(monsters)) {
      if (!m) continue;
      const dist = Math.hypot(m.x - p.x, m.y - p.y);
      if (dist < PR + MR - 4) {
        const cdKey = `${uid}_${sessionKey}`;
        if (contactCDs[cdKey] && now - contactCDs[cdKey] < CONTACT_DAMAGE_CD) continue;
        contactCDs[cdKey] = now;

        const pSnap = await db.ref(`profiles/${uid}`).once('value');
        const profile = pSnap.val();
        if (!profile) continue;

        const newHp = Math.max(0, (profile.hp || profile.maxHp) - (m.damage || 5));
        await db.ref(`profiles/${uid}/hp`).set(newHp);
        db.ref(`feedback/${uid}`).set({ type: 'dmg_taken', amount: m.damage || 5, ts: now });
      }
    }
  }
}, 200);

// ── DROPS ────────────────────────────────────────
function dropCoin(x, y, value) {
  const r = db.ref('coins').push();
  r.set({ x: x + rnd(-20,20), y: y + rnd(-20,20), value });
}

const FOOD_TYPES = [
  { name:'Pão',    icon:'🍞', heal:15 },
  { name:'Maçã',   icon:'🍎', heal:20 },
  { name:'Frango', icon:'🍗', heal:35 },
  { name:'Poção',  icon:'🧪', heal:50 },
];

function dropFood(x, y) {
  const f = FOOD_TYPES[Math.floor(Math.random()*FOOD_TYPES.length)];
  const r = db.ref('foods').push();
  r.set({ x: x + rnd(-24,24), y: y + rnd(-24,24), ...f });
}

// ── ADMIN ─────────────────────────────────────────
function adminSpawnMob(type, qty, x, y) {
  const n = Math.min(qty || 1, 20);
  for (let i = 0; i < n; i++) {
    const boss  = type === 'boss';
    const elite = type === 'elite' || boss;
    const ref   = db.ref('monsters').push();
    const angle = Math.random() * Math.PI * 2;
    ref.set({
      x: clamp((x||WORLD/2) + Math.cos(angle)*rnd(10,60), MR, WORLD-MR),
      y: clamp((y||WORLD/2) + Math.sin(angle)*rnd(10,60), MR, WORLD-MR),
      hp:    boss?300: elite?60:30,
      maxHp: boss?300: elite?60:30,
      damage:boss?25:  elite?10:5,
      speed: boss?0.7: elite?1.5:1.1,
      elite, boss: boss||false,
    });
  }
}

function adminSpawnItem(type, qty, x, y) {
  const n = Math.min(qty || 1, 50);
  const ITEMS = {
    pao:    { name:'Pão',    icon:'🍞', heal:15 },
    maca:   { name:'Maçã',   icon:'🍎', heal:20 },
    frango: { name:'Frango', icon:'🍗', heal:35 },
    pocao:  { name:'Poção',  icon:'🧪', heal:50 },
  };
  for (let i = 0; i < n; i++) {
    const ox = rnd(-60,60), oy = rnd(-60,60);
    const ix = clamp((x||WORLD/2)+ox, 20, WORLD-20);
    const iy = clamp((y||WORLD/2)+oy, 20, WORLD-20);
    if (type.startsWith('moeda')) {
      const val = type==='moeda1'?1: type==='moeda5'?5:20;
      db.ref('coins').push().set({ x:ix, y:iy, value:val });
    } else if (ITEMS[type]) {
      db.ref('foods').push().set({ x:ix, y:iy, ...ITEMS[type] });
    }
  }
}

async function adminSaveProfile(uid, stats) {
  if (!uid || !stats) return;
  const allowed = ['level','maxHp','damage','gold','speed','xp','xpNext'];
  const update  = {};
  for (const k of allowed) {
    if (stats[k] !== undefined) update[k] = stats[k];
  }
  update.hp = update.maxHp || undefined;
  await db.ref(`profiles/${uid}`).update(update);
}

async function adminTeleportTo(adminUid, targetKey) {
  const snap = await db.ref(`players/${targetKey}`).once('value');
  const p = snap.val();
  if (!p) return;
  db.ref(`feedback/${adminUid}`).set({ type: 'teleport', x: p.x, y: p.y, ts: Date.now() });
}

async function adminTeleportPlayerToMe(adminUid, targetKey) {
  // Acha posição do admin
  const aSnap = await db.ref('players').orderByChild('uid').equalTo(adminUid).once('value');
  let ax = WORLD/2, ay = WORLD/2;
  aSnap.forEach(s => { ax = s.val().x; ay = s.val().y; });
  db.ref(`players/${targetKey}/teleport`).set({ x: Math.round(ax), y: Math.round(ay), ts: Date.now() });
}

// ── SPAWN de monstros ─────────────────────────────
async function init() {
  console.log('🗡️  Servidor RPG iniciado!');
  await db.ref('monsters').remove();
  await db.ref('intents').remove();
  spawnWave(8);
  console.log('🐲 Onda inicial spawnada!');
}

function spawnWave(n) { for (let i=0;i<n;i++) spawnMonster(); }

function spawnMonster() {
  const angle = Math.random() * Math.PI * 2;
  const dist  = 300 + Math.random() * 800;
  const x = clamp(WORLD/2 + Math.cos(angle)*dist, 50, WORLD-50);
  const y = clamp(WORLD/2 + Math.sin(angle)*dist, 50, WORLD-50);
  const elite = Math.random() < 0.2;
  const ref   = db.ref('monsters').push();
  const id    = ref.key;
  monsterDirs[id] = { x: Math.cos(Math.random()*Math.PI*2), y: Math.sin(Math.random()*Math.PI*2) };
  ref.set({ x, y, hp: elite?60:30, maxHp: elite?60:30, damage: elite?10:5, speed: elite?1.5:1.1, elite });
}

setInterval(() => {
  if (Object.keys(monsters).length < MAX_MONSTERS) spawnWave(3);
}, SPAWN_INTERVAL);

// ── MOVIMENTO de monstros ─────────────────────────
setInterval(() => {
  const allPlayers = Object.values(players).filter(p => p && p.alive);
  const updates    = {};

  for (const [id, m] of Object.entries(monsters)) {
    if (!m) continue;
    let dx, dy;
    let closest = null, closestDist = Infinity;
    for (const p of allPlayers) {
      const d = Math.hypot(p.x-m.x, p.y-m.y);
      if (d < closestDist) { closestDist = d; closest = p; }
    }
    if (closest && closestDist < CHASE_DIST) {
      dx = closest.x - m.x; dy = closest.y - m.y; monsterDirs[id] = null;
    } else {
      if (!monsterDirs[id] || Math.random() < 0.015) {
        const a = Math.random()*Math.PI*2;
        monsterDirs[id] = { x: Math.cos(a), y: Math.sin(a) };
      }
      dx = monsterDirs[id].x; dy = monsterDirs[id].y;
    }
    const len  = Math.hypot(dx,dy)||1;
    const newX = clamp(m.x+(dx/len)*m.speed, MR, WORLD-MR);
    const newY = clamp(m.y+(dy/len)*m.speed, MR, WORLD-MR);
    if (newX<=MR||newX>=WORLD-MR||newY<=MR||newY>=WORLD-MR) monsterDirs[id]=null;
    updates[`monsters/${id}/x`] = newX;
    updates[`monsters/${id}/y`] = newY;
  }
  if (Object.keys(updates).length) db.ref().update(updates).catch(()=>{});
}, MOVE_INTERVAL);

// ── Limpeza periódica de CDs antigos ─────────────
setInterval(() => {
  const now = Date.now();
  for (const k of Object.keys(attackCDs))  if (now - attackCDs[k]  > 5000) delete attackCDs[k];
  for (const k of Object.keys(contactCDs)) if (now - contactCDs[k] > 5000) delete contactCDs[k];
}, 30000);

// ── Utils ─────────────────────────────────────────
function clamp(v,a,b){ return Math.max(a,Math.min(b,v)); }
function rnd(a,b){ return a+Math.random()*(b-a); }

// ── HTTP keep-alive ───────────────────────────────
http.createServer((req, res) => {
  res.writeHead(200);
  res.end('RPG Server online 🗡️');
}).listen(process.env.PORT || 3000, () => {
  console.log(`🌐 Porta ${process.env.PORT || 3000}`);
  init();
});
