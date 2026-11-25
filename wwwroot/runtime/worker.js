// Serialized into a dedicated worker inside an opaque, network-restricted frame.
export function workerMain() {
  self.onmessage = async ({data,ports}) => {
    self.onmessage = null;
    const {bundle,source,files,readUrl,shared,stdin} = data;
    let nextLine = 0;
    const emit = ports[0].postMessage.bind(ports[0]);
    const decoder = new TextDecoder();
    let count = 0, pending = '', last = 0, wasError = false;
    function flush() {
      if (pending) emit({type:'output',text:pending,stream:wasError?'stderr':'stdout'});
      pending=''; last=performance.now();
    }
    function output(text,stderr) {
      if (!text || count >= 131072) return;
      if (stderr !== wasError) flush();
      wasError=stderr;
      const chunk=text.slice(0,131072-count);
      pending+=chunk; count+=chunk.length;
      if (count === 131072) pending+='\n[Показаны первые 128 тысяч символов вывода.]\n';
      if (pending.length >= 2048 || performance.now()-last > 35 || !last) flush();
    }
    function input() {
      if (stdin) return stdin[nextLine++] ?? null;
      flush(); emit({type:'input'});
      if (shared) {
        const control=new Int32Array(shared,0,2);
        while (Atomics.load(control,0)===0) Atomics.wait(control,0,0);
        const length=Atomics.load(control,1);
        const text=decoder.decode(new Uint8Array(shared,8,length).slice());
        Atomics.store(control,0,0);
        return text;
      }
      if (!readUrl) throw new Error('Для Console.ReadLine открой учебник через его локальный сервер.');
      while (true) {
        const request=new XMLHttpRequest();
        request.open('GET',readUrl,false);
        request.send();
        if (request.status===204) continue;
        if (request.status===410 || request.status===404) return null;
        if (request.status!==200) throw new Error('Канал ввода недоступен. Запусти программу ещё раз.');
        return request.responseText;
      }
    }
    const objectUrls=[];
    try {
      const stream = new Blob([bundle]).stream().pipeThrough(new DecompressionStream('gzip'));
      const bytes = new Uint8Array(await new Response(stream).arrayBuffer());
      const view = new DataView(bytes.buffer);
      const assets = new Map(), modules = new Map();
      for (let i=0; i<bytes.length;) {
        const nameSize=view.getUint32(i,true), size=view.getUint32(i+4,true); i+=8;
        const name=decoder.decode(bytes.subarray(i,i+nameSize)); i+=nameSize;
        assets.set(name,bytes.subarray(i,i+size)); i+=size;
      }
      for (const [name,body] of assets) {
        if (!name.endsWith('.js') && !name.endsWith('.mjs')) continue;
        // The packaged runtime normally resolves siblings against import.meta.url.
        // A logical base preserves those names while all requests resolve to this bundle.
        const base=JSON.stringify('https://runtime.invalid/_framework/'+name);
        const js=decoder.decode(body).replaceAll('import.meta.url',base);
        const uri=URL.createObjectURL(new Blob([js],{type:'text/javascript'}));
        modules.set(name,uri); objectUrls.push(uri);
      }
      if (!globalThis.crypto.subtle) {
        // Opaque-origin workers lack WebCrypto on several browsers, including
        // on LAN HTTP. SHA algorithms here are the bundled @noble/hashes 2.4.0.
        const {portableSubtle}=await import(modules.get('portable-digest.js'));
        Object.defineProperty(globalThis.crypto,'subtle',{value:portableSubtle});
      }
      const {dotnet}=await import(modules.get('dotnet.js'));
      const host=await dotnet.withConfig({cacheBootResources:false,disableIntegrityCheck:true})
        .withResourceLoader((type,name,uri) => {
          const path = uri ? decodeURIComponent(new URL(uri,'https://runtime.invalid/_framework/').pathname).split('/_framework/').pop() : name;
          const key=assets.has(path)?path:name;
          if (modules.has(key)) return modules.get(key);
          if (!assets.has(key)) throw new Error('В пакете среды отсутствует '+key);
          const mime=key.endsWith('.wasm')?'application/wasm':'application/octet-stream';
          return Promise.resolve(new Response(assets.get(key),{headers:{'Content-Type':mime}}));
        }).create();
      host.setModuleImports('book',{output,input,diagnostic(text,code,file,line,col,warning) {
        flush();
        emit({type:warning?'warning':'error',text,code,file,line,col});
      }});
      const exported=await host.getAssemblyExports('StudentRunner.dll');
      emit({type:'ready'});
      if (data.analyze) {
        const port = ports[0];
        port.onmessage = ({data: request}) => {
          const {id, source, files, fileName, position} = request;
          try {
            const rows = exported.StudentHost.Complete(source, JSON.stringify(files), fileName, position);
            emit({type:'symbols', id, rows:JSON.parse(rows)});
          } catch (error) {
            emit({type:'analysisError', id, text:String(error?.message || error)});
          }
        };
        // The editor owns this long-lived, analysis-only worker and terminates it when idle.
        await new Promise(() => {});
      } else {
        await exported.StudentHost.Run(source,JSON.stringify(files));
      }
    } catch (error) {
      flush(); emit({type:'error',text:String(error?.message || error),detail:String(error?.stack || '')});
    } finally {
      flush(); emit({type:'done'});
      for (const uri of objectUrls) URL.revokeObjectURL(uri);
      self.close();
    }
  };
}
