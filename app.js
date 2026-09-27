// Laufbursche Apollo Tool: a Web Bluetooth client for Apollo Scooters (app com.apolloscooters).
// Protocol is Apollo's own "Mach" link (libapollo-ble.so, ApolloBleScootersSdk/ApolloBleTransport).
// Every constant here comes from Apollo's own app/library disassembly, see apollo_gesamtanalyse.md.
// Not verified on a vehicle. Runs in Bluefy (iOS) or Chrome/Edge (Android/desktop); no Safari WebBT.

'use strict';

const BUILD = 'v2';   // logged on load so a tester's log reveals which deployed build is running

// --------------------------- helpers ---------------------------

function hexToBytes(h) { h = (h || '').replace(/[^0-9a-fA-F]/g, ''); const a = []; for (let i = 0; i + 1 < h.length; i += 2) a.push(parseInt(h.substr(i, 2), 16)); return a; }
function bytesToHex(b) { return [...b].map(x => x.toString(16).padStart(2, '0').toUpperCase()).join(' '); }

// --------------------------- CRC-16/MODBUS ---------------------------
// Belegt: native crc engine (0x8a600/0x8a728), poly 0x8005 init 0xFFFF refin/refout=1 xorout=0. Appended low byte first.
function crc16Modbus(bytes, len) {
  let crc = 0xFFFF;
  const n = (len === undefined) ? bytes.length : len;
  for (let i = 0; i < n; i++) {
    crc ^= bytes[i];
    for (let b = 0; b < 8; b++) crc = (crc & 1) ? ((crc >>> 1) ^ 0xA001) : (crc >>> 1);
  }
  return crc & 0xFFFF;
}
function appendCrc(head) { const c = crc16Modbus(head, head.length); return new Uint8Array([...head, c & 0xFF, (c >>> 8) & 0xFF]); }

// --------------------------- Apollo "Mach" frame builders (belegt from libapollo-ble.so) ---------------------------
// Byte layouts belegt from the real frame builders (0x8a870/0x8af54/0x8b3a0/0x8b348), not just their JNI shims.

// buildKeepAlive (native 0x8b3a0): constant 4 bytes, no CRC.
function apolloKeepAliveFrame() { return new Uint8Array([0xA5, 0x02, 0xFD, 0x5A]); }

// buildTransmissionCommand(cmd) (native 0x8b348): 8 bytes, no CRC.
function apolloTransmissionFrame(cmd) { return new Uint8Array([0xA5, cmd & 0xFF, (~cmd) & 0xFF, 0, 0, 0, 0, 0x5A]); }

// buildReadCommand (native 0x8a870): flag cmd addrHi addrLo cntHi cntLo crc. flag defaults 0x01.
function apolloReadFrame(cmd, addr, count, flag) {
  flag = (flag === undefined) ? 0x01 : (flag & 0xFF);
  return appendCrc([flag, cmd & 0xFF, (addr >>> 8) & 0xFF, addr & 0xFF, (count >>> 8) & 0xFF, count & 0xFF]);
}

// buildWriteCommand (native 0x8af54): flag 0x17 addr wcnt addr wcnt bcount value.. crc (addr/wcnt repeat twice).
function apolloWriteFrame(addr, valueBytes, flag) {
  flag = (flag === undefined) ? 0x01 : (flag & 0xFF);
  const words = Math.floor(valueBytes.length / 2);
  const addrHi = (addr >>> 8) & 0xFF, addrLo = addr & 0xFF, wHi = (words >>> 8) & 0xFF, wLo = words & 0xFF;
  const head = [flag, 0x17, addrHi, addrLo, wHi, wLo, addrHi, addrLo, wHi, wLo, valueBytes.length & 0xFF, ...valueBytes];
  return appendCrc(head);
}

// buildSetBaseParamsFrame (native 0x8b3e0): header AB 00 0A belegt, status-byte bit layout NOT resolved -
// no lock/gear/light toggle implemented here for that reason (see GUIDE "not yet reverse-engineered").

// buildCheckPassword(pin) (native 0x8bfe4): "AT+PWD[" is a literal ASCII immediate, pin appended raw, no crypto.
function apolloPwdCommand(pin) { return 'AT+PWD[' + pin + ']'; }

// --------------------------- register write helper ---------------------------
// Belegt: ApolloBleScootersSdk.java setAdvParams -> engine.setAdvParamU16(index,value) -> buildAdvParamValueU16.
function apolloWriteU16(addr, value) {
  const v = Math.round(value) & 0xFFFF;
  return apolloWriteFrame(addr, [(v >>> 8) & 0xFF, v & 0xFF]);
}

// --------------------------- self-test against belegte vectors ---------------------------
let PROTO_OK = false;
(function protoSelfTest() {
  const eq = (a, h) => bytesToHex(a) === h;
  const ok = [
    crc16Modbus([0x31, 0x32, 0x33, 0x34, 0x35, 0x36, 0x37, 0x38, 0x39]) === 0x4B37,   // CRC-16/MODBUS catalog vector "123456789"
    eq(apolloKeepAliveFrame(), 'A5 02 FD 5A'),
    eq(apolloTransmissionFrame(0x00), 'A5 00 FF 00 00 00 00 5A'),
    eq(apolloTransmissionFrame(0xFF), 'A5 FF 00 00 00 00 00 5A'),
    (function () { const f = apolloReadFrame(0x07, 0x0000, 0x0004); return f.length === 8 && f[0] === 0x01 && f[1] === 0x07 && f[2] === 0x00 && f[3] === 0x00 && f[4] === 0x00 && f[5] === 0x04; })(),
    (function () {
      const f = apolloWriteFrame(0x20, [0x01, 0x2C]);   // register 0x20 (limitedSpeedValue) = 300 (30.0 km/h * 10)
      return f.length === 15 && f[0] === 0x01 && f[1] === 0x17 &&
        f[2] === 0x00 && f[3] === 0x20 && f[4] === 0x00 && f[5] === 0x01 &&
        f[6] === 0x00 && f[7] === 0x20 && f[8] === 0x00 && f[9] === 0x01 &&
        f[10] === 0x02 && f[11] === 0x01 && f[12] === 0x2C;
    })(),
    (function () { const f = apolloWriteU16(0x20, 300); return f[2] === 0x00 && f[3] === 0x20 && f[11] === 0x01 && f[12] === 0x2C; })(),
  ];
  PROTO_OK = ok.every(Boolean);
})();

