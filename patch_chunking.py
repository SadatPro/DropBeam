with open('index.html', 'r') as f:
    html = f.read()

send_in_chunks_old = """  async function sendAll(){
    // Native PeerJS transfer
    try {
      for(let i=0;i<files.length;i++){
        setSendStatus('info',`Sending file ${i+1} of ${files.length}… (${files[i].name})`);
        
        // Native chunking delegation
        conn.send({
           type: 'native-file',
           name: files[i].name,
           size: files[i].size,
           mime: files[i].type,
           file: files[i]
        });
        
        totalSent += files[i].size;
        updateUI(totalSent, totalSize);
        await new Promise(r=>setTimeout(r,500)); // small gap between files
      }
      conn.send(JSON.stringify({type:'batch-done'}));
      if(diagInterval) clearInterval(diagInterval);
      finishSendBatch(stopStream,totalSize);
    } catch (err) {
      console.error('Send error:',err);
      setSendStatus('error','Transfer error: '+err.message);
      if(diagInterval) clearInterval(diagInterval);
      stopStream();
    }
  }

  sendAll();"""

send_in_chunks_new = """  // Get the raw RTCDataChannel for bufferedAmount monitoring
  let dc=null;
  
  // Send control message as JSON string
  function ctrl(obj){conn.send(JSON.stringify(obj));}

  ctrl({type:'batch-meta',count:files.length,totalSize,files:files.map(f=>({name:f.name,size:f.size,mime:f.type}))});

  function waitDrain(dataChannel){
    return new Promise(resolve=>{
      if(!dataChannel||dataChannel.bufferedAmount<=BUFFER_LOW){resolve();return;}
      const prev=dataChannel.bufferedAmountLowThreshold;
      dataChannel.bufferedAmountLowThreshold=BUFFER_LOW;
      dataChannel.onbufferedamountlow=()=>{
        dataChannel.onbufferedamountlow=null;
        dataChannel.bufferedAmountLowThreshold=prev;
        resolve();
      };
      // Safety fallback: resolve after 2s even if drain event doesn't fire
      setTimeout(resolve,2000);
    });
  }

  // Helper to read a slice of the file into an ArrayBuffer asynchronously
  function readSlice(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = e => resolve(e.target.result);
      reader.onerror = e => reject(e);
      reader.readAsArrayBuffer(blob);
    });
  }

  async function sendAll(){
    try {
      dc=conn.dataChannel;
      for(let i=0;i<files.length;i++){
        const file=files[i];
        setSendStatus('info',`Sending file ${i+1} of ${files.length}… (${file.name})`);
        ctrl({type:'file-start',name:file.name,size:file.size,mime:file.type});
        
        let offset=0;
        while(offset<file.size&&transferActive){
          if(dc&&dc.bufferedAmount>BUFFER_HIGH){
            setSendStatus('warn','Network congested, pausing upload…');
            await waitDrain(dc);
            setSendStatus('info',`Sending file ${i+1} of ${files.length}… (${file.name})`);
          }
          const end=Math.min(offset+CHUNK_SIZE,file.size);
          const chunk=await readSlice(file.slice(offset,end));
          conn.send(chunk);
          offset+=chunk.byteLength;
          totalSent+=chunk.byteLength;
          
          if(offset===file.size || offset%(CHUNK_SIZE*16)===0){
            updateUI(totalSent,totalSize);
            await new Promise(r=>setTimeout(r,0));
          }
        }
        ctrl({type:'file-end'});
        if(!transferActive)break;
      }
      if(transferActive){
        ctrl({type:'batch-done'});
        finishSendBatch(stopStream,totalSize);
      }
    } catch(err){
      console.error('Send error:',err);
      setSendStatus('error','Transfer error: '+err.message);
      stopStream();
    }
  }

  sendAll();"""

if send_in_chunks_old in html:
    html = html.replace(send_in_chunks_old, send_in_chunks_new)
else:
    print("Failed to replace send_in_chunks")

with open('index.html', 'w') as f:
    f.write(html)
