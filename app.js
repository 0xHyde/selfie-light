'use strict';

/* ================= 状态 ================= */
const state = {
  started: false,
  kelvin: 3500,      // 色温（K）
  pink: 0.15,        // 粉调混合量（预设专用，0~1）
  brightness: 100,   // 亮度（%）
  camOn: false,
};

/* ================= DOM ================= */
const $ = (s) => document.querySelector(s);
const light = $('#light');
const dim = $('#dim');
const kSlider = $('#kSlider');
const bSlider = $('#bSlider');
const kVal = $('#kVal');
const bVal = $('#bVal');
const cam = $('#cam');
const shutter = $('#shutter');
const camToggle = $('#camToggle');
const strip = $('#strip');
const ui = $('#ui');
const toastEl = $('#toast');
const startOverlay = $('#startOverlay');
const startBtn = $('#startBtn');

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

function lightColor() {
  let [r, g, b] = soften(kelvinToRGB(state.kelvin));
  const p = state.pink * 0.6;              // 向粉调混合
  r = Math.round(r + (PINK[0] - r) * p);
  g = Math.round(g + (PINK[1] - g) * p);
  b = Math.round(b + (PINK[2] - b) * p);
  return `rgb(${r},${g},${b})`;
}

function applyLight() {
  light.style.background = lightColor();
  dim.style.opacity = String((100 - state.brightness) / 100);
}

/* ================= 预设 ================= */
document.querySelectorAll('.preset').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.preset').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    state.kelvin = Number(btn.dataset.k);
    state.pink = Number(btn.dataset.tint);
    kSlider.value = state.kelvin;
    kVal.textContent = state.kelvin + 'K';
    applyLight();
  });
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

/* ================= 沉浸模式：轻点空白处隐藏/显示 UI ================= */
document.body.addEventListener('click', (e) => {
  if (!state.started) return;
  if (e.target.closest('button, input, .strip')) return;
  ui.classList.toggle('hidden');
});

/* ================= 提示 ================= */
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
});

/* 初始渲染 */
applyLight();
