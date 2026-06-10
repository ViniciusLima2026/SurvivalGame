// RPG SURVIVAL ONLINE — game.js com sistema de contas

const WORLD = 2400;
const TILE  = 40;
const PR    = 16;
const MR    = 18;
const CS    = 12;

let canvas, ctx;
let cam = { x: WORLD/2, y: WORLD/2 };
let keys = {};
let animId;
let lastTime = 0;
let invOpen = false;

let me = null;
let myRef = null;
let myUID = null;

let fbPlayers  = {};
let fbMonsters = {};
let fbCoins    = {};
let fbFoods    = {};
let dmgNums    = [];

let amHost = false;
let hostInterval = null;
let mapTiles = [];

// ─── ABAS LOGIN/CADASTRO ─────────────────────────
function switchTab(tab) {
  document.getElementById('formLogin').style.display    = tab === 'login'    ? 'block' : 'none';
  document.getElementById('formRegister').style.display = tab === 'register' ? 'block' : 'none';
  document.getElementById('tabLogin').classList.toggle('active',    tab === 'login');
  document.getElementById('tabRegister').classList.toggle('active', tab === 'register');
  document.getElementById('loginError').textContent = '';
}

function setLoading(on) {
  document.getElementById('loginLoading').style.display = on ? 'block' : 'none';
  document.querySelectorAll('.btn-primary').forEach(b => b.disabled = on);
}

function showError(msg) {
  document.getElementById('loginError').textContent = msg;
  setLoading(false);
}

// Converte nome de usuário em email fake para o Firebase Auth
function toEmail(username) {
  return username.toLowerCase().replace(/[^a-z0-9]/g, '') + '@rpg.game';
}

// ─── CADASTRO ────────────────────────────────────
async function doRegister() {
  const user  = document.getElementById('regUser').value.trim();
  const pass  = document.getElementById('regPass').value;
  const pass2 = document.getElementById('regPass2').value;

  if (user.length < 2)    return showError('Nome deve ter pelo menos 2 caracteres.');
  if (pass.length < 4)    return showError('Senha deve ter pelo menos 4 caracteres.');
  if (pass !== pass2)     return showError('As senhas não coincidem.');

  setLoading(true);

  // Verifica se o nome já existe no banco
  const nameSnap = await db.ref('usernames/' + user.toLowerCase()).once('value');
  if (nameSnap.exists()) return showError('Este nome já está em uso. Escolha outro.');

  try {
    const cred = await auth.createUserWithEmailAndPassword(toEmail(user), pass);
    const uid  = cred.user.uid;

    // Salva o mapeamento nome → uid
    await db.ref('usernames/' + user.toLowerCase()).set(uid);

    // Cria perfil inicial do jogador
    await db.ref('profiles/' + uid).set({
      name:   user,
      hp:     120, maxHp: 120,
      damage: 12,  speed: 3,
      gold:   0,   level: 1,
      xp:     0,   xpNext: 100,
      inventory: [],
    });

    // Já entra no jogo
    enterGame(cred.user);
  } catch(e) {
    showError(translateError(e.code));
  }
}

// ─── LOGIN ───────────────────────────────────────
async function doLogin() {
  const user = document.getElementById('loginUser').value.trim();
  const pass = document.getElementById('loginPass').value;

  if (!user || !pass) return showError('Preencha todos os campos.');
  setLoading(true);

  try {
    const cred = await auth.signInWithEmailAndPassword(toEmail(user), pass);
    enterGame(cred.user);
  } catch(e) {
    showError(translateError(e.code));
  }
}

function translateError(code) {
  const erros = {
    'auth/user-not-found':      'Usuário não encontrado.',
    'auth/wrong-password':      'Senha incorreta.',
    'auth/email-already-in-use':'Este nome já está cadastrado.',
    'auth/weak-password':       'Senha muito fraca (mínimo 4 caracteres).',
    'auth/too-many-requests':   'Muitas tentativas. Aguarde um momento.',
  };
  return erros[code] || 'Erro: ' + code;
}

// ─── ENTRA NO JOGO ───────────────────────────────
async function enterGame(user) {
  myUID = user.uid;

  // Carrega perfil salvo
  const snap = await db.ref('profiles/' + myUID).once('value');
  const profile = snap.val();

  if (!profile) return showError('Perfil não encontrado. Tente criar conta novamente.');

  document.getElementById('loginScreen').style.display = 'none';
  document.getElementById('gameScreen').style.display  = 'block';
  setLoading(false);

  startGame(profile);
}

