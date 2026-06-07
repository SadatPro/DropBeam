
// ══════════════════════════════════════════
// CONFIGURATION & STATE
// ══════════════════════════════════════════
const MAX_SIZE = 500 * 1024 * 1024; // 500MB
const CHUNK_SIZE = 64 * 1024; // 64KB chunks for max cross-browser compatibility
const BUFFER_THRESHOLD = 1 * 1024 * 1024; // 1MB buffer to prevent mobile memory overflow
const CIRC = 440; // SVG circle circumference

const ICE_CONFIG = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun.cloudflare.com:3478' },
    { urls: 'stun:global.stun.twilio.com:3478' },
    { urls: 'turn:global.relay.metered.ca:80', username: 'openrelayproject', credential: 'openrelayproject' },
    { urls: 'turn:global.relay.metered.ca:443', username: 'openrelayproject', credential: 'openrelayproject' }
  ]
};

let myPeer = null, receiverPeer = null, activeConn = null;
let selectedFiles = [];
let receivedFiles = [], receivedBatchMeta = null, totalBatchSize = 0, totalBatchReceived = 0;
let currentFileChunks = [], currentFileMeta = null;
let qrVisible = false, qrGenerated = false;
let currentLang = 'javascript';
let receivedCodeData = null;
let html5QrCode = null;
let supportQrGenerated = false;

// ── UTILS ─────────────────────────────────────────────
function fmtBytes(b){if(b<1024)return b+' B';if(b<1048576)return (b/1024).toFixed(1)+' KB';if(b<1073741824)return (b/1048576).toFixed(2)+' MB';return (b/1073741824).toFixed(2)+' GB';}
function fmtSpeed(bps){if(bps<1024)return bps.toFixed(0)+' B/s';if(bps<1048576)return (bps/1024).toFixed(1)+' KB/s';return (bps/1048576).toFixed(2)+' MB/s';}
function fmtEta(s){if(!isFinite(s)||s<0)return '—';if(s<60)return Math.ceil(s)+'s';return Math.floor(s/60)+'m '+Math.ceil(s%60)+'s';}
function genCode(){const c='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';return Array.from({length:6},()=>c[Math.floor(Math.random()*c.length)]).join('');}
function setRing(id, pct){
  const el = document.getElementById(id);
  if(el) el.style.strokeDashoffset = CIRC - (pct/100)*CIRC;
}

// ── UI TAB MANAGEMENT ─────────────────────────────────
function switchTab(t) {
  ['send','receive','code-send','code-recv'].forEach(id => {
    document.querySelector(`.tab-bar .tab:nth-child(${['send','receive','code-send','code-recv'].indexOf(id)+1})`).classList.toggle('active', id===t);
    document.getElementById('panel-'+id).classList.toggle('active', id===t);
  });
}

// ── GLOBAL DRAG & DROP ────────────────────────────────
const dz = document.getElementById('drop-zone');
window.addEventListener('dragover', e => { e.preventDefault(); if(document.getElementById('panel-send').classList.contains('active')) dz.classList.add('dragover'); });
window.addEventListener('dragleave', e => { if(e.target === document.documentElement || e.relatedTarget === null) dz.classList.remove('dragover'); });
window.addEventListener('drop', e => { e.preventDefault(); dz.classList.remove('dragover'); if(e.dataTransfer.files.length && document.getElementById('panel-send').classList.contains('active')) handleFileSelect(e.dataTransfer.files); });

function handleFileSelect(files){
  if(!files || files.length === 0) return;
  const filesArray = files.length !== undefined ? Array.from(files) : [files];
  
  for (const file of filesArray) {
    if (file.size > MAX_SIZE) {
      alert(`File "${file.name}" is too large. Max size is ${fmtBytes(MAX_SIZE)}.`);
      continue;
    }
    if (selectedFiles.some(f => f.name === file.name && f.size === file.size)) {
      continue;
    }
    selectedFiles.push(file);
  }
  
  updateFilePreviewList();
  cancelTransfer();
}

