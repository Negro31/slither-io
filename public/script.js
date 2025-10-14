javascript
// ============================================
// SCRIPT.JS - Client-Side Game Logic
// ============================================

// DOM Elemanları
const loginScreen = document.getElementById('loginScreen');
const gameScreen = document.getElementById('gameScreen');
const nameInput = document.getElementById('nameInput');
const joinButton = document.getElementById('joinButton');
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const leaderboardList = document.getElementById('leaderboardList');
const joystickContainer = document.getElementById('joystickContainer');
const joystickStick = document.getElementById('joystickStick');

// Oyun değişkenleri
let socket;
let myPlayerId = null;
let gameState = { players: {}, foods: [] };
let mapWidth = 2000;
let mapHeight = 2000;
let camera = { x: 0, y: 0 };
let mouseDirection = { x: 1, y: 0 };
let isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);

// Canvas boyutlandırma (responsive)
function resizeCanvas() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
}
resizeCanvas();
window.addEventListener('resize', resizeCanvas);

// Giriş işlemi
joinButton.addEventListener('click', () => {
  const name = nameInput.value.trim() || 'Anonim';
  socket = io();
  
  socket.on('connect', () => {
    socket.emit('join', name);
  });
  
  socket.on('init', (data) => {
    myPlayerId = data.playerId;
    mapWidth = data.mapWidth;
    mapHeight = data.mapHeight;
    loginScreen.style.display = 'none';
    gameScreen.style.display = 'block';
    startGame();
  });
  
  socket.on('gameState', (state) => {
    gameState = state;
    updateLeaderboard();
  });
  
  socket.on('death', () => {
    alert('Öldün! Yeniden başlıyorsun...');
    location.reload();
  });
});

// Fare hareketi (Desktop)
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

// Joystick kontrolü (Mobile)
let joystickActive = false;
let joystickCenter = { x: 0, y: 0 };

function handleJoystickStart(e) {
  if (!isMobile) return;
  joystickActive = true;
  const rect = joystickContainer.getBoundingClientRect();
  joystickCenter = {
    x: rect.left + rect.width / 2,
    y: rect.top + rect.height / 2
  };
}

function handleJoystickMove(e) {
  if (!joystickActive || !isMobile) return;
  
  const touch = e.touches ? e.touches[0] : e;
  const dx = touch.clientX - joystickCenter.x;
  const dy = touch.clientY - joystickCenter.y;
  const distance = Math.hypot(dx, dy);
  
  // Joystick görselini güncelle
  const maxDistance = 35;
  const limitedDistance = Math.min(distance, maxDistance);
  const angle = Math.atan2(dy, dx);
  
  joystickStick.style.left = `${35 + Math.cos(angle) * limitedDistance}px`;
  joystickStick.style.top = `${35 + Math.sin(angle) * limitedDistance}px`;
  
  // Yön gönder
  if (distance > 10) {
    const len = Math.hypot(dx, dy);
    mouseDirection = { x: dx / len, y: dy / len };
    socket.emit('changeDirection', mouseDirection);
  }
}

function handleJoystickEnd() {
  joystickActive = false;
  joystickStick.style.left = '35px';
  joystickStick.style.top = '35px';
}

joystickContainer.addEventListener('touchstart', handleJoystickStart);
joystickContainer.addEventListener('touchmove', handleJoystickMove);
joystickContainer.addEventListener('touchend', handleJoystickEnd);
joystickContainer.addEventListener('mousedown', handleJoystickStart);
document.addEventListener('mousemove', handleJoystickMove);
document.addEventListener('mouseup', handleJoystickEnd);

// Kamera takibi
function updateCamera() {
  const player = gameState.players[myPlayerId];
  if (!player) return;
  
  const head = player.segments[0];
  camera.x = head.x;
  camera.y = head.y;
}

// Lider tablosu güncelleme
function updateLeaderboard() {
  const sorted = Object.entries(gameState.players)
    .sort((a, b) => b[1].score - a[1].score)
    .slice(0, 10);
  
  leaderboardList.innerHTML = sorted
    .map(([id, player]) => {
      const highlight = id === myPlayerId ? 'style="color: #4ECDC4; font-weight: bold;"' : '';
      return `<li ${highlight}>${player.name}: ${player.score}</li>`;
    })
    .join('');
}

// Çizim fonksiyonları
function drawGrid() {
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
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
    
    ctx.fillStyle = food.color;
    ctx.beginPath();
    ctx.arc(screenX, screenY, 6, 0, Math.PI * 2);
    ctx.fill();
  });
}

function drawSnake(player, isMe) {
  player.segments.forEach((seg, idx) => {
    const screenX = seg.x - camera.x + canvas.width / 2;
    const screenY = seg.y - camera.y + canvas.height / 2;
    
    // Segment çizimi
    ctx.fillStyle = player.color;
    ctx.strokeStyle = isMe ? '#fff' : 'rgba(0, 0, 0, 0.5)';
    ctx.lineWidth = isMe ? 3 : 1;
    
    ctx.beginPath();
    ctx.arc(screenX, screenY, 10, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    
    // Baş için göz
    if (idx === 0) {
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(screenX - 4, screenY - 2, 2, 0, Math.PI * 2);
      ctx.arc(screenX + 4, screenY - 2, 2, 0, Math.PI * 2);
      ctx.fill();
    }
  });
  
  // İsim
  const head = player.segments[0];
  const screenX = head.x - camera.x + canvas.width / 2;
  const screenY = head.y - camera.y + canvas.height / 2 - 20;
  
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 14px Arial';
  ctx.textAlign = 'center';
  ctx.fillText(player.name, screenX, screenY);
}

// Ana render döngüsü
function render() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  
  updateCamera();
  
  drawGrid();
  drawFoods();
  
  // Diğer oyuncuları çiz
  for (let id in gameState.players) {
    if (id !== myPlayerId) {
      drawSnake(gameState.players[id], false);
    }
  }
  
  // Kendi yılanımızı en üstte çiz
  if (gameState.players[myPlayerId]) {
    drawSnake(gameState.players[myPlayerId], true);
  }
  
  requestAnimationFrame(render);
}

function startGame() {
  render();
}