// ─── INICIO DO JOGO ──────────────────────────────
function startGame(profile) {
  canvas        = document.getElementById('gameCanvas');
  canvas.width  = window.innerWidth;
  canvas.height = window.innerHeight;
  ctx           = canvas.getContext('2d');

  buildMap();

  me = {
    name:      profile.name,
    x:         WORLD / 2,
    y:         WORLD / 2,
    hp:        profile.hp      || 120,
    maxHp:     profile.maxHp   || 120,
    damage:    profile.damage  || 12,
    speed:     profile.speed   || 3,
    gold:      profile.gold    || 0,
    level:     profile.level   || 1,
    xp:        profile.xp      || 0,
    xpNext:    profile.xpNext  || 100,
    inventory: profile.inventory ? Object.values(profile.inventory) : [],
    alive:     true,
  };

  cam.x = me.x;
  cam.y = me.y;

  // Referência de sessão online (temporária, some ao desconectar)
  myRef = db.ref('players').push();
  myRef.onDisconnect().remove();
  pushSession();

  // Escuta jogadores online
  db.ref('players').on('value', snap => {
    fbPlayers = snap.val() || {};
    document.getElementById('onlineCount').textContent = Object.keys(fbPlayers).length;
    checkHost();
  });

  db.ref('monsters').on('value', snap => { fbMonsters = snap.val() || {}; });
  db.ref('coins').on('value',    snap => { fbCoins    = snap.val() || {}; });
  db.ref('foods').on('value',    snap => { fbFoods    = snap.val() || {}; });

  setupInput();
  updateHUD();
  requestAnimationFrame(loop);
}

// Salva posição/hp na sessão online (temporária)
function pushSession() {
  if (!myRef || !me) return;
  myRef.set({
    name:  me.name,
    x:     Math.round(me.x),
    y:     Math.round(me.y),
    hp:    me.hp,
    maxHp: me.maxHp,
    alive: me.alive,
  });
}

// Salva progresso permanente no perfil
function saveProfile() {
  if (!myUID || !me) return;
  db.ref('profiles/' + myUID).update({
    hp:        me.hp,
    maxHp:     me.maxHp,
    damage:    me.damage,
    speed:     me.speed,
    gold:      me.gold,
    level:     me.level,
    xp:        me.xp,
    xpNext:    me.xpNext,
    inventory: me.inventory.length ? me.inventory : [],
  });
}

// ─── LOGOUT ──────────────────────────────────────
function logout() {
  saveProfile();
  if (myRef) myRef.remove();
  cancelAnimationFrame(animId);
  auth.signOut().then(() => location.reload());
}

// ─── HOST ────────────────────────────────────────
function checkHost() {
  const ids    = Object.keys(fbPlayers).sort();
  const myKey  = myRef ? myRef.key : null;
  const should = ids.length > 0 && ids[0] === myKey;

  if (should && !amHost) {
    amHost = true;
    console.log('Sou host');
    // Só limpa e respawna se não há monstros
    db.ref('monsters').once('value', snap => {
      if (!snap.exists() || snap.numChildren() === 0) {
        spawnWave(6);
      }
    });
    // Limpa intervalo antigo antes de criar novo
    if (hostInterval) clearInterval(hostInterval);
    hostInterval = setInterval(() => {
      if (!amHost) { clearInterval(hostInterval); return; }
      if (Object.keys(fbMonsters).length < 25) spawnWave(3);
    }, 6000);
  }
  if (!should && amHost) {
    amHost = false;
    if (hostInterval) { clearInterval(hostInterval); hostInterval = null; }
  }
}

// ─── MAPA ────────────────────────────────────────
function buildMap() {
  const cols = Math.ceil(WORLD / TILE);
  const rows = Math.ceil(WORLD / TILE);
  for (let r = 0; r < rows; r++) {
    mapTiles[r] = [];
    for (let c = 0; c < cols; c++) {
      mapTiles[r][c] = (r + c) % 2;
    }
  }
}

// ─── INPUT ───────────────────────────────────────
function setupInput() {
  document.addEventListener('keydown', e => {
    const k = e.key.toLowerCase();
    keys[k] = true;
    if (k === 'i') toggleInv();
    if (['w','a','s','d',' '].includes(k)) e.preventDefault();
  });
  document.addEventListener('keyup', e => { keys[e.key.toLowerCase()] = false; });
  canvas.addEventListener('click', handleClick);
  window.addEventListener('resize', () => {
    canvas.width  = window.innerWidth;
    canvas.height = window.innerHeight;
  });

  // Enter nos inputs de login
  document.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      if (document.getElementById('formLogin').style.display !== 'none') doLogin();
      else doRegister();
    }
  });
}

