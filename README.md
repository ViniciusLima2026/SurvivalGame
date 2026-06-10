# ⚔️ RPG Survival Online

Jogo RPG top-down multiplayer rodando no Firebase Realtime Database.

---

## 📁 Estrutura dos arquivos

```
rpg-game/
├── index.html          ← Página principal do jogo
├── style.css           ← Visual / interface
├── game.js             ← Toda a lógica do jogo
├── firebase-config.js  ← ⚠️ Você deve editar este arquivo!
├── firebase.json       ← Config de deploy do Firebase
├── database.rules.json ← Regras do banco de dados
└── README.md           ← Este tutorial
```

---

## 🚀 Tutorial: Subindo no Firebase (passo a passo)

### 1. Criar o projeto no Firebase

1. Acesse **https://console.firebase.google.com**
2. Clique em **"Adicionar projeto"**
3. Dê um nome (ex: `rpg-survival`) e clique em Continuar
4. Pode desativar o Google Analytics e finalizar

---

### 2. Ativar o Realtime Database

1. No menu lateral esquerdo, clique em **"Build" → "Realtime Database"**
2. Clique em **"Criar banco de dados"**
3. Escolha a região (recomendado: **us-central1**)
4. Selecione **"Iniciar no modo de teste"** (depois aplicaremos as regras certas)
5. Clique em **Ativar**

---

### 3. Pegar as credenciais do Firebase

1. Clique na engrenagem ⚙️ ao lado de "Visão geral do projeto" → **"Configurações do projeto"**
2. Role até a seção **"Seus apps"**
3. Clique em **"</ > (Web)"** para registrar um app web
4. Dê um apelido (ex: `rpg-web`) e clique em **Registrar app**
5. O Firebase vai mostrar um bloco de código assim:

```js
const firebaseConfig = {
  apiKey: "AIza...",
  authDomain: "rpg-survival.firebaseapp.com",
  databaseURL: "https://rpg-survival-default-rtdb.firebaseio.com",
  projectId: "rpg-survival",
  storageBucket: "rpg-survival.appspot.com",
  messagingSenderId: "1234567890",
  appId: "1:1234567890:web:abcdef"
};
```

6. **Copie esses valores** e cole no arquivo `firebase-config.js` substituindo os campos `"SUA_API_KEY"`, etc.

---

### 4. Aplicar as regras do banco de dados

1. No Firebase Console, vá em **Realtime Database → Regras**
2. Substitua o conteúdo pelo que está no arquivo `database.rules.json`:

```json
{
  "rules": {
    "players": {
      "$playerId": {
        ".read": true,
        ".write": true
      }
    },
    "monsters": { ".read": true, ".write": true },
    "coins":    { ".read": true, ".write": true },
    "foods":    { ".read": true, ".write": true }
  }
}
```

3. Clique em **Publicar**

---

### 5. Ativar o Firebase Hosting

1. No menu lateral, clique em **"Build" → "Hosting"**
2. Clique em **"Começar"**
3. Instale o Firebase CLI (se ainda não tiver):

```bash
npm install -g firebase-tools
```

4. Faça login:

```bash
firebase login
```

5. Dentro da pasta do jogo, inicialize:

```bash
cd rpg-game
firebase init
```

Nas perguntas:
- **Which features?** → selecione `Hosting` e `Realtime Database`
- **Select a project** → escolha o projeto que você criou
- **Public directory** → digite `.` (ponto, porque o index.html está na raiz)
- **Single-page app?** → `Yes`
- **Overwrite index.html?** → `No`

6. Faça o deploy:

```bash
firebase deploy
```

7. O Firebase vai exibir uma URL como:
   ```
   https://rpg-survival.web.app
   ```
   ✅ Pronto! Seu jogo está online e multiplayer!

---

## 🎮 Como jogar

| Tecla / Ação | Função |
|---|---|
| **W A S D** | Mover o personagem |
| **I** | Abrir/fechar inventário |
| **Clique no monstro** | Atacar |
| **Clique na comida (inventário)** | Usar e recuperar HP |
| Andar sobre moedas | Coletar automaticamente |
| Andar sobre comida no chão | Coletar para o inventário |

---

## 🔮 Próximas melhorias planejadas

- [ ] Mais classes (Mago, Arqueiro, Necromante)
- [ ] Sistema de habilidades especiais
- [ ] Loja / NPC mercador
- [ ] Mini-mapa
- [ ] Chat entre jogadores
- [ ] Chefões (Boss Monsters)
- [ ] Sistema de clãs/guildas
- [ ] Dungeon com salas

---

## ⚠️ Observações importantes

- O **primeiro jogador** a entrar no servidor assume o controle de spawn/IA dos monstros automaticamente.
- Se todos saírem, os monstros param até alguém entrar novamente.
- Os dados de moedas, comidas e monstros são compartilhados em tempo real entre todos os jogadores.
