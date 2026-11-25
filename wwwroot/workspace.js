'use strict';
const secondaryPane = window.frameElement?.id==='book-secondary-frame' && new URLSearchParams(location.search).get('pane')==='secondary';
const paneSections = [['home','Оглавление','book-open'],['reader','К уроку','book-marked'],['console','Консоль','square-terminal'],['saved','Закладки','bookmark']];
class PaneStore extends BookStore {
  scoped(key) {
    const shared=key==='theme'||/^(read|saved|note|solved)\//.test(key);
    return secondaryPane&&!shared?'secondary/'+key:key;
  }
  get(key,fallback){return super.get(this.scoped(key),fallback);}
  set(key,value){super.set(this.scoped(key),value);}
}
let primary, reader, auxiliary, workspace, dock, divider, dockTabs, consolePages, consolePanel;
let secondaryFrame, readyFrame, pendingExample;
let split=false, activeConsole='', lastReading='', readerKey='';
const consoleTabs=new Map();
const stackMedia=matchMedia('(max-width: 680px) and (orientation: portrait)');
function readingChapter() {
  return lastReading.startsWith('chapter/') ? chapters[Number(lastReading.slice(8))] : null;
}
function resumeReading() {
  go(...(lastReading||'chapter/0').split('/'));
}
function lastPaneReading(){return lastReading||'chapter/0';}
function createWorkspace() {
  // The reader and its same-origin second pane share the window's typography.
  // Their content grids still respond to each pane's available width.
  const clip=document.createElement('div'), screen=document.createElement('div');
  clip.className='book-viewport';screen.className='book-window';
  root.before(clip);clip.append(screen);screen.append(root);
  if(secondaryPane){
    const syncWidth=()=>screen.style.setProperty('--book-screen',parent.innerWidth+'px');
    syncWidth();parent.addEventListener('resize',syncWidth);
    window.addEventListener('pagehide',()=>parent.removeEventListener('resize',syncWidth),{once:true});
  }
  root.innerHTML='<div id="book-header"></div><div id="book-workspace"><div id="book-left"><div id="book-primary"><div id="reader-view" hidden></div><div id="aux-view"></div></div>'+
    '<section id="book-console" aria-label="Консоль" hidden><div class="dock-toolbar"><div id="dock-tabs" aria-label="Открытые программы"></div>'+
    button('new-console',icon('plus'),'dock-icon','aria-label="Новая консоль" title="Новая консоль"')+'</div><div id="editor-host"></div></section></div>'+
    '<div id="book-divider" role="separator" tabindex="0" aria-label="Размер панелей" aria-controls="book-left book-dock" aria-valuemin="25" aria-valuemax="75" hidden></div>'+
    '<section id="book-dock" aria-label="Вторая панель" hidden></section></div><div id="book-bottom"></div>';
  workspace=root.querySelector('#book-workspace');primary=root.querySelector('#book-primary');
  reader=root.querySelector('#reader-view');auxiliary=root.querySelector('#aux-view');
  dock=root.querySelector('#book-dock');divider=root.querySelector('#book-divider');
  consolePanel=root.querySelector('#book-console');
  dockTabs=root.querySelector('#dock-tabs');consolePages=root.querySelector('#editor-host');
  primary.addEventListener('scroll',()=>{
    clearTimeout(scrollTimer);
    scrollTimer=setTimeout(keepReadingPosition,250);
  },{passive:true});
  document.addEventListener('keydown',event=>{
    if(!event.ctrlKey||!event.shiftKey||event.code!=='KeyB'||state.page==='exit')return;
    event.preventDefault();
    if(secondaryPane){
      parent.toggleDock();
      parent.document.querySelector('[data-action="dock"]')?.focus({preventScroll:true});
    }else toggleDock();
  });
  if(secondaryPane){
    root.addEventListener('change',event=>{
      if(event.target.id!=='pane-section-select')return;
      const target=event.target.value;
      if(target==='reader')resumeReading();else go(target);
    });
    return;
  }
  split=store.get('split-open',false);
  const dimensionKey=()=>stackMedia.matches?'dock-height':'dock-width';
  function resize(value,save) {
    const ratio=Math.max(25,Math.min(75,Math.round(Number(value)||50)));
    workspace.style.setProperty('--reader-size',ratio+'%');
    divider.setAttribute('aria-valuenow',String(ratio));
    divider.setAttribute('aria-orientation',stackMedia.matches?'horizontal':'vertical');
    if(save)store.set(dimensionKey(),ratio);
  }
  const restore=()=>resize(store.get(dimensionKey(),50),false);
  restore();stackMedia.addEventListener('change',restore);
  divider.addEventListener('pointerdown',event=>{workspace.classList.add('resizing');divider.setPointerCapture(event.pointerId);event.preventDefault();});
  divider.addEventListener('pointermove',event=>{
    if(!divider.hasPointerCapture(event.pointerId))return;
    const r=workspace.getBoundingClientRect();
    resize(100*(stackMedia.matches?(event.clientY-r.top)/r.height:(event.clientX-r.left)/r.width),false);
  });
  divider.addEventListener('lostpointercapture',()=>{workspace.classList.remove('resizing');resize(divider.getAttribute('aria-valuenow'),true);});
  divider.addEventListener('keydown',event=>{
    const delta={ArrowLeft:-5,ArrowRight:5,ArrowUp:-5,ArrowDown:5}[event.key];
    if(delta){event.preventDefault();resize(Number(divider.getAttribute('aria-valuenow'))+delta,true);}
  });
}
function paintConsoleTabs() {
  dockTabs.replaceChildren();
  for(const [key,tab] of consoleTabs) {
    const group=document.createElement('span'), select=document.createElement('button'), close=document.createElement('button');
    group.className='dock-tab';select.textContent=tab.entry.exampleTitle||'Консоль';
    select.title=[tab.entry.topicTitle,select.textContent].filter(Boolean).join(' · ');
    select.setAttribute('aria-pressed',String(activeConsole===key));select.onclick=()=>selectConsole(key);
    close.textContent='×';close.setAttribute('aria-label','Закрыть вкладку «'+select.textContent+'»');close.onclick=()=>closeConsole(key);
    group.append(select,close);dockTabs.append(group);
  }
}
function selectConsole(key) {
  const tab=consoleTabs.get(key);
  if(!tab)return;
  const previous=consoleTabs.get(activeConsole);
  if(previous)previous.scroll=consolePages.scrollTop;
  activeConsole=key;
  for(const item of consoleTabs.values())item.host.hidden=item!==tab;
  consolePages.scrollTop=tab.scroll||0;
  store.set('console',tab.entry);rememberTabs();paintConsoleTabs();
}
function rememberTabs() {
  store.set('console-tabs',[...consoleTabs.keys()]);
}
function closeConsole(key) {
  const tab=consoleTabs.get(key);
  if(!tab)return;
  tab.cleanup?.();tab.host.remove();consoleTabs.delete(key);
  if(activeConsole===key){
    activeConsole='';
    if(consoleTabs.size)selectConsole([...consoleTabs.keys()].at(-1));
    else {store.set('console',null);if(state.page==='console')resumeReading();else render();}
  }
  rememberTabs();paintConsoleTabs();
}
function addConsole(entry) {
  const key=entry.key;
  if(consoleTabs.has(key)){selectConsole(key);return;}
  const host=document.createElement('div');host.className='cs-console-page';
  consolePages.append(host);
  const tab={host,entry,cleanup:null};consoleTabs.set(key,tab);store.set('tab/'+key,entry);
  selectConsole(key);
  import('./console.js').then(({mountConsole})=>{
    if(consoleTabs.get(key)!==tab)return;
    tab.cleanup=mountConsole(host,{...entry,showHeader:false,onBack:resumeReading,onChange:(source,files)=>{
      tab.entry={...tab.entry,source,files};
      store.set(key,{source,files});store.set('tab/'+key,tab.entry);
      if(activeConsole===key)store.set('console',tab.entry);
    }});
  }).catch(e=>{host.textContent='Не удалось открыть консоль. '+e.message;});
}
function ensureConsole() {
  if(consoleTabs.size)return;
  const previous=store.get('console',null);
  for(const key of store.get('console-tabs',[])){
    const entry=store.get('tab/'+key,null);
    if(entry)addConsole(entry);
  }
  if(previous) addConsole({...previous,key:previous.key||'editor/general'});
  if(!consoleTabs.size) addConsole({...defaultEditor(findLesson(state.lesson)),key:'editor/general'});
}
function newConsole() {
  const number=store.get('console-sequence',0)+1;store.set('console-sequence',number);
  addConsole({key:'scratch/'+number,source:'',files:{},version:10,topicId:state.lesson,topicTitle:'',exampleTitle:'Программа '+number});
}
function secondaryHeader(reading) {
  const current=reading?'reader':state.page;
  const options=paneSections.map(([key,title])=>'<option value="'+key+'"'+(key===current?' selected':'')+'>'+title+'</option>').join('');
  return '<header class="pane-header"><select id="pane-section-select" aria-label="Раздел второй панели">'+options+'</select>'+
    (reading?button('menu',icon('list')+'Содержание','pane-chapters','aria-expanded="'+menuOpen+'"'):'')+'</header>';
}
function choosePaneView() {
  return '<main class="pane-choice"><h2>Открыть во второй панели</h2>'+paneSections.map(([key,title,glyph])=>
    button(key==='reader'?'back':'go:'+key,icon(glyph)+title,'cs-tool')).join('')+'</main>';
}
function mountSecondary() {
  if(secondaryFrame)return;
  const frame=document.createElement('iframe');
  const route=store.get('secondary/active-route','choose');
  const address=new URL('index.html',location.href);address.searchParams.set('pane','secondary');address.hash=route;
  frame.id='book-secondary-frame';frame.title='Вторая панель';frame.allow='cross-origin-isolated; clipboard-write';frame.src=address.href;
  secondaryFrame=frame;dock.append(frame);
}
function secondaryReady(frameWindow) {
  if(frameWindow!==secondaryFrame?.contentWindow)return;
  readyFrame=frameWindow;
  if(pendingExample){const entry=pendingExample;pendingExample=null;readyFrame.openConsoleEntry(entry);}
}
function openConsoleEntry(entry) {
  if(!consoleTabs.size && store.get('console',null))ensureConsole();
  addConsole({...entry,...store.get(entry.key,{}),key:entry.key});go('console');
}
function openBeside(entry) {
  if(secondaryPane){parent.openConsoleEntry(entry);return;}
  pendingExample=entry;split=true;store.set('split-open',true);render();
  if(readyFrame)secondaryReady(readyFrame);
}
function toggleDock() {
  if(secondaryPane)return;
  split=!split;store.set('split-open',split);render();
}
function paintWorkspace() {
  const full=state.page==='console', both=!secondaryPane&&split&&state.page!=='exit';
  workspace.classList.toggle('is-split',both);
  root.classList.toggle('has-dock',both);
  primary.hidden=full;consolePanel.hidden=!full;divider.hidden=!both;dock.hidden=!both;
  if(full)ensureConsole();
  if(both)mountSecondary();
  if(state.page==='exit'&&secondaryFrame){
    secondaryFrame.remove();secondaryFrame=readyFrame=pendingExample=null;
  }else if(state.page!=='exit'){
    const route=location.hash.slice(1)||'home';
    if(store.get('active-route','')!==route)store.set('active-route',route);
  }
}