function handleClick(e) {
  if (!me || !me.alive) return;
  const wx = e.clientX - canvas.width/2  + cam.x;
  const wy = e.clientY - canvas.height/2 + cam.y;
  for (const [id, m] of Object.entries(fbMonsters)) {
    if (!m) continue;
    if (Math.hypot(m.x - wx, m.y - wy) < MR + 14) { attackMonster(id, m); return; }
  }
}

// ─── LOOP ────────────────────────────────────────
let saveAccum    = 0;
let profileAccum = 0;

function loop(ts) {
  const dt = Math.min((ts - lastTime) / 1000, 0.05);
  lastTime = ts;
  update(dt);
  draw();
  animId = requestAnimationFrame(loop);
}

// ─── UPDATE ──────────────────────────────────────
function update(dt) {
  if (!me || !me.alive) return;

  let dx = 0, dy = 0;
  if (keys['w'] || keys['arrowup'])    dy = -1;
  if (keys['s'] || keys['arrowdown'])  dy =  1;
  if (keys['a'] || keys['arrowleft'])  dx = -1;
  if (keys['d'] || keys['arrowright']) dx =  1;

  if (dx || dy) {
    const len = Math.hypot(dx, dy) || 1;
    me.x = Math.max(PR, Math.min(WORLD-PR, me.x + (dx/len)*me.speed));
    me.y = Math.max(PR, Math.min(WORLD-PR, me.y + (dy/len)*me.speed));
  }

  cam.x += (me.x - cam.x) * 0.12;
  cam.y += (me.y - cam.y) * 0.12;

  // Coleta moedas
  for (const [id, c] of Object.entries(fbCoins)) {
    if (!c) continue;
    if (Math.hypot(c.x - me.x, c.y - me.y) < PR + CS + 4) {
      me.gold += c.value || 1;
      db.ref(`coins/${id}`).remove();
      showMsg(`+${c.value} 💰`, 'gold');
      updateHUD();
    }
  }

  // Coleta comidas
  for (const [id, f] of Object.entries(fbFoods)) {
    if (!f) continue;
    if (Math.hypot(f.x - me.x, f.y - me.y) < PR + 18) {
      if (me.inventory.length < 16) {
        addInv({ type:'food', name:f.name, icon:f.icon, heal:f.heal });
        db.ref(`foods/${id}`).remove();
        showMsg(`${f.icon} ${f.name}!`);
        if (invOpen) renderInv();
      }
    }
  }

  // Dano de contato
  for (const [, m] of Object.entries(fbMonsters)) {
    if (!m) continue;
    if (Math.hypot(m.x - me.x, m.y - me.y) < PR + MR - 4) {
      if (!m._cd) {
        m._cd = true;
        takeDmg(m.damage || 5);
        setTimeout(() => { if (m) m._cd = false; }, 900);
      }
    }
  }

  if (amHost) moveMonsters();

  dmgNums = dmgNums.filter(d => d.life > 0);
  dmgNums.forEach(d => { d.sy -= 0.8; d.life -= 16; });

  // Salva sessão a cada 250ms
  saveAccum += dt * 1000;
  if (saveAccum > 250) { saveAccum = 0; pushSession(); updateHUD(); }

  // Salva perfil permanente a cada 10s
  profileAccum += dt * 1000;
  if (profileAccum > 10000) { profileAccum = 0; saveProfile(); }
}

// ─── MONSTROS ────────────────────────────────────
function spawnWave(n) { for (let i=0;i<n;i++) spawnMonster(); }

function spawnMonster() {
  const angle = Math.random() * Math.PI * 2;
  const dist  = 300 + Math.random() * 700;
  const x = Math.max(50, Math.min(WORLD-50, WORLD/2 + Math.cos(angle)*dist));
  const y = Math.max(50, Math.min(WORLD-50, WORLD/2 + Math.sin(angle)*dist));
  const elite = Math.random() < 0.2;
  const ref = db.ref('monsters').push();
  ref.set({ x, y, hp: elite?60:30, maxHp: elite?60:30, damage: elite?10:5, speed: elite?1.3:0.9, elite });
}

// Direções aleatórias por monstro (persistem entre frames)
const monsterDirs = {};