function updateFilePreviewList() {
  const container = document.getElementById('file-preview-container');
  const list = document.getElementById('preview-list');
  const countEl = document.getElementById('summary-count');
  const sizeEl = document.getElementById('summary-size');
  
  if (selectedFiles.length === 0) {
    container.classList.add('hidden');
    document.getElementById('send-action-card').classList.add('hidden');
    return;
  }
  
  container.classList.remove('hidden');
  document.getElementById('send-action-card').classList.remove('hidden');
  
  list.innerHTML = '';
  let totalSize = 0;
  
  selectedFiles.forEach((file, index) => {
    totalSize += file.size;
    const row = document.createElement('div');
    row.className = 'file-preview-row';
    row.style.padding = '10px 16px';
    row.style.borderRadius = 'var(--radius-sm)';
    row.style.marginTop = '0';
    row.innerHTML = `
      <div class="md-card-header-icon" style="background:var(--primary-light); box-shadow: 0 0 10px rgba(0,229,255,0.1); width: 32px; height: 32px; font-size: 16px;"><span class="material-icons-round" style="font-size:16px">insert_drive_file</span></div>
      <div class="file-info" style="margin-left: 10px; text-align: left;">
        <div class="file-name" style="font-size: 14px; max-width: 220px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${file.name}</div>
        <div class="file-size" style="font-size: 11px; margin-top: 2px;">${fmtBytes(file.size)}</div>
      </div>
      <button class="file-remove" style="width: 28px; height: 28px; font-size: 14px;" onclick="removeSelectedFile(${index})" title="Remove file"><span class="material-icons-round" style="font-size:14px">close</span></button>
    `;
    list.appendChild(row);
  });
  
  countEl.textContent = selectedFiles.length;
  sizeEl.textContent = fmtBytes(totalSize);
}

function removeSelectedFile(index) {
  selectedFiles.splice(index, 1);
  updateFilePreviewList();
  cancelTransfer();
}

function clearFile(){
  selectedFiles = [];
  updateFilePreviewList();
  cancelTransfer();
  document.getElementById('file-input').value = '';
}

// ── QR & COPY LINKS ───────────────────────────────────
function toggleQR(){
  qrVisible = !qrVisible;
  document.getElementById('qr-section').classList.toggle('hidden', !qrVisible);
}
function generateQR(code){
  if(qrGenerated) return; qrGenerated = true;
  const c = document.getElementById('qr-code'); c.innerHTML = '';
  const url = window.location.href.split('?')[0] + '?code=' + code;
  new QRCode(c, { text: url, width: 180, height: 180, colorDark: '#000000', colorLight: '#ffffff', correctLevel: QRCode.CorrectLevel.M });
}
function copyValue(srcId, btnId){
  navigator.clipboard.writeText(document.getElementById(srcId).textContent).catch(()=>{});
  const btn = document.getElementById(btnId);
  const orig = btn.innerHTML;
  btn.innerHTML = '<span class="material-icons-round">check</span> COPIED'; btn.classList.add('copied');
  setTimeout(() => { btn.innerHTML = orig; btn.classList.remove('copied'); }, 2000);
}
function copyShareLink(btnId, isCodeTab=false) {
  const codeId = isCodeTab ? 'my-code-share' : 'my-code';
  const url = window.location.href.split('?')[0] + '?code=' + document.getElementById(codeId).textContent + (isCodeTab ? '&tab=code' : '');
  navigator.clipboard.writeText(url).catch(()=>{});
  const btn = document.getElementById(btnId);
  const orig = btn.innerHTML;
  btn.innerHTML = '<span class="material-icons-round">check</span> LINK COPIED'; btn.classList.add('copied');
  setTimeout(() => { btn.innerHTML = orig; btn.classList.remove('copied'); }, 2000);
}

// ── PEER FACTORY ──────────────────────────────────────
function initPeer() {
  return new Promise((resolve, reject) => {
    const code = genCode();
    const peer = new Peer(code, { debug: 0, config: ICE_CONFIG, pingInterval: 5000 });
    peer.on('open', () => {
      peer.on('disconnected', () => { /* Handle disconnect */ });
      resolve(peer);
    });
    peer.on('error', err => {
      if (err.type === 'unavailable-id') { peer.destroy(); initPeer().then(resolve).catch(reject); }
      else reject(err);
    });
  });
}

function cancelTransfer() {
  if (myPeer) { myPeer.destroy(); myPeer = null; }
  if (receiverPeer) { receiverPeer.destroy(); receiverPeer = null; }
  activeConn = null;
  // Reset UI Send
  const sendStartBtn = document.getElementById('send-start-btn');
  sendStartBtn.disabled = false;
  sendStartBtn.className = 'md-btn md-btn-filled md-btn-full';
  sendStartBtn.innerHTML = '<span class="material-icons-round">rocket_launch</span> GENERATE SYNC LINK';
  document.getElementById('share-active-area').classList.add('hidden');
  document.getElementById('send-viz').classList.add('hidden');
  document.getElementById('send-status-row').className = 'md-status info';
  document.getElementById('send-status-text').textContent = 'Waiting for receiver to connect…';
  qrGenerated = false;
  // Reset UI Recv
  document.getElementById('recv-file-card').classList.add('hidden');
  document.getElementById('receive-status').classList.add('hidden');
  document.getElementById('recv-success').classList.remove('visible');
  
  // Clear receiver lists
  document.getElementById('recv-files-list').innerHTML = '';
  document.getElementById('recv-files-list').classList.add('hidden');
  document.getElementById('recv-single-save-btn').classList.add('hidden');
  
  setRing('send-ring', 0);
  setRing('recv-ring', 0);
  document.getElementById('send-pct').textContent = '0%';
  document.getElementById('recv-pct').textContent = '0%';
  document.getElementById('send-lbl').textContent = 'UPLOADING';
  document.getElementById('recv-lbl').textContent = 'DOWNLOADING';
}

