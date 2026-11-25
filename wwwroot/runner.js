import { workerMain } from './runtime/worker.js';

const packageCache = new Map();
const moduleRoot = new URL('.',import.meta.url);
// The shipped .NET 11 Mono binary uses standard WebAssembly exception references.
// This is its SDK loader's try_table/exnref feature probe, independent of user-agent strings.
export function supportsExceptionReferences() {
  const probe=Uint8Array.from(atob('AGFzbQEAAAABBAFgAAADAgEAChABDgACaR9AAQMAAAsACxoL'),char=>char.charCodeAt(0));
  return typeof WebAssembly !== 'undefined' && WebAssembly.validate(probe);
}
export function loadPackage(version) {
  if (!packageCache.has(version)) {
    const request=fetch(new URL('runtime/net'+version+'.bin',moduleRoot),{credentials:'omit'}).then(response=>{
      if (!response.ok) throw new Error('Не удалось загрузить .NET '+version+' ('+response.status+').');
      return response.arrayBuffer();
    }).catch(error=>{packageCache.delete(version);throw error;});
    packageCache.set(version,request);
  }
  return packageCache.get(version);
}

// The iframe has a unique opaque origin. Its worker inherits that origin and CSP.
// Only the private message port and, when needed, a one-run read-only input URL cross it.
function sandboxFrame() {
  window.addEventListener('message',event=>{
    if (event.source!==parent || !event.ports[0]) return;
    const port=event.ports[0];
    const {workerCode,payload}=event.data;
    let shared=null, worker=null, uri=null;
    try {
      if (!payload.stdin && crossOriginIsolated && typeof SharedArrayBuffer !== 'undefined') shared=new SharedArrayBuffer(65544);
      uri=URL.createObjectURL(new Blob([workerCode],{type:'text/javascript'}));
      worker=new Worker(uri,{credentials:'omit'});
      const fail=text=>{port.postMessage({type:'error',text});port.postMessage({type:'done'});};
      worker.onerror=err=>{fail(err.message || 'Браузер остановил среду выполнения.');};
      const events=new MessageChannel();
      events.port1.onmessage=msg=>port.postMessage(msg.data);
      port.onmessage=({data})=>{
        if (data.type==='stop') {worker.terminate();return;}
        if (data.type!=='send' || !shared) return;
        const bytes=new TextEncoder().encode(data.line);
        const cells=new Int32Array(shared,0,2);
        new Uint8Array(shared,8).set(bytes);
        Atomics.store(cells,1,bytes.length); Atomics.store(cells,0,1); Atomics.notify(cells,0,1);
      };
      try { worker.postMessage({...payload,shared},[payload.bundle,events.port2]); }
      catch (err) {
        if (!shared) throw err;
        shared=null; worker.postMessage({...payload,shared:null},[payload.bundle,events.port2]);
      }
      port.postMessage({type:'transport',shared:Boolean(shared)});
    } catch (err) {
      if (worker) worker.terminate();
      port.postMessage({type:'error',text:String(err.message||err)});port.postMessage({type:'done'});
    }
  },{once:true});
}

