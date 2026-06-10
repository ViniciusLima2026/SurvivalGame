// ================================================
//  RPG SURVIVAL — Servidor de Monstros
//  Roda no Render.com 24h por dia
// ================================================

const admin = require('firebase-admin');

// Credenciais via variável de ambiente (configurada no Render)
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: process.env.FIREBASE_DATABASE_URL,
});

const db = admin.database();

// ── Constantes ──────────────────────────────────
const WORLD      = 2400;
const MR         = 18;
const MAX_MONSTERS  = 30;
const SPAWN_INTERVAL = 6000;   // ms entre ondas de spawn
const MOVE_INTERVAL  = 120;    // ms entre updates de posição
const CHASE_DIST     = 280;    // px para começar perseguir jogador

// ── Estado local do servidor ────────────────────
let players  = {};
let monsters = {};
const monsterDirs = {};

// ── Escuta Firebase ──────────────────────────────
db.ref('players').on('value', snap => {
  players = snap.val() || {};
});

db.ref('monsters').on('value', snap => {
  monsters = snap.val() || {};
});

// ── Spawn inicial ────────────────────────────────
async function init() {
  console.log('🗡️  Servidor RPG iniciado!');

  // Limpa monstros antigos e spawna onda inicial
  await db.ref('monsters').remove();
  spawnWave(8);
  console.log('🐲 Onda inicial spawnada!');
}

// ── Loop de spawn ─────────────────────────────────
setInterval(() => {
  const count = Object.keys(monsters).length;
  if (count < MAX_MONSTERS) {
    spawnWave(4);
  }
}, SPAWN_INTERVAL);

// ── Loop de movimento ─────────────────────────────
setInterval(() => {
  moveMonsters();
}, MOVE_INTERVAL);

// ── Spawn ─────────────────────────────────────────
function spawnWave(n) {
  for (let i = 0; i < n; i++) spawnMonster();
}

function spawnMonster() {
  const angle = Math.random() * Math.PI * 2;
  const dist  = 300 + Math.random() * 800;
  const x = clamp(WORLD/2 + Math.cos(angle) * dist, 50, WORLD-50);
  const y = clamp(WORLD/2 + Math.sin(angle) * dist, 50, WORLD-50);
  const elite = Math.random() < 0.2;

  const ref = db.ref('monsters').push();
  const id  = ref.key;

  // Direção aleatória inicial
  const startAngle = Math.random() * Math.PI * 2;
  monsterDirs[id] = { x: Math.cos(startAngle), y: Math.sin(startAngle) };

  ref.set({
    x, y,
    hp:    elite ? 60 : 30,
    maxHp: elite ? 60 : 30,
    damage: elite ? 10 : 5,
    speed:  elite ? 1.5 : 1.1,
    elite:  elite,
  });
}

// ── Movimento dos monstros ────────────────────────
function moveMonsters() {
  const allPlayers = Object.values(players).filter(p => p && p.alive);
  const updates    = {};

  for (const [id, m] of Object.entries(monsters)) {
    if (!m) continue;

    let dx, dy;

    // Acha jogador mais próximo
    let closest = null, closestDist = Infinity;
    for (const p of allPlayers) {
      const d = Math.hypot(p.x - m.x, p.y - m.y);
      if (d < closestDist) { closestDist = d; closest = p; }
    }

    if (closest && closestDist < CHASE_DIST) {
      // Persegue o jogador
      dx = closest.x - m.x;
      dy = closest.y - m.y;
      monsterDirs[id] = null;
    } else {
      // Movimento aleatório — troca direção às vezes
      if (!monsterDirs[id] || Math.random() < 0.015) {
        const angle = Math.random() * Math.PI * 2;
        monsterDirs[id] = { x: Math.cos(angle), y: Math.sin(angle) };
      }
      dx = monsterDirs[id].x;
      dy = monsterDirs[id].y;
    }

    const len  = Math.hypot(dx, dy) || 1;
    const spd  = m.speed || 1;
    const newX = clamp(m.x + (dx/len) * spd, MR, WORLD-MR);
    const newY = clamp(m.y + (dy/len) * spd, MR, WORLD-MR);

    // Bate na borda → nova direção
    if (newX <= MR || newX >= WORLD-MR || newY <= MR || newY >= WORLD-MR) {
      monsterDirs[id] = null;
    }

    updates[`monsters/${id}/x`] = newX;
    updates[`monsters/${id}/y`] = newY;
  }

  if (Object.keys(updates).length > 0) {
    db.ref().update(updates).catch(err => console.error('Erro update:', err));
  }
}

// ── Utils ─────────────────────────────────────────
function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }

// ── Mantém o processo vivo no Render ─────────────
// O Render precisa de um servidor HTTP para não matar o processo
const http = require('http');
http.createServer((req, res) => {
  res.writeHead(200);
  res.end('RPG Server online 🗡️');
}).listen(process.env.PORT || 3000, () => {
  console.log(`🌐 HTTP keep-alive rodando na porta ${process.env.PORT || 3000}`);
  init();
});