// ── DATA STREAM PARTICLES ─────────────────────────────
function startDataStream(canvasId, mode) {
  const canvas = document.getElementById(canvasId); if(!canvas)return()=>{};
  const ctx = canvas.getContext('2d'); let pts=[], raf, alive=true;
  canvas.width = canvas.offsetWidth; canvas.height = canvas.offsetHeight; canvas.classList.add('live');
  
  function spawn() {
    const cx = canvas.width / 2; const cy = canvas.height / 2;
    const angle = Math.random() * Math.PI * 2;
    const radius = Math.max(cx, cy) + 50; // spawn beyond edge
    
    if (mode === 'send') {
      // Spawn at edges, move towards center hub
      pts.push({
        x: cx + Math.cos(angle) * radius, y: cy + Math.sin(angle) * radius,
        tx: cx + (Math.random()-0.5)*40, ty: cy + (Math.random()-0.5)*40, // slight offset from exact center
        r: 1.5 + Math.random() * 2.5, alpha: 0, 
        speed: 0.02 + Math.random() * 0.04
      });
    } else {
      // Spawn near center, move outwards
      pts.push({
        x: cx + (Math.random()-0.5)*40, y: cy + (Math.random()-0.5)*40,
        tx: cx + Math.cos(angle) * radius, ty: cy + Math.sin(angle) * radius,
        r: 1.5 + Math.random() * 2.5, alpha: 0,
        speed: 0.01 + Math.random() * 0.03
      });
    }
  }

  function frame() {
    if(!alive)return; raf = requestAnimationFrame(frame); ctx.clearRect(0,0,canvas.width,canvas.height);
    if(Math.random() < 0.8) spawn();
    
    for(let i = pts.length - 1; i >= 0; i--) {
      const p = pts[i];
      p.x += (p.tx - p.x) * p.speed;
      p.y += (p.ty - p.y) * p.speed;
      
      const dist = Math.hypot(p.tx - p.x, p.ty - p.y);
      if(mode === 'send') {
        if(dist > 100) p.alpha = Math.min(0.8, p.alpha + 0.05); // fade in
        if(dist < 40) p.alpha -= 0.1; // fade out near center
      } else {
        if(dist > Math.max(canvas.width, canvas.height)/2 - 50) p.alpha -= 0.05; // fade out near edge
        else p.alpha = Math.min(0.8, p.alpha + 0.1); // fade in near center
      }
      
      if(p.alpha <= 0 && dist < 100) { pts.splice(i, 1); continue; } // Remove if fully faded and close to target
      
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI*2);
      ctx.fillStyle = `rgba(0, 229, 255, ${Math.max(0, p.alpha)})`;
      ctx.shadowBlur = 10; ctx.shadowColor = '#00E5FF'; ctx.fill();
    }
  }
  frame();
  return ()=>{ alive=false; canvas.classList.remove('live'); cancelAnimationFrame(raf); ctx.clearRect(0,0,canvas.width,canvas.height); };
}


// ── SEND FILE FLOW ────────────────────────────────────
async function startSend(){
  if(selectedFiles.length === 0) return;
  const btn = document.getElementById('send-start-btn');
  btn.disabled = true; btn.innerHTML = '<div class="logo-spinner"></div> PREPARING...';
  
  try { myPeer = await initPeer(); }
  catch(e){ btn.disabled = false; btn.innerHTML = '<span class="material-icons-round">rocket_launch</span> GENERATE SYNC LINK'; alert('Connection failed. Check network.'); return; }
  
  const id = myPeer.id;
  document.getElementById('my-code').textContent = id;
  btn.classList.add('hidden');
  document.getElementById('share-active-area').classList.remove('hidden');
  generateQR(id);
  
  myPeer.on('connection', conn => {
    activeConn = conn;
    if (conn.peerConnection) {
      conn.peerConnection.oniceconnectionstatechange = () => {
        const state = conn.peerConnection.iceConnectionState;
        if (state === 'checking') setSendStatus('info', 'Establishing secure route...');
        if (state === 'failed' || state === 'disconnected') setSendStatus('error', 'Connection lost. Try again.');
      };
    }
    conn.on('open', () => { 
      document.getElementById('send-status-row').classList.add('hidden');
      document.getElementById('send-viz').classList.remove('hidden');
      sendInChunks(conn); 
    });
    conn.on('error', () => setSendStatus('error','Connection error.'));
  });
}

