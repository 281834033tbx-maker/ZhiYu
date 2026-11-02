// Installed only by the opt-in, isolated UI fixture before React loads.
// No microphone/camera, model, private DB or real realtime socket is opened.
function installRealtimeCallFixture() {
  const report={calls:0,finishes:0,audioRequests:0,cameraRequests:0,audioStops:0,cameraStops:0,pcmUploads:0,muted:false,cameraDenied:false,microphoneDenied:false};
  const sockets=[];
  let turn=0;
  const publish=()=>{const el=document.getElementById('call-fixture-report');if(el)el.textContent=JSON.stringify(report);};
  const message=payload=>sockets.at(-1)?.onmessage?.({data:JSON.stringify(payload)});
  const control=(label,run)=>{const button=document.createElement('button');button.textContent=label;button.addEventListener('click',()=>{run();publish();});return button;};
  const nativeSocket=window.WebSocket;
  class FixtureSocket {
    static OPEN=1;static CONNECTING=0;static CLOSED=3;
    constructor(url,protocol){
      if(!String(url).includes('/api/npc/realtime-speech/call'))return new nativeSocket(url,protocol);
      this.readyState=0;this.bufferedAmount=0;sockets.push(this);
      setTimeout(()=>{if(this.readyState===0){this.readyState=1;this.onopen?.({});}},10);
    }
    send(packet){
      if(typeof packet!=='string'){report.pcmUploads++;publish();return;}
      const event=JSON.parse(packet);
      if(event.type==='start'){
        report.calls++;publish();
        setTimeout(()=>{if(this.readyState===1)this.onmessage?.({data:JSON.stringify({type:'ready',inputSampleRate:16000,outputSampleRate:24000,channels:1,format:'pcm_s16le'})});},600);
      }
      if(event.type==='finish')report.finishes++;
      if(event.type==='mute')report.muted=event.muted;
      publish();
    }
    close(){this.readyState=3;}
  }
  window.WebSocket=FixtureSocket;
  class FixtureAudioContext {
    state='running';currentTime=0;destination={};audioWorklet={addModule:async()=>{}};
    resume(){this.state='running';return Promise.resolve();}
    close(){this.state='closed';return Promise.resolve();}
    createMediaStreamSource(){return {connect(){},disconnect(){}};}
    createGain(){return {gain:{value:0},connect(){},disconnect(){}};}
  }
  window.AudioContext=FixtureAudioContext;
  window.AudioWorkletNode=class {
    port={onmessage:null,postMessage(){},close(){}};connect(){}disconnect(){}
  };
  const mediaDevices={getUserMedia:async options=>{
    if(options.video){
      report.cameraRequests++;publish();
      await new Promise(resolve=>setTimeout(resolve,250));
      if(report.cameraDenied)throw new DOMException('Synthetic camera denial','NotAllowedError');
      const canvas=document.createElement('canvas');canvas.width=640;canvas.height=400;
      const ctx=canvas.getContext('2d');const gradient=ctx.createLinearGradient(0,0,640,400);
      gradient.addColorStop(0,'#526f77');gradient.addColorStop(1,'#b1a1bc');ctx.fillStyle=gradient;ctx.fillRect(0,0,640,400);
      ctx.fillStyle='rgba(255,255,255,.9)';ctx.font='28px system-ui';ctx.textAlign='center';ctx.fillText('本地摄像头 · 合成预览',320,210);
      const stream=canvas.captureStream(1);
      stream.getTracks().forEach(track=>{const stop=track.stop.bind(track);track.stop=()=>{report.cameraStops++;publish();stop();};});
      return stream;
    }
    report.audioRequests++;publish();
    if(report.microphoneDenied)throw new DOMException('Synthetic microphone denial','NotAllowedError');
    const track={enabled:true,onended:null,stop(){report.audioStops++;publish();}};
    return {getTracks:()=>[track],getAudioTracks:()=>[track]};
  }};
  Object.defineProperty(navigator,'mediaDevices',{value:mediaDevices,configurable:true});
  window.zhiyuDesktop={platform:'darwin',requestMicrophoneAccess:async()=>report.microphoneDenied?'denied':'granted',requestCameraAccess:async()=>report.cameraDenied?'denied':'granted',openMicrophoneSettings:async()=>true,openCameraSettings:async()=>true,getCharacterFullScreen:async()=>false,onCharacterFullScreenChange:()=>()=>{}};
  document.addEventListener('DOMContentLoaded',()=>{
    const box=document.createElement('aside');box.id='call-fixture-controls';box.setAttribute('aria-label','合成通话验证控制');
    Object.assign(box.style,{position:'fixed',zIndex:999,top:'65px',right:'12px',width:'170px',display:'grid',gap:'4px',padding:'8px',background:'#ffffffed',color:'#222',font:'11px system-ui',borderRadius:'8px'});
    box.append(
      control('合成：用户说话',()=>{const id='fixture-user-'+(++turn);message({type:'state',state:'listening'});for(const [index,text]of['我','我今天想','我今天想聊聊'].entries())setTimeout(()=>message({type:'transcript',role:'user',turnId:id,text,final:index===2}),index*100);}),
      control('合成：人物思考',()=>message({type:'state',state:'thinking'})),
      control('合成：人物回复',()=>{const id='fixture-assistant-'+(++turn);message({type:'state',state:'speaking'});for(const [index,text]of['又被','又被打回来啊……','又被打回来啊……他这次具体说哪里不行？'].entries())setTimeout(()=>message({type:'transcript',role:'assistant',turnId:id,text,final:index===2}),index*180);}),
      control('合成：长句尾部',()=>{message({type:'state',state:'speaking'});message({type:'transcript',role:'assistant',turnId:'fixture-long-'+(++turn),text:'这是合成的长字幕。'.repeat(60)+'最后两行必须保留尾部这一句。',final:true});}),
      control('合成：停止说话',()=>message({type:'state',state:'listening'})),
      control('合成：打断',()=>message({type:'interrupt'})),
      control('合成：服务端结束',()=>message({type:'ended'})),
      control('合成：摄像头拒绝切换',()=>{report.cameraDenied=!report.cameraDenied;}),
      control('合成：麦克风拒绝切换',()=>{report.microphoneDenied=!report.microphoneDenied;}),
      control('合成：3秒提示',()=>message({type:'notice',message:'这是合成提示，3秒后消失。'})),
      control('合成：隐藏测试控制',()=>{box.style.display='none';}),
    );
    const output=document.createElement('output');output.id='call-fixture-report';output.style.overflowWrap='anywhere';box.append(output);document.body.append(box);publish();
  });
}

export const realtimeCallFixtureScript='<script>('+installRealtimeCallFixture.toString()+')()</script>';