// --------------------------- BLE transport constants (belegt, native disassembly) ---------------------------
// Every UUID below read directly out of libapollo-ble.so's UUID getters (native 0x57c1c-0x57cbc).
const U = s => '0000' + s + '-0000-1000-8000-00805f9b34fb';
const GATT = {
  data:    { service: U('f1f0'), write: U('f1f1'), notify: U('f1f2') },
  at:      { service: U('f2f0'), write: U('f2f1'), notify: U('f2f2') },
  ota:     { service: '02f00000-0000-0000-0000-00000000fe00', write: '02f00000-0000-0000-0000-00000000ff01', notify: '02f00000-0000-0000-0000-00000000ff02' },   // diag-only, no OTA implemented here
  cccd:    '00002902-0000-1000-8000-00805f9b34fb',
};
const ALL_SERVICES = [GATT.data.service, GATT.at.service, GATT.ota.service];

// Belegt verbatim: isHwBleName in the app's own JS bundle (decompiled.js) - same check the real app uses.
function classifyApolloName(name) {
  if (!name) return false;
  const n = String(name).trim().toLowerCase();
  return n.startsWith('hw') || n.startsWith('apollo') || n.startsWith('phantom');
}

// --------------------------- model list (belegt: app's own ScooterType enum, decompiled.js) ---------------------------
// Label only, no protocol branching by model.
const MODELS = [
  ['apolloGhost', 'Apollo Ghost 2023'],
  ['apolloAir2021', 'Apollo Air 2021'],
  ['apolloAirPro2021', 'Apollo Air Pro 2021'],
  ['apolloAirPro2022', 'Apollo Air Pro 2022'],
  ['apolloAirPro2023', 'Apollo Air Pro 2023'],
  ['apolloAirPro2024', 'Apollo Air Pro 2024'],
  ['apolloCity2022', 'Apollo City 2022'],
  ['apolloCity2023', 'Apollo City 2023'],
  ['apolloCityPro2022', 'Apollo City Pro 2022'],
  ['apolloCityPro2023', 'Apollo City Pro 2023'],
  ['apolloCityPro2024', 'Apollo City Pro 2024'],
  ['apolloPro2023', 'Apollo Pro 2023'],
  ['apolloPhantom2022', 'Apollo Phantom 2022'],
  ['apolloPhantom2023', 'Apollo Phantom 2023'],
  ['apolloPhantom2024', 'Apollo Phantom 2024'],
  ['apolloGo2024', 'Apollo Go 2024'],
  ['apolloPhantom2025', 'Apollo Phantom 2025'],
  ['apolloPhantomStellar2025', 'Apollo Phantom Stellar 2025'],
  ['apolloCityPro2025', 'Apollo City Pro 2025'],
  ['apolloGo2025', 'Apollo Go 2025'],
  ['apolloExplore2025', 'Apollo Explore 2025'],
  ['apolloGo2026', 'Apollo Go 2026'],
  ['apolloGoStellar2026', 'Apollo Go Stellar 2026'],
  ['apolloDash2026', 'Apollo Dash 2026'],
  ['apolloCity2026', 'Apollo City 2026'],
  ['apolloCityStellar2026', 'Apollo City Stellar 2026'],
  ['apolloExploreStellar2026', 'Apollo Explore Stellar 2026'],
];
const DEFAULT_MODEL = 'auto';

const LS_THEME = 'apu_theme', LS_DEVICE = 'apu_device', LS_MODEL = 'apu_model', LS_SPEED = 'apu_speed', LS_EKFV = 'apu_ekfv', LS_PIN = 'apu_pin';
let speedUnlocked = false;

// --------------------------- register table (belegt: ApolloBleScootersSdk.java setAdvParams) ---------------------------
// Fields with no belegte write-register index (modDepth, polePairs, dischargeCur, brakeCur, voltProt,
// wheel, carrier) are deliberately left out - see GUIDE "not yet reverse-engineered".
const REGISTERS = {
  limitedSpeedValue:          { addr: 32, factor: 10 },     // km/h * 10 (ApolloBleScootersSdk.java:634)
  acceleratedThrottleResponse:{ addr: 9,  factor: 3000 },   // ApolloBleScootersSdk.java:631
  acceleratorBrakeResponse:   { addr: 10, factor: 3000 },   // ApolloBleScootersSdk.java:628
  cruiseStartTime:            { addr: 51, factor: 1 },      // ApolloBleScootersSdk.java:637
  shutdownTime:                { addr: 52, factor: 1 },      // ApolloBleScootersSdk.java:640
  serviceMileage:              { addr: 73, factor: 1 },      // ApolloBleScootersSdk.java:643
};
const TOTAL_MILEAGE_RESET = { addr: 0, value: 8192 };        // ApolloBleScootersSdk.java:726, setTotalMileageReset()

// --------------------------- state ---------------------------
let device = null, server = null, dataWrite = null, dataNotify = null, atWrite = null;
let connected = false, connecting = false;
let keepTimer = null;

// --------------------------- UI helpers ---------------------------
function $(id) { return document.getElementById(id); }

