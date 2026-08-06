'use strict';

/* ================= 状态 ================= */
const state = {
  started: false,
  immersed: false,
  kelvin: 3500,      // 色温（K）
  pink: 0.15,        // 粉调混合量（预设专用，0~1）
  brightness: 100,   // 亮度（%）
  camOn: false,
};

/* ================= DOM ================= */
const $ = (s) => document.querySelector(s);
const light = $('#light');
const dim = $('#dim');
const hudEl = $('#hud');
const kSlider = $('#kSlider');
const bSlider = $('#bSlider');
const kVal = $('#kVal');
const bVal = $('#bVal');
const cam = $('#cam');
const shutter = $('#shutter');
const camToggle = $('#camToggle');
const immerseBtn = $('#immerseBtn');
const strip = $('#strip');
const ui = $('#ui');
const toastEl = $('#toast');
const startOverlay = $('#startOverlay');
const startBtn = $('#startBtn');

/* ================= 预设 ================= */
const PRESETS = [
  { name: '暖白', k: 3500, tint: 0.15 },
  { name: '冷白', k: 5500, tint: 0 },
  { name: '粉调', k: 3300, tint: 0.85 },
  { name: '自然光', k: 4500, tint: 0 },
];
let presetIdx = 0;

/* ================= 色温 -> RGB ================= */
// Tanner Helland 黑体色温近似
function kelvinToRGB(k) {
  const t = k / 100;
  let r, g, b;
  if (t <= 66) r = 255;
  else r = 329.698727446 * Math.pow(t - 60, -0.1332047592);

  if (t <= 66) g = 99.4708025861 * Math.log(t) - 161.1195681661;
  else g = 288.1221695283 * Math.pow(t - 60, -0.0755148492);

  if (t >= 66) b = 255;
  else if (t <= 19) b = 0;
  else b = 138.5177312231 * Math.log(t - 10) - 305.0447927307;

  return [clamp(r), clamp(g), clamp(b)];
}

const clamp = (x) => Math.max(0, Math.min(255, Math.round(x)));

// 向中性白收敛 45%，避免纯色温显示得像颜料（用作补光时应是柔和的白）
const soften = ([r, g, b]) => [
  Math.round(r + (255 - r) * 0.45),
  Math.round(g + (255 - g) * 0.45),
  Math.round(b + (255 - b) * 0.45),
];

const PINK = [255, 205, 216];

function lightRGB(k, tint) {
  let [r, g, b] = soften(kelvinToRGB(k));
  const m = tint * 0.6;              // 向粉调混合
  r = Math.round(r + (PINK[0] - r) * m);
  g = Math.round(g + (PINK[1] - g) * m);
  b = Math.round(b + (PINK[2] - b) * m);
  return [r, g, b];
}

function applyLight() {
  const [r, g, b] = lightRGB(state.kelvin, state.pink);
  light.style.background = `rgb(${r},${g},${b})`;
  dim.style.opacity = String((100 - state.brightness) / 100);
}

/* 滑杆轨道渐变 */
function initTracks() {
  const warm = lightRGB(3000, 0);
  const cool = lightRGB(6500, 0);
  kSlider.style.setProperty('--track', `linear-gradient(to right, rgb(${warm.join(',')}), rgb(${cool.join(',')}))`);
  bSlider.style.setProperty('--track', 'linear-gradient(to right, #000, #fff)');
}

/* ================= 预设按钮 ================= */
function applyPreset(idx) {
  presetIdx = (idx + PRESETS.length) % PRESETS.length;
  const p = PRESETS[presetIdx];
  state.kelvin = p.k;
  state.pink = p.tint;
  kSlider.value = state.kelvin;
  kVal.textContent = state.kelvin + 'K';
  document.querySelectorAll('.preset').forEach((b) => b.classList.toggle('active', Number(b.dataset.idx) === presetIdx));
  applyLight();
}

document.querySelectorAll('.preset').forEach((btn) => {
  const i = Number(btn.dataset.idx);
  btn.style.setProperty('--swatch', `rgb(${lightRGB(PRESETS[i].k, PRESETS[i].tint).join(',')})`);
  btn.addEventListener('click', () => applyPreset(i));
});

/* ================= 滑杆 ================= */
kSlider.addEventListener('input', () => {
  state.kelvin = Number(kSlider.value);
  kVal.textContent = state.kelvin + 'K';
  document.querySelectorAll('.preset').forEach((b) => b.classList.remove('active')); // 已偏离预设
  applyLight();
});

bSlider.addEventListener('input', () => {
  state.brightness = Number(bSlider.value);
  bVal.textContent = state.brightness + '%';
  applyLight();
});

/* ================= 防休眠（Screen Wake Lock） ================= */
let wakeLock = null;

async function acquireWakeLock() {
  if (!('wakeLock' in navigator)) return;
  try {
    wakeLock = await navigator.wakeLock.request('screen');
    wakeLock.addEventListener('release', () => { wakeLock = null; });
  } catch (e) { /* 权限/低版本不支持时静默降级 */ }
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && state.started && !wakeLock) acquireWakeLock();
});

/* ================= 全屏（iOS Safari 不支持元素全屏，静默忽略） ================= */
async function enterFullscreen() {
  try {
    if (document.fullscreenEnabled) {
      await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
    }
  } catch (e) { /* 忽略 */ }
}

/* ================= 相机 ================= */
let stream = null;

