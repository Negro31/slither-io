// ============================================
// SCRIPT.JS - With Admin Panel
// ============================================

const loginScreen = document.getElementById('loginScreen');
const gameScreen = document.getElementById('gameScreen');
const nameInput = document.getElementById('nameInput');
const joinButton = document.getElementById('joinButton');
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const leaderboardList = document.getElementById('leaderboardList');
const joystickContainer = document.getElementById('joystickContainer');
const joystickStick = document.getElementById('joystickStick');
const boostButton = document.getElementById('boostButton');
const adminPanel = document.getElementById('adminPanel');
const adminInput = document.getElementById('adminInput');
const adminLoginBtn = document.getElementById('adminLoginBtn');
const adminControls = document.getElementById('adminControls');

let socket;
let myPlayerId = null;
let gameState = { p: {}, f: [] };
let mapWidth = 3000;
let mapHeight = 3000;
let mapBorder = 100;
let camera = { x: 0, y: 0 };
let isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
let isBoosting = false;
let isAdmin = false;

// FPS
let fps = 0;
let frameCount = 0;
let lastFpsUpdate = Date.now();

function resizeCanvas() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
}
resizeCanvas();
window.addEventListener('resize', resizeCanvas);

joinButton.addEventListener('click', () => {
  const name = nameInput.value.trim() || 'Anonymous';
  socket = io({
    reconnection: true,
    reconnectionDelay: 500,
    reconnectionAttempts: 10,
    transports: ['websocket', 'polling'],
    timeout: 10000
  });
  
  socket.on('connect', () => {
    socket.emit('join', name);
  });
  
  socket.on('init', (data) => {
    myPlayerId = data.playerId;
    mapWidth = data.mapWidth;
    mapHeight = data.mapHeight;
    mapBorder = data.mapBorder;
    loginScreen.style.display = 'none';
    gameScreen.style.display = 'block';
    startGame();
  });
  
  socket.on('gameState', (state) => {
    gameState = state;
    updateLeaderboard();
  });
  
  socket.on('death', (finalScore) => {
    setTimeout(() => {
      alert('You died! Final Score: ' + finalScore);
      location.reload();
    }, 100);
  });
  
  socket.on('adminAccess', (granted) => {
    if (granted) {
      isAdmin = true;
      adminControls.style.display = 'block';
      adminLoginBtn.textContent = 'Admin Active';
      adminLoginBtn.disabled = true;
    } else {
      alert('Wrong password!');
    }
  });
  
  socket.on('botCreated', (data) => {
    console.log('Bot created:', data.name);
  });
  
  socket.on('botRemoved', (id) => {
    console.log('Bot removed:', id);
  });
});

// Admin Panel
adminLoginBtn.addEventListener('click', () => {
  const password = adminInput.value.trim();
  if (password && socket) {
    socket.emit('adminLogin', password);
  }
});

document.getElementById('addBotBtn').addEventListener('click', () => {
  if (isAdmin && socket) {
    socket.emit('addBot');
  }
});

document.getElementById('removeBotBtn').addEventListener('click', () => {
  if (isAdmin && socket) {
    socket.emit('removeBot');
  }
});

document.getElementById('modifyPlayerBtn').addEventListener('click', () => {
  if (isAdmin && socket) {
    const playerName = document.getElementById('targetPlayerName').value.trim();
    const amount = document.getElementById('foodAmount').value.trim();
    if (playerName && amount) {
      socket.emit('modifyPlayer', { playerName, amount });
    }
  }
});

// Input handling - IMMEDIATE RESPONSE
let lastDirectionSend = 0;
let pendingDirection = null;

canvas.addEventListener('mousemove', (e) => {
  if (!myPlayerId || isMobile) return;
  
  const player = gameState.p[myPlayerId];
  if (!player) return;
  
  const head = player.s[0];
  const mouseX = e.clientX - canvas.width / 2 + camera.x;
  const mouseY = e.clientY - canvas.height / 2 + camera.y;
  
  const dx = mouseX - head.x;
  const dy = mouseY - head.y;
  const len = Math.hypot(dx, dy);
  
  if (len > 10) {
    pendingDirection = { x: dx / len, y: dy / len };
    
    const now = Date.now();
    if (now - lastDirectionSend > 30) { // 30ms throttle
      if (pendingDirection && socket) {
        socket.emit('changeDirection', pendingDirection);
        lastDirectionSend = now;
      }
    }
  }
});

canvas.addEventListener('mousedown', (e) => {
  if (!myPlayerId || isMobile || e.button !== 0) return;
  isBoosting = true;
  if (socket) socket.emit('boost', true);
});