const logLines = [];
function ts() { const d = new Date(); const p = (n, w) => String(n).padStart(w || 2, '0'); return p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds()) + '.' + p(d.getMilliseconds(), 3); }
function log(m, cls) {
  const line = '[' + ts() + '] ' + m;
  logLines.push(line);
  const el = $('log'); if (!el) return;
  const span = document.createElement('div');
  if (cls) span.className = cls;
  span.textContent = line;
  el.insertBefore(span, el.firstChild);
}
function logDiagnosticHeader() {
  const nav = (typeof navigator !== 'undefined') ? navigator : {};
  log('=== ap-unlock diagnostic ===');
  log('build: ' + BUILD);
  log('time: ' + new Date().toISOString());
  log('userAgent: ' + (nav.userAgent || '(unknown)'));
  log('platform: ' + (nav.platform || '(unknown)'));
  log('webBluetooth: ' + (nav.bluetooth ? 'yes' : 'no'));
  log('protocol source: Apollo\'s own app only (native libapollo-ble.so disassembly + Kotlin bridge). See apollo_gesamtanalyse.md.', 'log-ok');
  log('============================');
}
async function copyLog() {
  const text = logLines.join('\n');
  let ok = false;
  try { if (navigator.clipboard && navigator.clipboard.writeText) { await navigator.clipboard.writeText(text); ok = true; } } catch (e) { ok = false; }
  if (!ok) ok = copyLogFallback(text);
  log(ok ? 'log copied (' + logLines.length + ' lines)' : 'log copy failed, please select the log text manually', ok ? 'log-ok' : 'log-err');
}
function copyLogFallback(text) {
  try {
    const ta = document.createElement('textarea');
    ta.value = text; ta.setAttribute('readonly', ''); ta.className = 'copy-offscreen';
    document.body.appendChild(ta); ta.select(); ta.setSelectionRange(0, text.length);
    const ok = document.execCommand && document.execCommand('copy');
    document.body.removeChild(ta); return !!ok;
  } catch (e) { return false; }
}
const HELP = { speed: ['s3Title', 'settingsHint'], live: ['liveTitle', 'liveHint'], more: ['moreTitle', 'moreHint'], disclaimer: ['footDisclaimer', 'disclaimerText'] };
function openHelp(key) {
  const m = HELP[key]; if (!m) return;
  const dlg = $('help'); if (!dlg) return;
  const ti = $('help-title'); if (ti) ti.textContent = t(m[0]);
  const bo = $('help-body'); if (bo) bo.textContent = t(m[1]);
  setHelpWarn('');
  if (dlg.showModal) { try { dlg.showModal(); } catch (e) { dlg.setAttribute('open', ''); } } else dlg.setAttribute('open', '');
}
function closeHelp() { const dlg = $('help'); if (!dlg) return; if (dlg.close) dlg.close(); else dlg.removeAttribute('open'); }
function clearLog() { logLines.length = 0; const el = $('log'); if (el) el.textContent = ''; logDiagnosticHeader(); log('log cleared'); }
function setTile(id, val) { const el = $(id); if (el) el.textContent = (val == null ? '-' : val); }
const RAW_TILE_IDS = ['t-f00', 't-f02', 't-f04', 't-f06', 't-f08', 't-f0a', 't-f0c', 't-f10', 't-f14', 't-flags'];
function resetTiles() { RAW_TILE_IDS.forEach(id => setTile(id, null)); }
function statusLabel(s) {
  const map = { disconnected: 'stDisconnected', connecting: 'stConnecting', connected: 'stConnected', 'no-service': 'stNoService', 'no-char': 'stNoChar' };
  return t(map[s] || 'stDisconnected') || s;
}
function setStatus(s) {
  const el = $('status'); if (el) { el.dataset.state = s; el.textContent = statusLabel(s); }
  const cb = $('btn-conn');
  if (cb) { const on = (s === 'connecting' || s === 'connected'); cb.textContent = on ? t('btnDisconnect') : t('btnConnect'); cb.dataset.act = on ? 'disconnect' : 'connect'; }
}
function setControlsEnabled(on) {
  const list = ['btn-toggle', 'speed-in', 'ekfv-in', 'btn-throttle-accel', 'btn-throttle-brake', 'btn-cruise-time', 'btn-shutdown-time', 'btn-service-km', 'btn-mileage-reset',
    'throttle-accel-in', 'throttle-brake-in', 'cruise-time-in', 'shutdown-time-in', 'service-km-in'];
  list.forEach(id => { const el = $(id); if (el) el.disabled = !on; });
  const liveCard = $('live-card'); if (liveCard) liveCard.hidden = !on;
  const moreCard = $('more-card'); if (moreCard) moreCard.hidden = !on;
}
function openSpeedValue() { const v = parseInt(($('speed-in') || {}).value, 10); return isNaN(v) ? 45 : v; }
function ekfvSpeedValue() { const v = parseInt(($('ekfv-in') || {}).value, 10); return isNaN(v) ? 20 : v; }
function updateToggleButton() { const b = $('btn-toggle'); if (!b) return; b.textContent = speedUnlocked ? t('btnLock') : t('btnUnlock'); }
function doSpeedToggle() {
  if (speedUnlocked) { cmdSetMaxSpeed(ekfvSpeedValue()); speedUnlocked = false; }
  else { cmdSetMaxSpeed(openSpeedValue()); speedUnlocked = true; }
  updateToggleButton();
}

// --------------------------- model selection (label only, no protocol branching) ---------------------------
function buildModelDropdown() {
  const sel = $('model-in'); if (!sel) return;
  sel.textContent = '';
  const auto = document.createElement('option'); auto.value = 'auto'; auto.setAttribute('data-t', 'modelAuto'); auto.textContent = t('modelAuto');
  sel.appendChild(auto);
  MODELS.forEach(([key, label]) => { const opt = document.createElement('option'); opt.value = key; opt.textContent = label; sel.appendChild(opt); });
  let saved = null;
  try { saved = localStorage.getItem(LS_MODEL); } catch (e) {}
  sel.value = (saved && (saved === 'auto' || MODELS.some(m => m[0] === saved))) ? saved : DEFAULT_MODEL;
}