function setSendStatus(type, text){
  const row = document.getElementById('send-status-row'); 
  row.className = 'md-status ' + type;
  row.innerHTML = type === 'info' ? `<div class="logo-spinner"></div><span>${text}</span>` : `<div class="status-dot"></div><span>${text}</span>`;
  row.classList.remove('hidden');
}

function sendInChunks(conn){
  const files = selectedFiles;
  let fileIndex = 0;
  const totalSize = files.reduce((acc, f) => acc + f.size, 0);
  let totalSent = 0;
  
  let lastTime = Date.now();
  let lastTotalSent = 0;
  const stopStream = startDataStream('send-canvas', 'send');
  
  conn.send({
    type: 'batch-meta', count: files.length, totalSize: totalSize,
    files: files.map(f => ({ name: f.name, size: f.size, mime: f.type }))
  });
  
  let reader = null;
  
  function startNextFile() {
    if (fileIndex >= files.length) {
      conn.send({type:'batch-done'});
      finishSendBatch(stopStream, totalSize);
      return;
    }
    const file = files[fileIndex];
    const useComp = typeof CompressionStream !== 'undefined';
    
    conn.send({
      type: 'file-start', index: fileIndex, name: file.name,
      size: file.size, mime: file.type, compressed: useComp
    });
    
    let stream = file.stream();
    if (useComp) stream = stream.pipeThrough(new CompressionStream('deflate'));
    reader = stream.getReader();
    sendStreamChunk();
  }
  
  async function sendStreamChunk() {
    if(!activeConn || !activeConn.open) return;
    try {
      const { done, value } = await reader.read();
      if (done) {
        conn.send({type:'file-end', index: fileIndex});
        fileIndex++;
        setTimeout(startNextFile, 50);
        return;
      }
      
      let offset = 0;
      while (offset < value.length) {
        const slice = value.slice(offset, offset + CHUNK_SIZE);
        conn.send({type:'chunk', data: slice.buffer});
        offset += CHUNK_SIZE;
        totalSent += slice.byteLength;
      }
      
      const now = Date.now(), iS = (now - lastTime)/1000;
      if (iS >= 0.5) {
        const iB = totalSent - lastTotalSent;
        const spd = iS > 0 ? iB/iS : 0, rem = totalSize - totalSent, eta = spd > 0 ? rem/spd : Infinity;
        const pct = Math.min(100, Math.round((totalSent/totalSize)*100));
        setRing('send-ring', pct);
        document.getElementById('send-pct').textContent = pct + '%';
        document.getElementById('send-speed').textContent = fmtSpeed(spd);
        document.getElementById('send-sent').textContent = fmtBytes(totalSent);
        document.getElementById('send-eta').textContent = fmtEta(eta);
        lastTotalSent = totalSent; lastTime = now;
      } else {
        const pct = Math.min(100, Math.round((totalSent/totalSize)*100));
        setRing('send-ring', pct);
        document.getElementById('send-pct').textContent = pct + '%';
        document.getElementById('send-sent').textContent = fmtBytes(totalSent);
      }
      
      if(conn.dataChannel && conn.dataChannel.bufferedAmount > BUFFER_THRESHOLD) {
        setTimeout(sendStreamChunk, 50); 
      } else {
        sendStreamChunk(); 
      }
    } catch(err) {
      console.error('Send stream error:', err);
    }
  }
  
  startNextFile();
}

function finishSendBatch(stopStream, totalSize){
  stopStream(); setRing('send-ring', 100);
  document.getElementById('send-pct').textContent = '100%'; document.getElementById('send-lbl').textContent = 'DONE';
  document.getElementById('send-eta').textContent = '0s';
  document.getElementById('send-cancel-btn').classList.add('hidden');
  document.getElementById('send-stats').classList.add('hidden'); 
  document.getElementById('send-viz').querySelector('.hub-container').classList.add('hidden');
  document.getElementById('send-success').classList.add('visible');
  document.getElementById('send-done-meta').textContent = selectedFiles.length + ' files · ' + fmtBytes(totalSize);
}