canvas.addEventListener('mouseup', (e) => {
  if (!myPlayerId || isMobile || e.button !== 0) return;
  isBoosting = false;
  if (socket) socket.emit('boost', false);
});

document.addEventListener('keydown', (e) => {
  if (!myPlayerId || isMobile || e.code !== 'Space' || isBoosting) return;
  e.preventDefault();
  isBoosting = true;
  if (socket) socket.emit('boost', true);
});

document.addEventListener('keyup', (e) => {
  if (!myPlayerId || isMobile || e.code !== 'Space') return;
  e.preventDefault();
  isBoosting = false;
  if (socket) socket.emit('boost', false);
});

boostButton.addEventListener('touchstart', (e) => {
  if (!isMobile) return;
  e.preventDefault();
  isBoosting = true;
  boostButton.classList.add('active');
  if (socket) socket.emit('boost', true);
});

boostButton.addEventListener('touchend', (e) => {
  if (!isMobile) return;
  e.preventDefault();
  isBoosting = false;
  boostButton.classList.remove('active');
  if (socket) socket.emit('boost', false);
});

// Joystick - IMMEDIATE RESPONSE
let joystickActive = false;
let joystickCenter = { x: 0, y: 0 };

function handleJoystickStart(e) {
  if (!isMobile) return;
  e.preventDefault();
  joystickActive = true;
  const rect = joystickContainer.getBoundingClientRect();
  joystickCenter = {
    x: rect.left + rect.width / 2,
    y: rect.top + rect.height / 2
  };
}

function handleJoystickMove(e) {
  if (!joystickActive || !isMobile) return;
  e.preventDefault();
  
  const touch = e.touches ? e.touches[0] : e;
  const dx = touch.clientX - joystickCenter.x;
  const dy = touch.clientY - joystickCenter.y;
  const distance = Math.hypot(dx, dy);
  
  const maxDistance = 35;
  const limitedDistance = Math.min(distance, maxDistance);
  const angle = Math.atan2(dy, dx);
  
  joystickStick.style.left = (35 + Math.cos(angle) * limitedDistance) + 'px';
  joystickStick.style.top = (35 + Math.sin(angle) * limitedDistance) + 'px';
  
  if (distance > 10) {
    const len = Math.hypot(dx, dy);
    pendingDirection = { x: dx / len, y: dy / len };
    
    const now = Date.now();
    if (now - lastDirectionSend > 30 && socket) {
      socket.emit('changeDirection', pendingDirection);
      lastDirectionSend = now;
    }
  }
}

function handleJoystickEnd(e) {
  if (!isMobile) return;
  e.preventDefault();
  joystickActive = false;
  joystickStick.style.left = '35px';
  joystickStick.style.top = '35px';
}

joystickContainer.addEventListener('touchstart', handleJoystickStart, { passive: false });
joystickContainer.addEventListener('touchmove', handleJoystickMove, { passive: false });
joystickContainer.addEventListener('touchend', handleJoystickEnd, { passive: false });

function updateCamera() {
  const player = gameState.p[myPlayerId];
  if (!player) return;
  
  const head = player.s[0];
  camera.x += (head.x - camera.x) * 0.15; // Daha hizli kamera
  camera.y += (head.y - camera.y) * 0.15;
}

function updateLeaderboard() {
  const sorted = Object.entries(gameState.p)
    .sort((a, b) => b[1].sc - a[1].sc)
    .slice(0, 10);
  
  leaderboardList.innerHTML = sorted
    .map(([id, player]) => {
      const highlight = id === myPlayerId ? 'style="color: #4ECDC4; font-weight: bold;"' : '';
      return '<li ' + highlight + '>' + player.n + ': ' + player.sc + '</li>';
    })
    .join('');
}

function drawMapBorder() {
  ctx.strokeStyle = '#FF0000';
  ctx.lineWidth = 5;
  
  const x1 = mapBorder - camera.x + canvas.width / 2;
  const y1 = mapBorder - camera.y + canvas.height / 2;
  const w = mapWidth - mapBorder * 2;
  const h = mapHeight - mapBorder * 2;
  
  ctx.strokeRect(x1, y1, w, h);
  
  ctx.fillStyle = 'rgba(255, 0, 0, 0.1)';
  ctx.fillRect(x1, y1 - mapBorder, w, mapBorder);
  ctx.fillRect(x1, y1 + h, w, mapBorder);
  ctx.fillRect(x1 - mapBorder, y1, mapBorder, h);
  ctx.fillRect(x1 + w, y1, mapBorder, h);
}