let moveAccum = 0;
function moveMonsters() {
  moveAccum += 16;
  if (moveAccum < 100) return;
  moveAccum = 0;

  const allP = Object.values(fbPlayers).filter(p => p && p.alive);
  const updates = {};
  const CHASE_DIST = 280; // distância para começar a perseguir

  for (const [id, m] of Object.entries(fbMonsters)) {
    if (!m) continue;

    // Acha jogador mais próximo
    let cx = null, cy = null, cd = Infinity;
    for (const p of allP) {
      const d = Math.hypot(p.x - m.x, p.y - m.y);
      if (d < cd) { cd = d; cx = p.x; cy = p.y; }
    }

    let dx, dy;

    if (cx !== null && cd < CHASE_DIST) {
      // Persegue o jogador
      dx = cx - m.x;
      dy = cy - m.y;
      monsterDirs[id] = null; // reseta direção aleatória
    } else {
      // Movimento aleatório — troca de direção a cada ~3s
      if (!monsterDirs[id] || Math.random() < 0.012) {
        const angle = Math.random() * Math.PI * 2;
        monsterDirs[id] = { x: Math.cos(angle), y: Math.sin(angle) };
      }
      dx = monsterDirs[id].x;
      dy = monsterDirs[id].y;
    }

    const len  = Math.hypot(dx, dy) || 1;
    const spd  = (m.speed || 1) * 1.4; // 40% mais rápido
    const newX = Math.max(MR, Math.min(WORLD - MR, m.x + (dx / len) * spd));
    const newY = Math.max(MR, Math.min(WORLD - MR, m.y + (dy / len) * spd));

    // Se bateu na borda, inverte direção
    if (newX <= MR || newX >= WORLD - MR || newY <= MR || newY >= WORLD - MR) {
      monsterDirs[id] = null;
    }

    updates[`monsters/${id}/x`] = newX;
    updates[`monsters/${id}/y`] = newY;
  }

  if (Object.keys(updates).length) db.ref().update(updates);
}

// ─── COMBATE ─────────────────────────────────────
function attackMonster(id, m) {
  if (Math.hypot(m.x-me.x, m.y-me.y) > 160) { showMsg('Muito longe!'); return; }
  const newHp = (m.hp||0) - me.damage;
  floatDmg(m.x, m.y, `-${me.damage}`, '#ff6b6b');
  if (newHp <= 0) { db.ref(`monsters/${id}`).remove(); monsterDied(m); }
  else db.ref(`monsters/${id}/hp`).set(newHp);
}

function monsterDied(m) {
  const xp = m.elite ? 30 : 15;
  me.xp += xp;
  showMsg(`+${xp} XP ⭐`);
  dropCoin(m.x, m.y, m.elite ? 5 : 2);
  if (Math.random() < 0.35) dropFood(m.x, m.y);
  if (me.xp >= me.xpNext) {
    me.xp -= me.xpNext;
    me.level++;
    me.xpNext = Math.round(me.xpNext * 1.5);
    me.maxHp  += 20; me.hp = me.maxHp;
    me.damage += 3;
    showMsg(`🎉 NÍVEL ${me.level}!`, 'lvl');
  }
  updateHUD();
  saveProfile(); // salva imediatamente ao subir de nível ou pegar recompensa
}

function takeDmg(n) {
  me.hp = Math.max(0, me.hp - n);
  floatDmg(me.x, me.y-20, `-${n}`, '#ff4444');
  updateHUD();
  if (me.hp <= 0) {
    me.alive = false;
    me.hp = Math.round(me.maxHp * 0.3); // respawn com 30% hp
    showMsg('💀 Você morreu! Voltando...', 'dmg');
    saveProfile();
    setTimeout(() => location.reload(), 2500);
  }
}

// ─── DROPS ───────────────────────────────────────
function dropCoin(x, y, v) {
  const r = db.ref('coins').push();
  r.set({ x: x+rnd(-18,18), y: y+rnd(-18,18), value: v });
}

const FOODS = [
  { name:'Pão',    icon:'🍞', heal:15 },
  { name:'Maçã',   icon:'🍎', heal:20 },
  { name:'Frango', icon:'🍗', heal:35 },
  { name:'Poção',  icon:'🧪', heal:50 },
];

function dropFood(x, y) {
  const f = FOODS[Math.floor(Math.random()*FOODS.length)];
  const r = db.ref('foods').push();
  r.set({ x: x+rnd(-22,22), y: y+rnd(-22,22), ...f });
}