// ── RECEIVE FILE FLOW ─────────────────────────────────
function connectToSender(){
  const code = document.getElementById('receive-code').value.trim().toUpperCase();
  if(!code || code.length < 6){ setRecvStatus('warn','Enter a valid 6-digit code.'); return; }
  setRecvStatus('info','Connecting securely…');
  
  if(receiverPeer) receiverPeer.destroy();
  receiverPeer = new Peer({ debug: 0, config: ICE_CONFIG, pingInterval: 5000 });
  
  receiverPeer.on('open', () => {
    const conn = receiverPeer.connect(code, { reliable: true });
    activeConn = conn;
    
    if (conn.peerConnection) {
      conn.peerConnection.oniceconnectionstatechange = () => {
        const state = conn.peerConnection.iceConnectionState;
        if (state === 'checking') setRecvStatus('info', 'Negotiating P2P route…');
        if (state === 'failed' || state === 'disconnected') setRecvStatus('error', 'Connection failed. Try again.');
      };
    }
    conn.on('open', () => {
      document.getElementById('receive-status').classList.add('hidden');
      document.getElementById('recv-file-card').classList.remove('hidden');
      listenForFile(conn);
    });
    conn.on('error', () => setRecvStatus('error','Connection failed. Check code.'));
    setTimeout(()=>{ if(!conn.open) setRecvStatus('error','Could not reach sender. Timeout.'); }, 60000);
  });
  receiverPeer.on('error', err => setRecvStatus('error', 'Network error.'));
}

function setRecvStatus(type, text){ 
  const el = document.getElementById('receive-status'); el.className = 'md-status ' + type; 
  el.innerHTML = type === 'info' ? `<div class="logo-spinner"></div><span>${text}</span>` : `<div class="status-dot"></div><span>${text}</span>`; 
  el.classList.remove('hidden'); 
}

function listenForFile(conn){
  receivedFiles = [];
  currentFileChunks = [];
  totalBatchReceived = 0;
  receivedBatchMeta = null;
  currentFileMeta = null;
  
  let lastTime = Date.now(), lastRcv = 0;
  const stopStream = startDataStream('recv-canvas', 'recv');
  
  let filesProcessed = 0;
  let batchDoneReceived = false;

  async function processReceivedFile(meta, chunks, cb) {
    try {
      let blob = new Blob(chunks, { type: meta.mime || 'application/octet-stream' });
      if (meta.compressed && typeof DecompressionStream !== 'undefined') {
        const ds = new DecompressionStream('deflate');
        const decompressedStream = blob.stream().pipeThrough(ds);
        blob = await new Response(decompressedStream).blob();
      }
      const url = URL.createObjectURL(blob);
      receivedFiles.push({ name: meta.name, size: meta.size, mime: meta.mime, blob: blob, url: url });
      filesProcessed++;
      if(cb) cb(); else checkFinish();
    } catch(e) { console.error('Decompression err:', e); filesProcessed++; checkFinish(); }
  }

  function checkFinish() {
    if (batchDoneReceived && filesProcessed === (receivedBatchMeta ? receivedBatchMeta.count : 1)) {
      finishReceiveBatch(stopStream);
    }
  }

  conn.on('data', msg => {
    if (msg.type === 'batch-meta') {
      receivedBatchMeta = msg;
      totalBatchSize = msg.totalSize;
      document.getElementById('recv-lbl').textContent = 'DOWNLOADING';
    } 
    else if (msg.type === 'file-start') {
      currentFileMeta = msg;
      currentFileChunks = [];
    } 
    else if (msg.type === 'chunk') {
      currentFileChunks.push(msg.data);
      totalBatchReceived += msg.data.byteLength;
      
      const targetSize = receivedBatchMeta ? totalBatchSize : (currentFileMeta ? currentFileMeta.size : 1);
      const now = Date.now(), iS = (now - lastTime)/1000;
      if (iS >= 0.5) {
        const iB = totalBatchReceived - lastRcv;
        const spd = iS > 0 ? iB/iS : 0, rem = targetSize - totalBatchReceived, eta = spd > 0 ? rem/spd : Infinity;
        const pct = Math.min(100, Math.round((totalBatchReceived / targetSize) * 100));
        
        setRing('recv-ring', pct);
        document.getElementById('recv-pct').textContent = pct + '%';
        document.getElementById('recv-speed').textContent = fmtSpeed(spd);
        document.getElementById('recv-got').textContent = fmtBytes(totalBatchReceived);
        document.getElementById('recv-eta').textContent = fmtEta(eta);
        
        lastRcv = totalBatchReceived;
        lastTime = now;
      } else {
        const pct = Math.min(100, Math.round((totalBatchReceived / targetSize) * 100));
        setRing('recv-ring', pct);
        document.getElementById('recv-pct').textContent = pct + '%';
        document.getElementById('recv-got').textContent = fmtBytes(totalBatchReceived);
      }
    } 
    else if (msg.type === 'file-end') {
      if (currentFileMeta) {
        processReceivedFile(currentFileMeta, currentFileChunks);
      }
    } 
    else if (msg.type === 'batch-done') {
      batchDoneReceived = true;
      checkFinish();
    }
    // Backward compatibility for old single-file senders
    else if (msg.type === 'meta') {
      receivedBatchMeta = { count: 1, totalSize: msg.size, files: [msg] };
      totalBatchSize = msg.size;
      currentFileMeta = msg;
      currentFileChunks = [];
    } 
    else if (msg.type === 'done') {
      batchDoneReceived = true;
      if (currentFileMeta) {
        processReceivedFile(currentFileMeta, currentFileChunks);
      } else {
        checkFinish();
      }
    }
  });
  
  conn.on('close', () => {
    if (totalBatchReceived >= totalBatchSize && receivedFiles.length > 0) {
      batchDoneReceived = true;
      checkFinish();
    }
  });
}