// --------------------------- connect / disconnect ---------------------------
async function pickAndConnect() {
  if (!navigator.bluetooth) { log('Web Bluetooth not available. Use Bluefy (iOS) or Chrome/Edge.', 'log-err'); return; }
  try {
    log('showing all Bluetooth devices - pick your Apollo scooter. The real app recognizes a name starting with "hw", "apollo" or "phantom" (belegt: isHwBleName in the app\'s own JS bundle); an unmatched name is not necessarily wrong, the GATT service found on connect is the real check.');
    device = await navigator.bluetooth.requestDevice({ acceptAllDevices: true, optionalServices: ALL_SERVICES });
    log('selected: ' + (device.name || '(no name)') + ' [' + device.id + ']');
    const looksApollo = classifyApolloName(device.name);
    log(looksApollo ? 'name matches the app\'s own Apollo classifier.' : 'name does not match "hw"/"apollo"/"phantom" - connecting anyway, the GATT service decides.', looksApollo ? 'log-ok' : undefined);
    await connectGatt(device);
  } catch (e) { log('scan/connect cancelled: ' + e, 'log-err'); }
}

function charProps(c) { const p = c.properties || {}; return ['read', 'write', 'writeWithoutResponse', 'notify', 'indicate'].filter(k => p[k]).join(',') || '-'; }
async function scanAllDevicesDiagnostic() {
  if (!navigator.bluetooth) { log('Web Bluetooth not available. Use Bluefy (iOS) or Chrome (Android/desktop).', 'log-err'); return; }
  let dev = null;
  try {
    log('DIAG: showing ALL Bluetooth devices. Pick your scooter, even if the name looks wrong or missing.', 'log-ok');
    dev = await navigator.bluetooth.requestDevice({ acceptAllDevices: true, optionalServices: ALL_SERVICES });
  } catch (e) { log('DIAG cancelled: ' + e, 'log-err'); return; }
  log('DIAG selected: name="' + (dev.name || '(no name)') + '"  id=' + dev.id);
  log('DIAG classify (isHwBleName): ' + (classifyApolloName(dev.name) ? 'matches' : 'does not match'));
  try {
    log('DIAG: connecting to read the GATT services ...');
    const srv = await dev.gatt.connect();
    let svcs = [];
    try { svcs = await srv.getPrimaryServices(); } catch (e) { log('DIAG getPrimaryServices error: ' + e, 'log-err'); }
    if (!svcs || !svcs.length) log('DIAG: none of the known services is present (DATA F1F0, AT F2F0, OTA ...FE00).', 'log-err');
    else for (const s of svcs) {
      log('DIAG service ' + s.uuid, 'log-ok');
      try { const chs = await s.getCharacteristics(); for (const c of chs) log('DIAG   char ' + c.uuid + '  [' + charProps(c) + ']'); }
      catch (e) { log('DIAG   (characteristics unreadable: ' + e + ')'); }
    }
    try { dev.gatt.disconnect(); } catch (e) {}
    log('DIAG done. Copy the log and send it. For the full picture use nRF Connect on Android.', 'log-ok');
  } catch (e) { log('DIAG connect failed: ' + e, 'log-err'); }
}

async function connectGatt(dev) {
  if (connecting) { log('connect already in progress'); return; }
  connecting = true;
  try {
    if (device && device !== dev) { try { device.removeEventListener('gattserverdisconnected', onDisconnected); } catch (e) {} }
    device = dev;
    device.removeEventListener('gattserverdisconnected', onDisconnected);
    device.addEventListener('gattserverdisconnected', onDisconnected);
    setStatus('connecting');
    connected = false;
    server = await device.gatt.connect();
    const dataSvc = await server.getPrimaryService(GATT.data.service).catch(() => null);
    if (!dataSvc) { try { device.gatt.disconnect(); } catch (e) {} setStatus('no-service'); log('this device has no Apollo DATA service (F1F0) - it does not look like an Apollo scooter.', 'log-err'); return; }
    dataWrite = await dataSvc.getCharacteristic(GATT.data.write).catch(() => null);
    dataNotify = await dataSvc.getCharacteristic(GATT.data.notify).catch(() => null);
    if (!dataWrite || !dataNotify) { try { device.gatt.disconnect(); } catch (e) {} setStatus('no-char'); log('write/notify characteristic missing on the DATA service.', 'log-err'); return; }
    atWrite = null;
    const atSvc = await server.getPrimaryService(GATT.at.service).catch(() => null);
    if (atSvc) atWrite = await atSvc.getCharacteristic(GATT.at.write).catch(() => null);
    else log('note: AT/CMD service (F2F0) not found - PIN cannot be sent, some writes may be rejected.', 'log-err');
    await dataNotify.startNotifications();
    dataNotify.removeEventListener('characteristicvaluechanged', onCharacteristicValue);
    dataNotify.addEventListener('characteristicvaluechanged', onCharacteristicValue);
    connected = true;
    setControlsEnabled(true);
    const info = $('devinfo'); if (info) info.textContent = t('devPrefix') + ' ' + (device.name || '(no name)') + '  -  ' + t('devConnected');
    try { if (device.id) localStorage.setItem(LS_DEVICE, device.id); } catch (e) {}
    log('connected: ' + (device.name || '(no name)') + ' [' + device.id + ']', 'log-ok');
    log('DATA service ' + GATT.data.service + '  write=' + dataWrite.uuid + '  notify=' + dataNotify.uuid, 'log-ok');
    if (atWrite) log('AT service ' + GATT.at.service + '  write=' + atWrite.uuid, 'log-ok');
    setStatus('connected');
    await afterConnect();
  } catch (e) {
    setStatus('disconnected');
    log('connect failed: ' + e, 'log-err');
  } finally { connecting = false; }
}