function drawGrid() {
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.03)';
  ctx.lineWidth = 1;
  
  const gridSize = 50;
  const startX = Math.floor((camera.x - canvas.width / 2) / gridSize) * gridSize;
  const startY = Math.floor((camera.y - canvas.height / 2) / gridSize) * gridSize;
  const endX = camera.x + canvas.width / 2;
  const endY = camera.y + canvas.height / 2;
  
  for (let x = startX; x < endX; x += gridSize) {
    ctx.beginPath();
    ctx.moveTo(x - camera.x + canvas.width / 2, 0);
    ctx.lineTo(x - camera.x + canvas.width / 2, canvas.height);
    ctx.stroke();
  }
  
  for (let y = startY; y < endY; y += gridSize) {
    ctx.beginPath();
    ctx.moveTo(0, y - camera.y + canvas.height / 2);
    ctx.lineTo(canvas.width, y - camera.y + canvas.height / 2);
    ctx.stroke();
  }
}

function drawFoods() {
  const halfW = canvas.width / 2;
  const halfH = canvas.height / 2;
  
  for (let i = 0; i < gameState.f.length; i++) {
    const food = gameState.f[i];
    const screenX = food.x - camera.x + halfW;
    const screenY = food.y - camera.y + halfH;
    
    if (screenX < -10 || screenX > canvas.width + 10 || 
        screenY < -10 || screenY > canvas.height + 10) continue;
    
    ctx.fillStyle = food.c;
    ctx.beginPath();
    ctx.arc(screenX, screenY, 6, 0, 6.28);
    ctx.fill();
  }
}

function drawSnake(player, isMe) {
  const halfW = canvas.width / 2;
  const halfH = canvas.height / 2;
  
  for (let i = 0; i < player.s.length; i++) {
    const seg = player.s[i];
    const screenX = seg.x - camera.x + halfW;
    const screenY = seg.y - camera.y + halfH;
    
    const size = player.b && isMe ? 9 : 10;
    
    ctx.fillStyle = player.c;
    ctx.strokeStyle = isMe ? '#fff' : 'rgba(0, 0, 0, 0.3)';
    ctx.lineWidth = isMe ? 2 : 1;
    
    if (player.b && isMe && i % 2 === 0) {
      ctx.fillStyle = 'rgba(255, 255, 255, 0.2)';
      ctx.beginPath();
      ctx.arc(screenX, screenY, 12, 0, 6.28);
      ctx.fill();
    }
    
    ctx.fillStyle = player.c;
    ctx.beginPath();
    ctx.arc(screenX, screenY, size, 0, 6.28);
    ctx.fill();
    ctx.stroke();
    
    if (i === 0) {
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(screenX - 3, screenY - 3, 2, 0, 6.28);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(screenX + 3, screenY - 3, 2, 0, 6.28);
      ctx.fill();
    }
  }
  
  const head = player.s[0];
  const screenX = head.x - camera.x + halfW;
  const screenY = head.y - camera.y + halfH - 20;
  
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 14px Arial';
  ctx.textAlign = 'center';
  ctx.strokeStyle = '#000';
  ctx.lineWidth = 3;
  ctx.strokeText(player.n, screenX, screenY);
  ctx.fillText(player.n, screenX, screenY);
}

function drawFPS() {
  ctx.fillStyle = '#0F0';
  ctx.font = 'bold 14px monospace';
  ctx.textAlign = 'left';
  ctx.fillText('FPS: ' + fps, 10, 25);
  
  const player = gameState.p[myPlayerId];
  if (player) {
    ctx.fillText('Length: ' + player.sc, 10, 45);
    if (player.b) {
      ctx.fillStyle = '#FF0';
      ctx.fillText('BOOST!', 10, 65);
    }
  }
}

function render() {
  const now = Date.now();
  frameCount++;
  
  if (now - lastFpsUpdate >= 1000) {
    fps = frameCount;
    frameCount = 0;
    lastFpsUpdate = now;
  }
  
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  
  updateCamera();
  
  drawGrid();
  drawMapBorder();
  drawFoods();
  
  for (let id in gameState.p) {
    if (id !== myPlayerId) {
      drawSnake(gameState.p[id], false);
    }
  }
  
  if (gameState.p[myPlayerId]) {
    drawSnake(gameState.p[myPlayerId], true);
  }
  
  drawFPS();
  
  requestAnimationFrame(render);
}

function startGame() {
  render();
}