export function startRun({source,version=10,files={},stdin,onEvent}) {
  let finished=false, port=null, frame=null, writer=null, writable=false, useShared=false;
  let runningSince=0, remaining=30000, ready=false;
  let deadline=setTimeout(()=>fault('Среда не загрузилась за 90 секунд.'),90000);
  function startClock() {
    clearTimeout(deadline);
    runningSince=performance.now();
    deadline=setTimeout(()=>fault('Выполнение остановлено после 30 секунд. Время ожидания ввода не учитывается.'),Math.max(0,remaining));
  }
  function pauseClock() {
    if (!runningSince) return;
    remaining-=performance.now()-runningSince;
    runningSince=0;
    clearTimeout(deadline);
  }
  const emit=message=>{if (!finished) onEvent(message);};
  const endpoint=new URL('api/book-input',moduleRoot);
  const requestInit={credentials:'omit',headers:{'X-Book-Input':'1'},cache:'no-store'};
  function close() {
    if (finished) return;
    finished=true;
    clearTimeout(deadline);
    if (port) {port.postMessage({type:'stop'});port.close();}
    frame?.remove();
    if (writer) fetch(writer,{...requestInit,method:'DELETE'}).catch(()=>{});
    onEvent({type:'done'});
  }
  function fault(error) { if (!finished) {emit({type:'error',text:String(error?.message||error)});close();} }
  async function boot() {
    version=Number(version);
    if (version!==10 && version!==11) throw new Error('Выбери .NET 10 или .NET 11.');
    if (version===11 && !supportsExceptionReferences()) {
      throw new Error('Для .NET 11 и C# 15 обнови браузер. На Android нужна Android System WebView версии 137 или новее. Сейчас можно открыть урок с пометкой .NET 10.');
    }
    if (typeof source!=='string' || source.length>600000) throw new Error('Program.cs превышает размер 600 тысяч символов.');
    const extra=Object.entries(files||{}).filter(([name])=>name.toLowerCase()!=='program.cs');
    if (extra.length>100 || extra.some(([name,code])=>typeof code!=='string' || name.length>256) || extra.reduce((n,[,s])=>n+s.length,source.length)>1200000) throw new Error('Проект слишком велик для браузерного запуска.');
    // The mailbox is only used when this browser cannot share memory in its opaque iframe.
    const mailboxAbort=new AbortController();
    const mailboxTimer=stdin ? null : setTimeout(()=>mailboxAbort.abort(),4500);
    const mailbox=stdin ? null : fetch(endpoint,{...requestInit,method:'POST',signal:mailboxAbort.signal}).then(async r=>{
      const box=r.ok?await r.json():null;
      if (box && /^[A-F0-9]{48}$/.test(box.write)) {
        writer=endpoint.href+'/write/'+box.write;
        if (finished) fetch(writer,{...requestInit,method:'DELETE'}).catch(()=>{});
      }
      return box;
    }).catch(()=>null).finally(()=>clearTimeout(mailboxTimer));
    const [data,box]=await Promise.all([loadPackage(version),mailbox]);
    if (finished) return;
    const readUrl=box && /^[A-F0-9]{48}$/.test(box.read)?endpoint.href+'/read/'+box.read:null;
    const csp="default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' blob:; worker-src blob:; connect-src blob:"+(readUrl?' '+readUrl:'')+"; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";
    frame=document.createElement('iframe');
    frame.hidden=true; frame.setAttribute('aria-hidden','true');
    frame.setAttribute('sandbox','allow-scripts');
    frame.setAttribute('allow','cross-origin-isolated *');
    const channels=new MessageChannel(); port=channels.port1;
    port.onmessage=({data:msg})=>{
      if (finished || !msg || typeof msg!=='object') return;
      if (msg.type==='transport') {useShared=msg.shared;return;}
      if (msg.type==='done') {close();return;}
      if (!['output','ready','error','warning','input'].includes(msg.type)) return;
      if (msg.type==='ready' && !ready) {ready=true;startClock();}
      if (msg.type==='input') {writable=true;pauseClock();}
      emit(msg);
    };
    frame.onload=()=>{
      if (finished) return;
      const bundle=data.slice(0);
      const payload={source,files:Object.fromEntries(extra),bundle,readUrl,stdin};
      frame.contentWindow.postMessage({workerCode:'('+workerMain.toString()+')()',payload},'*',[channels.port2,bundle]);
    };
    frame.srcdoc='<meta http-equiv="Content-Security-Policy" content="'+csp+'"><script>('+sandboxFrame.toString()+')()</script>';
    document.body.append(frame);
  }
  Promise.resolve().then(boot).catch(fault);
  return {
    sendInput(line) {
      if (finished || !writable) return;
      const value=String(line).replace(/[\r\n]+$/,'');
      if (new TextEncoder().encode(value).length>65536) {fault('Строка ввода превышает 64 КБ.');return;}
      writable=false;
      if (ready) startClock();
      if (useShared) port.postMessage({type:'send',line:value});
      else if (writer) fetch(writer,{...requestInit,method:'POST',body:value}).then(r=>{if(!r.ok)throw new Error('Не удалось передать строку ввода.');}).catch(fault);
      else fault('Для интерактивного ввода открой учебник через локальный сервер.');
    },
    stop:close
  };
}