// Post-connect: send the PIN (AT+PWD[pin]), then start an idle keep-alive (1000ms is our own choice, not belegt).
async function afterConnect() {
  stopKeep();
  const pin = ($('pin-in') && $('pin-in').value.trim()) || '';
  if (pin && atWrite) {
    try { const cmd = apolloPwdCommand(pin); await atWrite.writeValue(new TextEncoder().encode(cmd)); log('TX  ' + cmd + ' (AT write)', 'log-tx'); }
    catch (e) { log('AT+PWD failed: ' + e, 'log-err'); }
  }
  startKeep();
}
function stopKeep() { if (keepTimer) { clearInterval(keepTimer); keepTimer = null; } }
function startKeep() { stopKeep(); keepTimer = setInterval(() => { if (connected) writeFrame(apolloKeepAliveFrame()).catch(() => {}); }, 1000); }

function onDisconnected(ev) {
  if (ev && ev.target && ev.target !== device) return;
  connected = false; speedUnlocked = false; clearAcks(); stopKeep();
  setStatus('disconnected');
  setControlsEnabled(false); resetTiles();
  const info = $('devinfo'); if (info) info.textContent = '';
  log('disconnected.', 'log-err');
}
function disconnectBle() {
  const d = device;
  if (d) { try { d.removeEventListener('gattserverdisconnected', onDisconnected); } catch (e) {} }
  try { if (d && d.gatt && d.gatt.connected) d.gatt.disconnect(); } catch (e) {}
  device = null; server = null; dataWrite = null; dataNotify = null; atWrite = null;
  connected = false; clearAcks(); stopKeep();
  setStatus('disconnected'); setControlsEnabled(false); resetTiles();
  const info = $('devinfo'); if (info) info.textContent = '';
}

function onCharacteristicValue(ev) {
  try { const b = new Uint8Array(ev.target.value.buffer); log('RX  ' + bytesToHex(b), 'log-rx'); handleFrame(b); }
  catch (e) { log('RX parse error: ' + e, 'log-err'); }
}

// --------------------------- inbound dispatch + telemetry ---------------------------
const rdU16BE = (d, o) => ((d[o] << 8) | d[o + 1]) >>> 0;
const rdS16BE = (d, o) => { const v = rdU16BE(d, o); return v & 0x8000 ? v - 0x10000 : v; };
const rdU32BE = (d, o) => (((d[o] << 24) | (d[o + 1] << 16) | (d[o + 2] << 8) | d[o + 3]) >>> 0);

function handleFrame(b) {
  if (!b || b.length < 1) return;
  const head = b[0];
  if (head === 0xAB) { decodeMonitorFrame(b); return; }
  if (head === 0xA5) { log('  transmission-command echo (raw hex above).'); resolveAck('tran', bytesToHex(b)); return; }
  resolveAck('write', bytesToHex(b));
  log('  note: unrecognized/undecoded head 0x' + head.toString(16) + ' (raw hex above). See GUIDE for what is and is not decoded yet.');
}

// Decodes the 24-byte monitor frame (head 0xAB), belegt native 0x8e5f0: offset/width/sign/scale
// confirmed, field NAMES not - tiles are labelled by offset on purpose (see GUIDE).
function decodeMonitorFrame(b) {
  if (b.length < 24) { log('  monitor frame too short (' + b.length + ' bytes, need >= 24) - not decoded.'); return; }
  const f00 = rdS16BE(b, 0x00) / 10;
  const f02 = rdU16BE(b, 0x02);
  const f04 = rdS16BE(b, 0x04) / 10;
  const f06 = rdU16BE(b, 0x06) / 10;
  const f08 = rdS16BE(b, 0x08);
  const f0a = rdS16BE(b, 0x0a);
  const f0c = rdU32BE(b, 0x0c);
  const f10 = rdU32BE(b, 0x10);
  const f14 = rdS16BE(b, 0x14) / 10;
  const flags = ((b[0x16] << 8) | b[0x17]) & 0xFFFF;
  setTile('t-f00', f00.toFixed(1)); setTile('t-f02', String(f02)); setTile('t-f04', f04.toFixed(1)); setTile('t-f06', f06.toFixed(1));
  setTile('t-f08', String(f08)); setTile('t-f0a', String(f0a)); setTile('t-f0c', String(f0c)); setTile('t-f10', String(f10));
  setTile('t-f14', f14.toFixed(1)); setTile('t-flags', '0x' + flags.toString(16).padStart(4, '0'));
  log('  monitor: @0x00=' + f00.toFixed(1) + ' @0x02=' + f02 + ' @0x04=' + f04.toFixed(1) + ' @0x06=' + f06.toFixed(1) +
    ' @0x08=' + f08 + ' @0x0a=' + f0a + ' @0x0c=' + f0c + ' @0x10=' + f10 + ' @0x14=' + f14.toFixed(1) + ' flags=0x' + flags.toString(16), 'log-ok');
}

// --------------------------- writing frames + commands ---------------------------
async function writeFrame(bytes) {
  const wc = dataWrite;
  if (!wc) throw new Error('not connected');
  if (wc.writeValueWithResponse) return wc.writeValueWithResponse(bytes);
  if (wc.writeValueWithoutResponse) return wc.writeValueWithoutResponse(bytes);
  return wc.writeValue(bytes);
}

const ACK_TIMEOUT_MS = 3000;
const pendingAcks = new Map();
function armAck(key, label) {
  const prev = pendingAcks.get(key); if (prev) clearTimeout(prev.timer);
  const timer = setTimeout(() => { pendingAcks.delete(key); log('  no confirmation for "' + label + '" within ' + (ACK_TIMEOUT_MS / 1000) + 's (scooter sent no matching echo).', 'log-err'); }, ACK_TIMEOUT_MS);
  pendingAcks.set(key, { label, timer });
}
function resolveAck(key, echoHex) {
  const p = pendingAcks.get(key); if (!p) return false;
  clearTimeout(p.timer); pendingAcks.delete(key);
  log('  confirmed: scooter sent a reply after "' + p.label + '" (echo ' + echoHex + ').', 'log-ok');
  return true;
}
function clearAcks() { pendingAcks.forEach(p => clearTimeout(p.timer)); pendingAcks.clear(); }