// ─── INVENTÁRIO ──────────────────────────────────
function toggleInventory() { toggleInv(); }
function toggleInv() {
  invOpen = !invOpen;
  document.getElementById('inventory').style.display = invOpen ? 'block' : 'none';
  if (invOpen) renderInv();
}

function addInv(item) {
  const ex = me.inventory.find(i => i.name === item.name && i.type === 'food');
  if (ex) ex.qty = (ex.qty||1)+1;
  else me.inventory.push({...item, qty:1});
}

function renderInv() {
  const g = document.getElementById('invGrid');
  g.innerHTML = '';
  if (!me.inventory.length) { g.innerHTML = '<div class="inv-empty">Vazio</div>'; return; }
  me.inventory.forEach((item, i) => {
    const s = document.createElement('div');
    s.className = 'inv-slot';
    s.innerHTML = `<span class="item-icon">${item.icon}</span><span style="font-size:.6rem;color:#888">${item.name}</span>${item.qty>1?`<span class="item-qty">x${item.qty}</span>`:''}`;
    s.onclick = () => useItem(i);
    g.appendChild(s);
  });
}

function useItem(i) {
  const item = me.inventory[i];
  if (!item) return;
  if (item.type === 'food') {
    const h = Math.min(item.heal, me.maxHp - me.hp);
    me.hp = Math.min(me.maxHp, me.hp + item.heal);
    showMsg(`${item.icon} +${h} HP`, 'heal');
    floatDmg(me.x, me.y-20, `+${h}`, '#6bff9a');
    item.qty = (item.qty||1)-1;
    if (item.qty <= 0) me.inventory.splice(i, 1);
    updateHUD(); renderInv(); saveProfile();
  }
}

// ─── HUD ─────────────────────────────────────────
function updateHUD() {
  if (!me) return;
  document.getElementById('hudPlayerName').textContent = `${me.name} (warrior)`;
  document.getElementById('hpText').textContent        = `${me.hp}/${me.maxHp}`;
  document.getElementById('hpBar').style.width         = `${(me.hp/me.maxHp)*100}%`;
  document.getElementById('hudDmg').textContent        = me.damage;
  document.getElementById('hudGold').textContent       = me.gold;
  document.getElementById('hudLvl').textContent        = me.level;
  document.getElementById('hudXp').textContent         = `${me.xp}/${me.xpNext}`;
}

// ─── MENSAGENS ───────────────────────────────────
function showMsg(txt, cls='') {
  const el = document.createElement('div');
  el.className   = `msg-pop ${cls}`;
  el.textContent = txt;
  document.getElementById('messageLog').appendChild(el);
  setTimeout(() => el.remove(), 2500);
}

function floatDmg(wx, wy, txt, color) {
  dmgNums.push({ wx, wy, txt, color, life:60, sy:0 });
}

// ─── DESENHO ─────────────────────────────────────
function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const offX = Math.round(canvas.width/2  - cam.x);
  const offY = Math.round(canvas.height/2 - cam.y);
  ctx.save();
  ctx.translate(offX, offY);
  drawMap(); drawCoins(); drawFoods(); drawMonsters(); drawPlayers();
  ctx.restore();
  drawDmgNums(offX, offY);
}

function drawMap() {
  const c0 = Math.max(0, Math.floor((cam.x-canvas.width/2)/TILE));
  const c1 = Math.min(mapTiles[0].length, Math.ceil((cam.x+canvas.width/2)/TILE));
  const r0 = Math.max(0, Math.floor((cam.y-canvas.height/2)/TILE));
  const r1 = Math.min(mapTiles.length, Math.ceil((cam.y+canvas.height/2)/TILE));
  for (let r=r0;r<r1;r++) for (let c=c0;c<c1;c++) {
    ctx.fillStyle = mapTiles[r][c]===0 ? '#1a2a1a' : '#162016';
    ctx.fillRect(c*TILE, r*TILE, TILE, TILE);
  }
  ctx.strokeStyle='rgba(100,160,255,0.4)'; ctx.lineWidth=4;
  ctx.strokeRect(0,0,WORLD,WORLD);
}

function drawCoins() {
  ctx.fillStyle='#ffd700'; ctx.strokeStyle='#b8860b'; ctx.lineWidth=1;
  for (const c of Object.values(fbCoins)) {
    if (!c) continue;
    ctx.fillRect(c.x-CS/2, c.y-CS/2, CS, CS);
    ctx.strokeRect(c.x-CS/2, c.y-CS/2, CS, CS);
  }
}