function finishReceiveBatch(stopStream){
  stopStream(); setRing('recv-ring', 100);
  document.getElementById('recv-pct').textContent = '100%'; document.getElementById('recv-lbl').textContent = 'DONE';
  document.getElementById('recv-eta').textContent = '0s';
  document.getElementById('recv-cancel-btn').classList.add('hidden');
  document.getElementById('recv-stats').classList.add('hidden');
  document.getElementById('recv-ring-container').classList.add('hidden');
  
  const filesListEl = document.getElementById('recv-files-list');
  filesListEl.innerHTML = '';
  
  if (receivedFiles.length === 1) {
    document.getElementById('recv-done-name').textContent = receivedFiles[0].name;
    document.getElementById('recv-done-meta').textContent = fmtBytes(receivedFiles[0].size);
    document.getElementById('recv-single-save-btn').classList.remove('hidden');
    filesListEl.classList.add('hidden');
  } else {
    document.getElementById('recv-done-name').textContent = 'Sync Complete!';
    document.getElementById('recv-done-meta').textContent = receivedFiles.length + ' files received · ' + fmtBytes(totalBatchSize);
    document.getElementById('recv-single-save-btn').classList.add('hidden');
    filesListEl.classList.remove('hidden');
    
    receivedFiles.forEach((file, index) => {
      const row = document.createElement('div');
      row.className = 'file-preview-row';
      row.style.padding = '10px 16px';
      row.style.borderRadius = 'var(--radius-sm)';
      row.style.marginTop = '0';
      row.style.background = 'rgba(255, 255, 255, 0.03)';
      row.style.border = '1px solid rgba(255, 255, 255, 0.05)';
      row.innerHTML = `
        <div class="md-card-header-icon" style="background:var(--primary-light); box-shadow: 0 0 10px rgba(0,229,255,0.1); width: 32px; height: 32px; font-size: 16px;"><span class="material-icons-round" style="font-size:16px">insert_drive_file</span></div>
        <div class="file-info" style="margin-left: 10px; text-align: left;">
          <div class="file-name" style="font-size: 14px; max-width: 180px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${file.name}</div>
          <div class="file-size" style="font-size: 11px; margin-top: 2px;">${fmtBytes(file.size)}</div>
        </div>
        <button class="md-btn md-btn-filled" style="padding: 0 14px; height: 32px; font-size: 12px; border-radius: var(--radius-sm);" onclick="downloadBatchFile(${index})">
          <span class="material-icons-round" style="font-size:14px">save_alt</span> SAVE
        </button>
      `;
      filesListEl.appendChild(row);
    });
  }
  
  document.getElementById('recv-success').classList.add('visible');
}

function downloadFile(){
  if(!receivedFiles.length) return;
  const file = receivedFiles[0];
  const a = document.createElement('a'); a.href = file.url; a.download = file.name; a.click();
}

function downloadBatchFile(index) {
  const file = receivedFiles[index];
  if (!file) return;
  const a = document.createElement('a');
  a.href = file.url;
  a.download = file.name;
  a.click();
}

