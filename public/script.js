// ============================================
// SCRIPT.JS - Final Optimized Client
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

let socket;
let myPlayerId = null;
let gameState = { players: {}, foods: [] };
let interpolatedPlayers = {};
let mapWidth = 3000;
let mapHeight = 3000;
let mapBorder = 100;
let camera = { x: 0, y: 0 };
let mouseDirection = { x: 1, y: 0 };
let isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
let isBoosting = false;

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
    reconnectionDelay: 1000,
    reconnectionAttempts: 10,
    transports: ['websocket', 'polling']
  });
  
  socket.on('connect', () => {
    console.log('Connected to server');
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
    
    for (let id in state.players) {
      if (!interpolatedPlayers[id]) {
        interpolatedPlayers[id] = JSON.parse(JSON.stringify(state.players[id]));
      }
    }
    
    updateLeaderboard();
  });
  
  socket.on('death', (finalScore) => {
    setTimeout(() => {
      alert('You died! Final Score: ' + finalScore);
      location.reload();
    }, 100);
  });
  
  socket.on('disconnect', () => {
    console.log('Disconnected from server');
  });
});

// Fare hareketi
canvas.addEventListener('mousemove', (e) => {
  if (!myPlayerId || isMobile) return;
  
  const player = gameState.players[myPlayerId];
  if (!player) return;
  
  const head = player.segments[0];
  const mouseX = e.clientX - canvas.width / 2 + camera.x;
  const mouseY = e.clientY - canvas.height / 2 + camera.y;
  
  const dx = mouseX - head.x;
  const dy = mouseY - head.y;
  const len = Math.hypot(dx, dy);
  
  if (len > 10) {
    mouseDirection = { x: dx / len, y: dy / len };
    socket.emit('changeDirection', mouseDirection);
  }
});

// Mouse boost (sol tik veya space)
canvas.addEventListener('mousedown', (e) => {
  if (!myPlayerId || isMobile) return;
  if (e.button === 0) { // Sol tik
    isBoosting = true;
    socket.emit('boost', true);
  }
});

canvas.addEventListener('mouseup', (e) => {
  if (!myPlayerId || isMobile) return;
  if (e.button === 0) {
    isBoosting = false;
    socket.emit('boost', false);
  }
});

// Space tusu ile hizlanma
document.addEventListener('keydown', (e) => {
  if (!myPlayerId || isMobile) return;
  if (e.code === 'Space' && !isBoosting) {
    e.preventDefault();
    isBoosting = true;
    socket.emit('boost', true);
  }
});

document.addEventListener('keyup', (e) => {
  if (!myPlayerId || isMobile) return;
  if (e.code === 'Space') {
    e.preventDefault();
    isBoosting = false;
    socket.emit('boost', false);
  }
});

// Mobil boost button
boostButton.addEventListener('touchstart', (e) => {
  if (!isMobile) return;
  e.preventDefault();
  isBoosting = true;
  boostButton.classList.add('active');
  socket.emit('boost', true);
});

boostButton.addEventListener('touchend', (e) => {
  if (!isMobile) return;
  e.preventDefault();
  isBoosting = false;
  boostButton.classList.remove('active');
  socket.emit('boost', false);
});

// Joystick
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
    mouseDirection = { x: dx / len, y: dy / len };
    socket.emit('changeDirection', mouseDirection);
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
  const player = gameState.players[myPlayerId];
  if (!player) return;
  
  const head = player.segments[0];
  const lerpFactor = 0.1;
  camera.x += (head.x - camera.x) * lerpFactor;
  camera.y += (head.y - camera.y) * lerpFactor;
}

function updateLeaderboard() {
  const sorted = Object.entries(gameState.players)
    .sort((a, b) => b[1].score - a[1].score)
    .slice(0, 10);
  
  leaderboardList.innerHTML = sorted
    .map(([id, player]) => {
      const highlight = id === myPlayerId ? 'style="color: #4ECDC4; font-weight: bold;"' : '';
      return '<li ' + highlight + '>' + player.name + ': ' + player.score + '</li>';
    })
    .join('');
}

function drawMapBorder() {
  ctx.strokeStyle = '#FF0000';
  ctx.lineWidth = 5;
  
  const x1 = mapBorder - camera.x + canvas.width / 2;
  const y1 = mapBorder - camera.y + canvas.height / 2;
  const x2 = mapWidth - mapBorder - camera.x + canvas.width / 2;
  const y2 = mapHeight - mapBorder - camera.y + canvas.height / 2;
  
  ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);
  
  ctx.fillStyle = 'rgba(255, 0, 0, 0.15)';
  ctx.fillRect(x1, y1 - mapBorder, x2 - x1, mapBorder);
  ctx.fillRect(x1, y2, x2 - x1, mapBorder);
  ctx.fillRect(x1 - mapBorder, y1, mapBorder, y2 - y1);
  ctx.fillRect(x2, y1, mapBorder, y2 - y1);
}