async function transmit(frame, label, ackKey) {
  if (!connected || !dataWrite) { log('not connected', 'log-err'); return; }
  try {
    log('TX  ' + bytesToHex(frame) + '   (' + label + ')', 'log-tx');
    if (ackKey) armAck(ackKey, label);
    await writeFrame(frame);
    log('sent. note: an echo (if any) only means the controller received the write. Whether it took effect shows only in the live telemetry above.', 'log-ok');
  } catch (e) { log('send failed: ' + e, 'log-err'); }
}

function cmdWriteRegister(name, value, label) {
  const reg = REGISTERS[name]; if (!reg) return;
  const raw = Math.round(value * reg.factor);
  transmit(apolloWriteU16(reg.addr, raw), label + ' = ' + value + '  ->  register ' + reg.addr + ' (0x' + reg.addr.toString(16) + ') = ' + raw, 'write' + reg.addr);
}
function cmdSetMaxSpeed(kmh) {
  try { localStorage.setItem(LS_SPEED, String(kmh)); } catch (e) {}
  cmdWriteRegister('limitedSpeedValue', kmh, 'speed limit');
}
function cmdMileageReset() {
  transmit(apolloWriteU16(TOTAL_MILEAGE_RESET.addr, TOTAL_MILEAGE_RESET.value), 'total mileage reset (register 0, magic value ' + TOTAL_MILEAGE_RESET.value + ', belegt ApolloBleScootersSdk.java:726)', 'write0');
}

// Themed confirm for a risky write. Falls back to window.confirm if the dialog is missing.
function confirmRisky(name, onOk) {
  const dlg = $('confirm');
  if (!dlg || !dlg.showModal) { if (window.confirm(t('riskyText') + '\n\n' + name)) onOk(); return; }
  const body = $('confirm-body'); if (body) body.textContent = t('riskyText') + ' (' + name + ')';
  const ok = $('confirm-ok'), cancel = $('confirm-cancel'), cx = $('confirm-cancel-x');
  const close = () => { try { dlg.close(); } catch (e) { dlg.removeAttribute('open'); } ok.removeEventListener('click', okH); cancel.removeEventListener('click', close); if (cx) cx.removeEventListener('click', close); };
  const okH = () => { close(); onOk(); };
  ok.addEventListener('click', okH); cancel.addEventListener('click', close); if (cx) cx.addEventListener('click', close);
  try { dlg.showModal(); } catch (e) { dlg.setAttribute('open', ''); }
}

// --------------------------- language ---------------------------
let lang = 'de';
function table() { return (window.I18N && window.I18N[lang]) || {}; }
function t(key) { const v = table()[key]; return (typeof v === 'string') ? v : ''; }
function applyLang() {
  document.documentElement.lang = lang;
  document.querySelectorAll('[data-t]').forEach(n => { const v = t(n.getAttribute('data-t')); if (/[<&]/.test(v)) n.innerHTML = v; else n.textContent = v; });   // scan-ok: our own translation table
  { const el = $('link-guide'); if (el) el.href = docFile('GUIDE'); }
  { const el = $('link-readme'); if (el) el.href = docFile('README'); }
  { const el = $('link-license'); if (el) el.href = docFile('LICENSE'); }
  { const el = $('link-privacy'); if (el) el.href = docFile('PRIVACY'); }
  { const el = $('link-trademarks'); if (el) el.href = docFile('TRADEMARKS'); }
  { const el = $('langs'); if (el) el.setAttribute('aria-label', t('langGroup')); }
  updateToggleButton();
  { const dark = document.documentElement.getAttribute('data-theme') !== 'light'; const el = $('btn-theme'); if (el) { el.setAttribute('aria-label', t(dark ? 'themeToLight' : 'themeToDark')); el.title = el.getAttribute('aria-label'); } }
  { const el = $('build-ver'); if (el) el.textContent = t('buildLabel') + ' ' + BUILD; }
  document.querySelectorAll('#langs button').forEach(b => { b.setAttribute('aria-pressed', String(b.dataset.lang === lang)); });
  { const el = $('status'); setStatus(el ? el.dataset.state : 'disconnected'); }
}
function initLangSwitch() { document.querySelectorAll('#langs button').forEach(b => { b.addEventListener('click', () => { lang = b.dataset.lang; applyLang(); }); }); }

// --------------------------- theme ---------------------------
function applyTheme(dark) {
  document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
  const b = $('btn-theme');
  if (b) { b.innerHTML = dark ? '&#9728;' : '&#9790;'; b.setAttribute('aria-label', t(dark ? 'themeToLight' : 'themeToDark')); b.title = b.getAttribute('aria-label'); }   // scan-ok: a fixed character, not user input
  try { localStorage.setItem(LS_THEME, dark ? 'dark' : 'light'); } catch (e) {}
}
function initTheme() {
  let saved = null;
  try { saved = localStorage.getItem(LS_THEME); } catch (e) {}
  applyTheme(saved !== 'light');
  const b = $('btn-theme');
  if (b) b.addEventListener('click', () => { applyTheme(document.documentElement.getAttribute('data-theme') === 'light'); });
}