// ── HTML5-QRCODE SCANNER ──────────────────────────────
async function openQRScanner(){ 
  document.getElementById('qr-scanner-backdrop').classList.add('open'); 
  setScanStatus('info', 'Initializing camera...');
  
  html5QrCode = new Html5Qrcode("reader");
  const config = { fps: 10, qrbox: { width: 250, height: 250 }, aspectRatio: 1.0 };
  
  try {
    await html5QrCode.start({ facingMode: "environment" }, config, 
      (decodedText) => {
        onQRFound(decodedText);
      },
      (errorMessage) => { /* Ignore regular scan fails */ }
    );
    setScanStatus('info', 'Scanning... point at the QR code');
  } catch(err) {
    setScanStatus('error', 'Camera access denied or unavailable.');
  }
}

function closeQRScanner(){ 
  document.getElementById('qr-scanner-backdrop').classList.remove('open'); 
  if(html5QrCode) {
    html5QrCode.stop().then(() => { html5QrCode.clear(); }).catch(e => console.log(e));
  }
}

function onQRFound(data){
  let code = data.trim().toUpperCase();
  try { const url = new URL(data); const p = url.searchParams.get('code'); if(p) code = p.toUpperCase(); } catch(e){}
  
  const isCodeTab = document.getElementById('panel-code-recv').classList.contains('active');
  if(isCodeTab) {
    document.getElementById('code-recv-input').value = code.substring(0,6);
    closeQRScanner(); connectForCode();
  } else {
    document.getElementById('receive-code').value = code.substring(0,6);
    closeQRScanner(); connectToSender();
  }
}

function setScanStatus(type, text){
  const el = document.getElementById('scan-status');
  el.className = 'md-status ' + type;
  el.innerHTML = type === 'info' ? `<div class="logo-spinner"></div><span style="color:#fff">${text}</span>` : `<div class="status-dot"></div><span style="color:#fff">${text}</span>`;
}

// ── ABOUT MODAL ───────────────────────────────────────
function openAbout() {
  document.getElementById('about-modal').classList.add('open');
  if(!supportQrGenerated) {
    new QRCode(document.getElementById('support-qr'), { 
      text: "01309250507", 
      width: 140, height: 140, 
      colorDark: "#000000", colorLight: "#ffffff",
      correctLevel: QRCode.CorrectLevel.M
    });
    supportQrGenerated = true;
  }
}
function closeAbout() {
  document.getElementById('about-modal').classList.remove('open');
}

// ── CODE EDITOR & SYNTAX ──────────────────────────────
const EXT_MAP = {
  python: 'py',
  javascript: 'js',
  typescript: 'ts',
  html: 'html',
  css: 'css',
  json: 'json',
  c: 'c',
  cpp: 'cpp',
  java: 'java',
  bash: 'sh',
  sql: 'sql',
  php: 'php',
  rust: 'rs',
  go: 'go',
  ruby: 'rb',
  plaintext: 'txt'
};
function highlight(code, lang) {
  if (!code.trim()) {
    currentLang = 'plaintext';
    return '';
  }
  try {
    if (lang && lang !== 'plaintext' && hljs.getLanguage(lang)) {
      return hljs.highlight(code, { language: lang }).value;
    }
    const result = hljs.highlightAuto(code, ['javascript', 'typescript', 'python', 'html', 'css', 'json', 'c', 'cpp', 'java', 'bash', 'sql', 'php', 'rust', 'go', 'ruby']);
    currentLang = result.language || 'plaintext';
    return result.value;
  } catch (e) {
    console.error(e);
    try {
      const res = hljs.highlightAuto(code);
      currentLang = res.language || 'plaintext';
      return res.value;
    } catch(err) {
      currentLang = 'plaintext';
      return code.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    }
  }
}

function onCodeInput(){
  const ta = document.getElementById('code-textarea'), hl = document.getElementById('code-highlight'), lnEl = document.getElementById('line-nums');
  const code = ta.value;
  const hlContent = highlight(code);
  hl.innerHTML = hlContent + (code.endsWith('\n')?'\n':'');
  document.getElementById('editor-lang-label').textContent = 'AUTO-DETECT: ' + currentLang.toUpperCase();
  const lc = code.split('\n').length;
  lnEl.innerHTML = Array.from({length:lc},(_,i)=>i+1).join('<br>');
  syncScroll(ta);
}

document.getElementById('code-textarea').addEventListener('keydown', function(e) {
  if (e.key === 'Tab') {
    e.preventDefault();
    let start = this.selectionStart, end = this.selectionEnd;
    this.value = this.value.substring(0, start) + "    " + this.value.substring(end);
    this.selectionStart = this.selectionEnd = start + 4;
    onCodeInput();
  }
});