async function startCamera() {
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'user', width: { ideal: 1280 } },
      audio: false,
    });
    cam.srcObject = stream;
    state.camOn = true;
    camToggle.textContent = '相机关';
    shutter.disabled = false;
  } catch (e) {
    state.camOn = false;
    toast('相机不可用，仍可当纯补光灯使用');
  }
}

function stopCamera() {
  if (stream) { stream.getTracks().forEach((t) => t.stop()); stream = null; }
  cam.srcObject = null;
  state.camOn = false;
  camToggle.textContent = '相机开';
  shutter.disabled = true;
}

camToggle.addEventListener('click', () => {
  if (state.camOn) stopCamera();
  else startCamera();
});

/* ================= 拍照 ================= */
shutter.addEventListener('click', () => {
  if (!state.camOn || !cam.videoWidth) return;
  const canvas = document.createElement('canvas');
  canvas.width = cam.videoWidth;
  canvas.height = cam.videoHeight;
  const ctx = canvas.getContext('2d');
  ctx.translate(canvas.width, 0); // 自拍镜像，与预览一致（CSS 镜像不影响 canvas 绘制）
  ctx.scale(-1, 1);
  ctx.drawImage(cam, 0, 0);
  canvas.toBlob((blob) => {
    const url = URL.createObjectURL(blob);
    const card = document.createElement('div');
    card.className = 'photo';
    const img = document.createElement('img');
    img.src = url;
    const a = document.createElement('a');
    a.href = url;
    a.download = 'selfie-' + Date.now() + '.png';
    a.textContent = '保存';
    a.addEventListener('click', () => toast('已保存（iOS 请长按图片存到相册）'));
    card.appendChild(img);
    card.appendChild(a);
    strip.prepend(card);
    strip.scrollLeft = 0;
  }, 'image/png');
});

$('#clearBtn').addEventListener('click', () => { strip.innerHTML = ''; });

/* ================= 沉浸模式 + 手势调光 ================= */
function setImmersed(on) {
  state.immersed = on;
  ui.classList.toggle('hidden', on);
  if (on) hud('纯光模式 · 左右滑切预设，上下滑调亮度', 1600);
}

immerseBtn.addEventListener('click', () => setImmersed(true));

// 轻点空白处：切换沉浸模式（touch 手势后的 click 用时间戳抑制，避免双重切换）
let suppressClickAt = 0;

document.body.addEventListener('click', (e) => {
  if (!state.started) return;
  if (Date.now() - suppressClickAt < 500) { suppressClickAt = 0; return; }
  if (e.target.closest('button, input, .strip, .cam')) return;
  setImmersed(!state.immersed);
});

let g = null;

document.body.addEventListener('touchstart', (e) => {
  if (!state.started || e.target.closest('button, input, .strip, .cam')) return;
  const t = e.touches[0];
  g = { x: t.clientX, y: t.clientY, axis: null, dx: 0, dy: 0, b0: state.brightness, moved: false };
}, { passive: true });

document.body.addEventListener('touchmove', (e) => {
  if (!g) return;
  const t = e.touches[0];
  const dx = t.clientX - g.x;
  const dy = t.clientY - g.y;
  if (!g.axis) {
    if (Math.abs(dx) < 12 && Math.abs(dy) < 12) return; // 位移不足，尚未判定方向
    g.axis = Math.abs(dx) > Math.abs(dy) ? 'h' : 'v';
    document.body.classList.add('dragging');
  }
  g.dx = dx;
  g.dy = dy;
  g.moved = true;

  if (g.axis === 'v') {                      // 上下滑 = 调亮度（实时跟手）
    const next = Math.max(0, Math.min(100, Math.round(g.b0 - dy * 0.25)));
    if (next !== state.brightness) {
      state.brightness = next;
      bSlider.value = next;
      bVal.textContent = next + '%';
      applyLight();
      hud('亮度 ' + next + '%');
    }
  }
  if (e.cancelable) e.preventDefault();      // 阻止 iOS 橡皮筋/下拉
}, { passive: false });

document.body.addEventListener('touchend', () => {
  if (!g) return;
  const { axis, dx, moved } = g;
  g = null;
  document.body.classList.remove('dragging');

  if (axis === 'h' && Math.abs(dx) > 60) {   // 左右滑 = 切预设（松手生效）
    applyPreset(presetIdx + (dx < 0 ? 1 : -1));
    if (navigator.vibrate) navigator.vibrate(12);
    hud('预设 · ' + PRESETS[presetIdx].name);
  } else if (!moved && state.immersed) {     // 轻点 = 退出沉浸
    suppressClickAt = Date.now();
    setImmersed(false);
  }
});

/* ================= 手势 HUD ================= */
let hudTimer;

function hud(text, ms = 900) {
  hudEl.textContent = text;
  hudEl.classList.add('show');
  clearTimeout(hudTimer);
  hudTimer = setTimeout(() => hudEl.classList.remove('show'), ms);
}

/* ================= 轻提示 ================= */
let toastTimer;

function toast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2500);
}

/* ================= 启动 ================= */
startBtn.addEventListener('click', () => {
  state.started = true;
  startOverlay.classList.add('hidden');
  enterFullscreen();   // 需用户手势触发
  acquireWakeLock();   // 防休眠
  startCamera();       // 失败时降级为纯补光灯
  toast('轻点屏幕 = 纯光模式');
});

/* 初始渲染 */
initTracks();
applyLight();
