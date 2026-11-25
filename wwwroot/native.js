const desktopBridge=window.chrome?.webview;
if(desktopBridge){
  let phone={enabled:false,urls:[]};
  const phoneBlock=()=>{
    const section=document.querySelector('.settings-view');
    if(!section || !section.querySelector('[data-action="exit"]')) return;
    let block=section.querySelector('.phone-access');
    if(!block){block=document.createElement('section');block.className='phone-access';section.append(block);}
    block.innerHTML='<h2>Открыть на телефоне</h2><p>'+(phone.enabled?'Подключи телефон к той же сети Wi-Fi. Наведи камеру на QR-код или открой адрес в браузере. Оставь окно учебника на ПК открытым.':'Открой доступ в своей сети Wi-Fi, чтобы читать учебник и запускать примеры с телефона.')+'</p>'+
      (phone.enabled?phone.urls.map(url=>'<p><code>'+esc(url)+'</code></p>').join(''):'')+
      (phone.error?'<p role="alert">'+esc(phone.error)+'</p>':'')+
      '<button type="button" class="cs-tool" id="phone-toggle">'+(phone.enabled?'Отключить доступ':'Открыть доступ по Wi-Fi')+'</button>';
    block.querySelector('button').onclick=()=>desktopBridge.postMessage(phone.enabled?'lan-off':'lan-on');
    if(phone.enabled && phone.urls.length) {
      const image=new Image(148,148);
      image.alt='QR-код для открытия учебника на телефоне';image.style.imageRendering='pixelated';
      block.querySelector('code').parentElement.before(image);
      const url=phone.urls[0];
      import('./vendor/qrcode.mjs').then(({default:makeCode})=>{
        const code=makeCode(0,'M');code.addData(url);code.make();image.src=code.createDataURL(4,16);
      }).catch(()=>image.remove());
    }
  };
  desktopBridge.addEventListener('message',e=>{if(e.data.type==='phone'){phone=e.data;phoneBlock();}});
  new MutationObserver(()=>{if(document.querySelector('.settings-view [data-action="exit"]')&&!document.querySelector('.settings-view .phone-access')){phoneBlock();desktopBridge.postMessage('lan-info');}}).observe(document.getElementById('app'),{childList:true,subtree:true});
}

