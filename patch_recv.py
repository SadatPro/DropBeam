with open('index.html', 'r') as f:
    html = f.read()

recv_old = """  conn.on('data',msg=>{
    if(!msg)return;
    
    if(typeof msg==='string'){
      let obj;try{obj=JSON.parse(msg);}catch(e){return;}
      if(obj.type==='code-share'){ window.dispatchEvent(new CustomEvent('code-share-received', {detail: obj.content})); }
      else if(obj.type==='batch-done'){
        batchDoneReceived=true;checkFinish();
      }
    } else if(typeof msg==='object' && msg.type === 'native-file'){
      // Native File Handling! PeerJS automatically reassembled it!
      const file = msg.file; // This is a Blob/File
      const url = URL.createObjectURL(file);
      receivedFiles.push({name: msg.name, size: msg.size, mime: msg.mime, blob: file, url});
      
      totalBatchReceived += msg.size;
      totalBatchSize = totalBatchSize < totalBatchReceived ? totalBatchReceived : totalBatchSize;
      
      filesProcessed++;
      
      // Update Modern UI Stats
      const modernStats = document.getElementById('modern-transfer-stats');
      if(modernStats) modernStats.textContent = `${fmtBytes(totalBatchReceived)} of ${fmtBytes(totalBatchSize || totalBatchReceived)}`;
      const modernProgress = document.getElementById('modern-progress-fill');
      if(modernProgress) modernProgress.style.width = '100%';
    }
  });"""

recv_new = """  conn.on('data',msg=>{
    if(!msg)return;
    if(typeof msg==='string'){
      let obj;try{obj=JSON.parse(msg);}catch(e){return;}
      if(obj.type==='code-share'){ window.dispatchEvent(new CustomEvent('code-share-received', {detail: obj.content})); }
      else if(obj.type==='batch-meta'){ 
        receivedBatchMeta=obj;totalBatchSize=obj.totalSize||1;
      } else if(obj.type==='file-start'){
        currentFileMeta=obj;currentFileChunks=[];
      } else if(obj.type==='file-end'){
        if(currentFileMeta){pendingProcessing++;processFile({...currentFileMeta},[...currentFileChunks]);currentFileChunks=[];currentFileMeta=null;}
      } else if(obj.type==='batch-done'){
        batchDoneReceived=true;checkFinish();
      }
    } else {
      // Raw ArrayBuffer chunk
      let data;
      if(msg instanceof ArrayBuffer) data=msg;
      else if(msg instanceof Uint8Array) data=msg.buffer.slice(msg.byteOffset,msg.byteOffset+msg.byteLength);
      else if(msg.buffer) data=msg.buffer;
      else return;
      
      currentFileChunks.push(data);
      totalBatchReceived+=data.byteLength;
      updateUI(totalBatchReceived,totalBatchSize);
      
      // Update Modern UI Stats
      const modernStats = document.getElementById('modern-transfer-stats');
      if(modernStats) modernStats.textContent = `${fmtBytes(totalBatchReceived)} of ${fmtBytes(totalBatchSize || totalBatchReceived)}`;
      const modernProgress = document.getElementById('modern-progress-fill');
      if(modernProgress) modernProgress.style.width = Math.min(100, Math.round((totalBatchReceived/totalBatchSize)*100)) + '%';
    }
  });"""

if recv_old in html:
    html = html.replace(recv_old, recv_new)
else:
    print("Failed to replace recv_old")

with open('index.html', 'w') as f:
    f.write(html)