function drawFoods() {
  for (const f of Object.values(fbFoods)) {
    if (!f) continue;
    ctx.beginPath();
    const R=12;
    for(let i=0;i<6;i++){const a=(Math.PI/3)*i-Math.PI/6; i===0?ctx.moveTo(f.x+R*Math.cos(a),f.y+R*Math.sin(a)):ctx.lineTo(f.x+R*Math.cos(a),f.y+R*Math.sin(a));}
    ctx.closePath();
    ctx.fillStyle='#2d6a4f'; ctx.fill();
    ctx.strokeStyle='#52b788'; ctx.lineWidth=1.5; ctx.stroke();
    ctx.font='11px serif'; ctx.textAlign='center'; ctx.textBaseline='middle';
    ctx.fillStyle='#fff'; ctx.fillText(f.icon, f.x, f.y);
  }
}

function drawMonsters() {
  for (const m of Object.values(fbMonsters)) {
    if (!m) continue;
    ctx.beginPath(); ctx.arc(m.x, m.y, MR, 0, Math.PI*2);
    ctx.fillStyle   = m.elite ? '#6b0000' : '#c0392b'; ctx.fill();
    ctx.strokeStyle = m.elite ? '#ff44aa' : '#ff6b6b';
    ctx.lineWidth   = m.elite ? 2.5 : 1.5; ctx.stroke();
    ctx.fillStyle='#ffcccc';
    ctx.beginPath(); ctx.arc(m.x-5,m.y-4,3,0,Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.arc(m.x+5,m.y-4,3,0,Math.PI*2); ctx.fill();
    const bw=36,bh=5,bx=m.x-18,by=m.y-MR-10;
    ctx.fillStyle='#300'; ctx.fillRect(bx,by,bw,bh);
    ctx.fillStyle=m.elite?'#ff44aa':'#e74c3c';
    ctx.fillRect(bx,by,bw*(m.hp/m.maxHp),bh);
    if (m.elite) { ctx.fillStyle='#ff88dd'; ctx.font='bold 8px Courier New'; ctx.textAlign='center'; ctx.fillText('ELITE',m.x,m.y-MR-14); }
  }
}

function drawPlayers() {
  for (const [key, p] of Object.entries(fbPlayers)) {
    if (!p || !p.alive) continue;
    const isMe = myRef && key === myRef.key;
    const px = isMe ? me.x : p.x;
    const py = isMe ? me.y : p.y;
    ctx.beginPath(); ctx.arc(px, py, PR, 0, Math.PI*2);
    ctx.fillStyle   = isMe ? '#3a6cf4' : '#2471a3'; ctx.fill();
    ctx.strokeStyle = isMe ? '#a0c4ff' : '#7fb3d3';
    ctx.lineWidth   = isMe ? 2.5 : 1.5; ctx.stroke();
    ctx.fillStyle='rgba(200,230,255,0.35)';
    ctx.beginPath(); ctx.arc(px-5,py-5,5,0,Math.PI*2); ctx.fill();
    ctx.fillStyle    = isMe ? '#a0c4ff' : '#aad4f5';
    ctx.font         = isMe ? 'bold 11px Courier New' : '10px Courier New';
    ctx.textAlign    = 'center'; ctx.textBaseline='alphabetic';
    ctx.fillText(p.name, px, py-PR-5);
  }
  // Fallback: garante que o jogador local aparece
  if (me && me.alive && !(myRef && fbPlayers[myRef.key])) {
    ctx.beginPath(); ctx.arc(me.x, me.y, PR, 0, Math.PI*2);
    ctx.fillStyle='#3a6cf4'; ctx.fill();
    ctx.strokeStyle='#a0c4ff'; ctx.lineWidth=2.5; ctx.stroke();
    ctx.fillStyle='#a0c4ff'; ctx.font='bold 11px Courier New';
    ctx.textAlign='center'; ctx.textBaseline='alphabetic';
    ctx.fillText(me.name, me.x, me.y-PR-5);
  }
}

function drawDmgNums(offX, offY) {
  for (const d of dmgNums) {
    ctx.save();
    ctx.globalAlpha = Math.max(0, d.life/60);
    ctx.fillStyle   = d.color;
    ctx.font        = 'bold 14px Courier New';
    ctx.textAlign   = 'center';
    ctx.fillText(d.txt, d.wx+offX, d.wy+offY+d.sy);
    ctx.restore();
  }
}

// ─── UTILS ───────────────────────────────────────
function rnd(a,b){ return a+Math.random()*(b-a); }