function syncScroll(el){
  requestAnimationFrame(() => {
    document.getElementById('code-highlight').scrollTop = el.scrollTop;
    document.getElementById('code-highlight').scrollLeft = el.scrollLeft;
    document.getElementById('line-nums').scrollTop = el.scrollTop;
  });
}
function clearCodeEditor(){ document.getElementById('code-textarea').value=''; onCodeInput(); cancelTransfer(); document.getElementById('code-share-ready').classList.add('hidden'); document.getElementById('code-share-start-btn').disabled = false; }

// ── CODE P2P SHARE ────────────────────────────────────
let codeSharePeer = null, codeRecvPeer = null;

async function startCodeShare(){
  const code = document.getElementById('code-textarea').value.trim();
  if(!code){ alert('Write or paste code first.'); return; }
  const btn = document.getElementById('code-share-start-btn');
  btn.disabled = true; btn.innerHTML = '<div class="logo-spinner"></div> GENERATING...';
  
  try { codeSharePeer = await initPeer(); }
  catch(e){ btn.disabled = false; btn.innerHTML = '<span class="material-icons-round">share</span> GENERATE SYNC LINK'; alert('Network error.'); return; }
  
  const shareId = codeSharePeer.id;
  document.getElementById('my-code-share').textContent = shareId;
  document.getElementById('code-share-ready').classList.remove('hidden');
  
  codeSharePeer.on('connection', conn => {
    conn.on('open', () => {
      document.getElementById('code-share-status').classList.add('hidden');
      conn.send({type:'code', lang:currentLang, content:code});
      setTimeout(()=>{ document.getElementById('code-share-success').classList.add('visible'); }, 500);
    });
  });
}

function connectForCode(){
  const code = document.getElementById('code-recv-input').value.trim().toUpperCase();
  if(!code || code.length < 6){ setCodeRecvStatus('warn','Enter a valid 6-digit code.'); return; }
  setCodeRecvStatus('info','Connecting…');
  
  if(codeRecvPeer) codeRecvPeer.destroy();
  codeRecvPeer = new Peer({ debug: 0, config: ICE_CONFIG, pingInterval: 5000 });
  
  codeRecvPeer.on('open', () => {
    const conn = codeRecvPeer.connect(code, { reliable: true });
    conn.on('open', () => setCodeRecvStatus('info','Connected! Fetching…'));
    conn.on('data', msg => { if(msg.type === 'code') receiveCode(msg); });
    conn.on('error', () => setCodeRecvStatus('error','Connection failed.'));
    setTimeout(()=>{ if(!conn.open) setCodeRecvStatus('error','Timeout reaching sender.'); }, 60000);
  });
}

function setCodeRecvStatus(type, html){ 
  const el = document.getElementById('code-recv-status'); el.className = 'md-status ' + type; 
  el.innerHTML = type === 'info' ? `<div class="logo-spinner"></div><span>${html}</span>` : `<div class="status-dot"></div><span>${html}</span>`;
  el.classList.remove('hidden'); 
}

function receiveCode(msg){
  receivedCodeData = msg;
  setCodeRecvStatus('success','Code received!');
  document.getElementById('recv-code-display-card').classList.remove('hidden');
  document.getElementById('recv-code-lang-label').textContent = msg.lang.toUpperCase();
  
  const hl = highlight(msg.content, msg.lang);
  document.getElementById('recv-code-highlighted').innerHTML = hl;
  document.getElementById('recv-code-lines').innerHTML = Array.from({length: msg.content.split('\n').length}, (_,i)=>i+1).join('<br>');
}
function copyReceivedCode(){ 
  if(!receivedCodeData)return; 
  navigator.clipboard.writeText(receivedCodeData.content).catch(()=>{}); 
  const btn = document.getElementById('copy-recv-code-btn');
  btn.innerHTML = '<span class="material-icons-round" style="font-size:16px">check</span> COPIED';
  setTimeout(() => btn.innerHTML = '<span class="material-icons-round" style="font-size:16px">content_copy</span> COPY', 2000);
}
function downloadCodeFile(){
  if(!receivedCodeData)return;
  const ext = EXT_MAP[receivedCodeData.lang] || 'txt';
  const blob = new Blob([receivedCodeData.content], {type:'text/plain'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = `snippet.${ext}`; a.click(); URL.revokeObjectURL(url);
}

// ── AUTO-FILL FROM URL ────────────────────────────────
window.addEventListener('load', () => {
  const p = new URLSearchParams(window.location.search);
  const code = p.get('code');
  const tab = p.get('tab');
  
  if(code){ 
    if (tab === 'code') {
      switchTab('code-recv'); 
      document.getElementById('code-recv-input').value = code.toUpperCase();
    } else {
      switchTab('receive'); 
      document.getElementById('receive-code').value = code.toUpperCase();
    }
  }
});