function drawGrid() {
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.03)';
  ctx.lineWidth = 1;
  
  const gridSize = 50;
  const startX = Math.floor((camera.x - canvas.width / 2) / gridSize) * gridSize;
  const startY = Math.floor((camera.y - canvas.height / 2) / gridSize) * gridSize;
  
  for (let x = startX; x < camera.x + canvas.width / 2; x += gridSize) {
    ctx.beginPath();
    ctx.moveTo(x - camera.x + canvas.width / 2, 0);
    ctx.lineTo(x - camera.x + canvas.width / 2, canvas.height);
    ctx.stroke();
  }
  
  for (let y = startY; y < camera.y + canvas.height / 2; y += gridSize) {
    ctx.beginPath();
    ctx.moveTo(0, y - camera.y + canvas.height / 2);
    ctx.lineTo(canvas.width, y - camera.y + canvas.height / 2);
    ctx.stroke();
  }
}

function drawFoods() {
  gameState.foods.forEach(food => {
    const screenX = food.x - camera.x + canvas.width / 2;
    const screenY = food.y - camera.y + canvas.height / 2;
    
    if (screenX < -20 || screenX > canvas.width + 20 || 
        screenY < -20 || screenY > canvas.height + 20) {
      return;
    }
    
    ctx.fillStyle = food.color;
    ctx.beginPath();
    ctx.arc(screenX, screenY, 6, 0, Math.PI * 2);
    ctx.fill();
  });
}

function drawSnake(player, isMe) {
  if (!isMe && interpolatedPlayers[player.name]) {
    const interp = interpolatedPlayers[player.name];
    player.segments.forEach((seg, idx) => {
      if (interp.segments[idx]) {
        interp.segments[idx].x += (seg.x - interp.segments[idx].x) * 0.3;
        interp.segments[idx].y += (seg.y - interp.segments[idx].y) * 0.3;
      }
    });
    player = interp;
  }
  
  player.segments.forEach((seg, idx) => {
    const screenX = seg.x - camera.x + canvas.width / 2;
    const screenY = seg.y - camera.y + canvas.height / 2;
    
    // Hizlanma efekti
    const segmentSize = (player.boosting && isMe) ? 9 : 10;
    
    ctx.fillStyle = player.color;
    ctx.strokeStyle = isMe ? '#fff' : 'rgba(0, 0, 0, 0.3)';
    ctx.lineWidth = isMe ? 2 : 1;
    
    // Hizlanma parcaciklari
    if (player.boosting && isMe && idx % 3 === 0) {
      ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
      ctx.beginPath();
      ctx.arc(screenX, screenY, 12, 0, Math.PI * 2);
      ctx.fill();
    }
    
    ctx.fillStyle = player.color;
    ctx.beginPath();
    ctx.arc(screenX, screenY, segmentSize, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    
    if (idx === 0) {
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(screenX - 3, screenY - 3, 2, 0, Math.PI * 2);
      ctx.arc(screenX + 3, screenY - 3, 2, 0, Math.PI * 2);
      ctx.fill();
    }
  });
  
  const head = player.segments[0];
  const screenX = head.x - camera.x + canvas.width / 2;
  const screenY = head.y - camera.y + canvas.height / 2 - 20;
  
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 14px Arial';
  ctx.textAlign = 'center';
  ctx.strokeStyle = '#000';
  ctx.lineWidth = 3;
  ctx.strokeText(player.name, screenX, screenY);
  ctx.fillText(player.name, screenX, screenY);
}

function drawFPS() {
  ctx.fillStyle = '#0F0';
  ctx.font = 'bold 16px monospace';
  ctx.textAlign = 'left';
  ctx.fillText('FPS: ' + fps, 10, 30);
  
  const player = gameState.players[myPlayerId];
  if (player) {
    ctx.fillText('Length: ' + player.score, 10, 50);
    if (player.boosting) {
      ctx.fillStyle = '#FF0';
      ctx.fillText('BOOSTING!', 10, 70);
    }
  }
}

function render() {
  frameCount++;
  const now = Date.now();
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
  
  for (let id in gameState.players) {
    if (id !== myPlayerId) {
      drawSnake(gameState.players[id], false);
    }
  }
  
  if (gameState.players[myPlayerId]) {
    drawSnake(gameState.players[myPlayerId], true);
  }
  
  drawFPS();
  
  requestAnimationFrame(render);
}

function startGame() {
  render();
  }