// --------------------------- document viewer ---------------------------
const DOC_TITLES = {
  'GUIDE.de.md': 'footGuide', 'GUIDE.en.md': 'footGuide',
  'PRIVACY.de.md': 'footPrivacy', 'PRIVACY.md': 'footPrivacy',
  'LICENSE.de.md': 'footLicense', 'LICENSE.md': 'footLicense',
  'TRADEMARKS.de.md': 'footTrademarks', 'TRADEMARKS.md': 'footTrademarks',
  'README.md': 'footReadme',
};
const escHtml = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const slug = s => s.toLowerCase().trim().replace(/[^\w\sÀ-ɏ-]/g, '').replace(/ /g, '-');
function mdToHtml(src) {
  const inline = s => escHtml(s)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (all, text, href) => {
      if (DOC_TITLES[href]) return `<a href="${href}" data-docfile="${href}">${text}</a>`;
      if (href.startsWith('#')) return `<a href="${href}" data-anchor="${href.slice(1)}">${text}</a>`;
      return `<a href="${href}" target="_blank" rel="noopener">${text}</a>`;
    });
  const lines = String(src).replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  let listKind = null, li = null, para = [], bq = [], inFence = false;
  const sink = () => (li ? li.parts : out);
  const flushPara = () => { if (para.length) { sink().push('<p>' + inline(para.join(' ')) + '</p>'); para = []; } };
  const flushBq = () => { if (bq.length) { sink().push('<blockquote><p>' + inline(bq.join(' ')) + '</p></blockquote>'); bq = []; } };
  const closeNested = () => { if (li && li.nested) { li.parts.push('</ul>'); li.nested = false; } };
  const closeLi = () => { if (!li) return; flushPara(); flushBq(); closeNested(); out.push('<li>' + li.parts.join('\n') + '</li>'); li = null; };
  const closeList = () => { closeLi(); if (listKind) { out.push('</' + listKind + '>'); listKind = null; } };
  const block = () => { flushPara(); flushBq(); closeList(); };
  const openList = kind => { flushPara(); flushBq(); if (listKind !== kind) { closeList(); out.push('<' + kind + '>'); listKind = kind; } else closeLi(); };
  const cells = l => l.replace(/^\||\|$/g, '').split('|').map(c => c.trim());
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const body = l.trim();
    const indented = /^ {2,}\S/.test(l);
    if (inFence) { if (body.startsWith('```')) { sink().push('</code></pre>'); inFence = false; } else sink().push(escHtml(l)); continue; }
    if (body.startsWith('```')) { if (li) { flushPara(); flushBq(); closeNested(); } else block(); sink().push('<pre><code>'); inFence = true; continue; }
    if (body === '') { if (li && /^ {2,}\S/.test(lines[i + 1] || '')) flushPara(); else block(); continue; }
    if (/^(-{3,}|\*{3,}|_{3,})\s*$/.test(body)) { block(); out.push('<hr>'); continue; }
    if (body.startsWith('|') && /^\|[\s:|-]+\|?\s*$/.test((lines[i + 1] || '').trim())) {
      if (li) { flushPara(); flushBq(); closeNested(); } else block();
      sink().push('<div class="doc-table"><table><thead><tr>' + cells(body).map(c => '<th>' + inline(c) + '</th>').join('') + '</tr></thead><tbody>');
      i++;
      while (i + 1 < lines.length && lines[i + 1].trim().startsWith('|')) sink().push('<tr>' + cells(lines[++i].trim()).map(c => '<td>' + inline(c) + '</td>').join('') + '</tr>');
      sink().push('</tbody></table></div>');
      continue;
    }
    let m;
    if ((m = body.match(/^(#{1,4})\s+(.*)$/))) { block(); const n = m[1].length; out.push(`<h${n} id="${slug(m[2])}">${inline(m[2])}</h${n}>`); continue; }
    if ((m = body.match(/^>\s?(.*)$/))) { if (li) { flushPara(); closeNested(); } else flushPara(); bq.push(m[1]); continue; }
    if (indented && li && (m = body.match(/^[-*]\s+(.*)$/))) { flushPara(); flushBq(); if (!li.nested) { li.parts.push('<ul class="nested">'); li.nested = true; } li.parts.push('<li>' + inline(m[1]) + '</li>'); continue; }
    if ((m = body.match(/^[-*]\s+(.*)$/)) && !indented) { openList('ul'); li = { parts: [inline(m[1])], nested: false }; continue; }
    if ((m = body.match(/^\d+\.\s+(.*)$/)) && !indented) { openList('ol'); li = { parts: [inline(m[1])], nested: false }; continue; }
    if (li && !indented) closeList();
    if (li) closeNested();
    flushBq();
    para.push(body);
  }
  if (inFence) sink().push('</code></pre>');
  block();
  return out.join('\n').replace(/<pre><code>\n/g, '<pre><code>');
}
const docCache = {};
const docFile = name => {
  if (name === 'GUIDE') return `GUIDE.${lang}.md`;
  if (name === 'README') return 'README.md';
  return lang === 'de' ? `${name}.de.md` : `${name}.md`;
};
function openDoc(name, anchor, titleKey) { openDocFile(docFile(name), anchor, titleKey); }
function openDocFile(file, anchor, titleKey) {
  const dlg = $('doc'), body = $('doc-body');
  if (!dlg || !body) return;
  const mark = (lang === 'de' && !file.includes('.de.') && file !== 'README.md') ? ' ' + t('docEnglish') : '';
  $('doc-title').textContent = (t(titleKey || DOC_TITLES[file] || '') || file) + mark;
  if (typeof dlg.showModal === 'function') dlg.showModal();
  const show = html => {
    body.innerHTML = html;   // scan-ok: markdown of our own documents, rendered by mdToHtml which escapes first
    const h1 = body.querySelector('h1');
    if (h1) { $('doc-title').textContent = h1.textContent.trim() + mark; h1.remove(); }
    body.scrollTop = 0;
    if (!anchor) return;
    const target = body.querySelector('#' + (window.CSS && CSS.escape ? CSS.escape(anchor) : anchor));
    if (target) body.scrollTop = target.offsetTop - body.offsetTop;
  };
  if (docCache[file]) { show(docCache[file]); return; }
  body.innerHTML = '<p>' + escHtml(t('docLoading')) + '</p>';   // scan-ok: escaped
  fetch(file + '?v=' + BUILD)
    .then(r => { if (!r.ok) throw new Error(r.status + ' ' + r.statusText); return r.text(); })
    .then(txt => { docCache[file] = mdToHtml(txt); show(docCache[file]); })
    .catch(e => { body.innerHTML = '<p>' + escHtml(t('docFail')) + '</p><pre class="err">' + escHtml(file + ': ' + (e && e.message ? e.message : e)) + '</pre>'; });   // scan-ok: escaped
}
function wireDocViewer() {
  document.addEventListener('click', e => {
    if (!e.target.closest) return;
    const jump = e.target.closest('[data-anchor]');
    if (jump) { e.preventDefault(); const body = $('doc-body'); const target = body && body.querySelector('#' + CSS.escape(jump.getAttribute('data-anchor'))); if (target) body.scrollTop = target.offsetTop - body.offsetTop; return; }
    const disc = e.target.closest('[data-open-disclaimer]');
    if (disc) { e.preventDefault(); openHelp('disclaimer'); return; }
    const a = e.target.closest('[data-doc], [data-docfile]');
    if (!a) return;
    e.preventDefault();
    const anchor = a.getAttribute('data-doc-anchor') || '';
    const file = a.getAttribute('data-docfile');
    const titleKey = a.getAttribute('data-t') || '';
    if (file) openDocFile(file, anchor, titleKey); else openDoc(a.getAttribute('data-doc'), anchor, titleKey);
  });
  ['doc-x', 'doc-close'].forEach(id => { const b = $(id); if (b) b.addEventListener('click', () => { const d = $('doc'); if (d) d.close(); }); });
}

// --------------------------- init ---------------------------
window.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('.help-btn').forEach(btn => btn.addEventListener('click', () => openHelp(btn.getAttribute('data-help'))));
  ['help-x', 'help-close'].forEach(id => { const b = $(id); if (b) b.addEventListener('click', closeHelp); });
  { const b = $('link-disclaimer'); if (b) b.addEventListener('click', e => { e.preventDefault(); openHelp('disclaimer'); }); }
  logDiagnosticHeader();
  initLangSwitch();
  initTheme();
  wireDocViewer();
  buildModelDropdown();

  { try { const s = localStorage.getItem(LS_SPEED); if (s && $('speed-in')) $('speed-in').value = s; } catch (e) {} }
  { try { const k = localStorage.getItem(LS_EKFV); if (k && $('ekfv-in')) $('ekfv-in').value = k; } catch (e) {} }
  { try { const pin = localStorage.getItem(LS_PIN); if (pin && $('pin-in')) $('pin-in').value = pin; } catch (e) {} }
  applyLang();

  log('protocol self-test (frame builders vs the specification read out of Apollo\'s own app/library): ' + (PROTO_OK ? 'OK' : 'FAILED'), PROTO_OK ? 'log-ok' : 'log-err');

  $('btn-conn').addEventListener('click', () => { if ($('btn-conn').dataset.act === 'disconnect') disconnectBle(); else pickAndConnect(); });
  { const sel = $('model-in'); if (sel) sel.addEventListener('change', () => { try { localStorage.setItem(LS_MODEL, sel.value); } catch (e) {} }); }
  $('btn-toggle').addEventListener('click', doSpeedToggle);
  { const s = $('speed-in'); if (s) s.addEventListener('change', () => { try { localStorage.setItem(LS_SPEED, s.value); } catch (e) {} }); }
  { const e2 = $('ekfv-in'); if (e2) e2.addEventListener('change', () => { try { localStorage.setItem(LS_EKFV, e2.value); } catch (er) {} }); }
  { const pin = $('pin-in'); if (pin) pin.addEventListener('change', () => { try { localStorage.setItem(LS_PIN, pin.value.trim()); } catch (e) {} }); }
  { const b = $('btn-throttle-accel'); if (b) b.addEventListener('click', () => { const v = parseFloat(($('throttle-accel-in') || {}).value); if (!isNaN(v)) cmdWriteRegister('acceleratedThrottleResponse', v, t('set_throttleAccel')); }); }
  { const b = $('btn-throttle-brake'); if (b) b.addEventListener('click', () => { const v = parseFloat(($('throttle-brake-in') || {}).value); if (!isNaN(v)) cmdWriteRegister('acceleratorBrakeResponse', v, t('set_throttleBrake')); }); }
  { const b = $('btn-cruise-time'); if (b) b.addEventListener('click', () => { const v = parseInt(($('cruise-time-in') || {}).value, 10); if (!isNaN(v)) cmdWriteRegister('cruiseStartTime', v, t('set_cruiseTime')); }); }
  { const b = $('btn-shutdown-time'); if (b) b.addEventListener('click', () => { const v = parseInt(($('shutdown-time-in') || {}).value, 10); if (!isNaN(v)) cmdWriteRegister('shutdownTime', v, t('set_shutdownTime')); }); }
  { const b = $('btn-service-km'); if (b) b.addEventListener('click', () => { const v = parseInt(($('service-km-in') || {}).value, 10); if (!isNaN(v)) cmdWriteRegister('serviceMileage', v, t('set_serviceKm')); }); }
  { const b = $('btn-mileage-reset'); if (b) b.addEventListener('click', () => confirmRisky(t('set_mileageReset'), cmdMileageReset)); }
  { const b = $('btn-copy-log'); if (b) b.addEventListener('click', copyLog); }
  { const b = $('btn-diag'); if (b) b.addEventListener('click', scanAllDevicesDiagnostic); }
  { const b = $('btn-clear-log'); if (b) b.addEventListener('click', clearLog); }

  setControlsEnabled(false);
  if (!navigator.bluetooth) log('Web Bluetooth not available. On iOS use the Bluefy browser.', 'log-err');
});
