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
let contentsPanel;
let secondaryFrame, readyFrame, pendingExample, draftManager;
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
  root.innerHTML='<div id="book-header"></div><nav id="book-contents" aria-label="Содержание" hidden></nav><div id="book-workspace"><div id="book-left"><div id="book-primary"><div id="reader-view" hidden></div><div id="aux-view"></div></div>'+
    '<section id="book-console" aria-label="Консоль" hidden><div class="dock-toolbar"><div id="dock-tabs" aria-label="Открытые программы"></div>'+
    '<button type="button" id="stored-programs" class="dock-icon" aria-label="Черновики программ" title="Черновики программ" aria-haspopup="dialog">'+icon('folder-open')+'</button>'+
    button('new-console',icon('plus'),'dock-icon','aria-label="Новая консоль" title="Новая консоль"')+'</div><div id="editor-host"></div></section></div>'+
    '<div id="book-divider" role="separator" tabindex="0" aria-label="Размер панелей" aria-controls="book-left book-dock" aria-valuemin="25" aria-valuemax="75" hidden></div>'+
    '<section id="book-dock" aria-label="Вторая панель" hidden></section></div><div id="book-bottom"></div><span id="book-copy-status" role="status" aria-live="polite"></span>';
  workspace=root.querySelector('#book-workspace');primary=root.querySelector('#book-primary');
  reader=root.querySelector('#reader-view');auxiliary=root.querySelector('#aux-view');
  contentsPanel=root.querySelector('#book-contents');
  const contentsResize=new ResizeObserver(positionContents);
  for(const element of [root,root.querySelector('#book-header'),primary])contentsResize.observe(element);
  document.addEventListener('pointerdown',dismissContentsOutside);
  document.addEventListener('focusin',dismissContentsOutside);
  document.addEventListener('keydown',event=>{
    if(event.key==='Escape'&&!contentsPanel.hidden){
      event.preventDefault();closeContents(true);
    }
  });
  dock=root.querySelector('#book-dock');divider=root.querySelector('#book-divider');
  consolePanel=root.querySelector('#book-console');
  dockTabs=root.querySelector('#dock-tabs');consolePages=root.querySelector('#editor-host');
  new ResizeObserver(revealActiveConsoleTab).observe(dockTabs);
  draftManager=createDraftManager(root.querySelector('#stored-programs'),{
    list:listConsoleDrafts, rename:renameConsoleDraft, open:openConsoleDraft,
    save:moveConsoleToDrafts, remove:removeConsoleDraft
  });
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
function consoleDrafts() {
  return [...store.values].filter(([key,value])=>
    /^(secondary\/)?(editor|scratch|snippet)\//.test(key) && typeof value?.source==='string');
}
function openProgramNames() {
  return [...consoleTabs.values()].map(({entry})=>({key:entry.storageKey,name:entry.title||entry.exampleTitle}));
}
function listConsoleDrafts() {
  const tabs=openProgramNames(), openKeys=new Set(tabs.map(item=>item.key));
  const drafts=consoleDrafts().filter(([key])=>!openKeys.has(key)).map(([key,value])=>({
    key,name:value.title||describeSyncKey(key),pane:key.startsWith('secondary/')?'Вторая панель':''
  }));
  const activeKey=consoleTabs.get(activeConsole)?.entry.storageKey;
  return {active:tabs.find(tab=>tab.key===activeKey)||null,drafts};
}
function occupiedProgramNames(exceptKey) {
  const names=new Set();
  const include=(key,name)=>{if(key!==exceptKey && name)names.add(name.toLocaleLowerCase('ru'));};
  for(const [key,value] of consoleDrafts())include(key,value.title||describeSyncKey(key));
  for(const {key,name} of openProgramNames())include(key,name);
  const peer=secondaryPane?parent:secondaryFrame?.contentWindow;
  const peerTabs=peer?.openProgramNames?.();
  if(peerTabs?.length){
    for(const {key,name} of peerTabs)include(key,name);
  }else{
    const prefix=secondaryPane?'':'secondary/';
    for(const key of store.values.get(prefix+'console-tabs')||[]){
      const entry=store.values.get(prefix+'tab/'+key);
      if(entry && store.values.get(entry.storageKey)!==null)include(entry.storageKey||prefix+key,entry.title||entry.exampleTitle);
    }
  }
  return names;
}
function freeProgramName(base,names) {
  let name=base,number=0;
  while(names.has(name.toLocaleLowerCase('ru')))name=base+' '+(++number);
  return {name,number};
}
function saveConsoleDraft(entry) {
  const saved={source:entry.source,files:entry.files||{},title:entry.title||entry.exampleTitle,version:entry.version};
  if(entry.topicId)saved.topicId=entry.topicId;
  if(/^(secondary\/)?(snippet\/|editor\/general$)/.test(entry.storageKey))saved.initial=entry.initial;
  BookStore.prototype.set.call(store,entry.storageKey,saved);
}
function openConsoleDraft(key) {
  const saved=store.values.get(key);
  if(typeof saved?.source!=='string')return;
  const unscoped=key.replace(/^secondary\//,'');
  const lesson=findLesson(saved.topicId||unscoped.split('/')[1]);
  addConsole({key:unscoped,storageKey:key,source:saved.source,files:saved.files,initial:saved.initial,
    version:saved.version||lesson?.version||10,topicId:lesson?.id,topicTitle:lesson?.title||'',
    exampleTitle:saved.title||describeSyncKey(key)});
}
function renameConsoleDraft(key,name) {
  name=name.trim();
  if(!name || name.length>100 || /[\u0000-\u001f\u007f]/.test(name))return 'Введи название от 1 до 100 символов в одну строку.';
  if(occupiedProgramNames(key).has(name.toLocaleLowerCase('ru')))return 'Программа с таким названием уже есть.';
  const tab=[...consoleTabs.values()].find(item=>item.entry.storageKey===key);
  if(tab){
    tab.entry={...tab.entry,title:name};
    saveConsoleDraft(tab.entry);
    rememberConsoleEntry(tab);
    tab.cleanup?.setTitle(name);
    paintConsoleTabs();
  }else{
    const saved=store.values.get(key);
    if(typeof saved?.source!=='string')return 'Этот черновик уже удалён.';
    BookStore.prototype.set.call(store,key,{...saved,title:name});
    draftManager.refresh();
  }
  return '';
}
function moveConsoleToDrafts() {
  const tab=consoleTabs.get(activeConsole);
  if(!tab)return;
  saveConsoleDraft(tab.entry);
  closeConsole(activeConsole);
}
function removeConsoleDraft(key) {
  const saved=store.values.get(key);
  if(typeof saved?.source!=='string'||openProgramNames().some(tab=>tab.key===key))return null;
  BookStore.prototype.set.call(store,key,null);
  draftManager.refresh();
  return ()=>{
    if(store.values.get(key)!==null)return 'Черновик уже восстановлен или изменён.';
    const names=occupiedProgramNames(key), original=saved.title||describeSyncKey(key);
    const restored=names.has(original.toLocaleLowerCase('ru'))
      ? {...saved,title:freeProgramName(/^Программа(?: \d+)?$/.test(original)?'Программа':original,names).name}
      : saved;
    BookStore.prototype.set.call(store,key,restored);
    draftManager.refresh();
    return '';
  };
}
function rememberConsoleEntry(tab) {
  if(typeof store.values.get(tab.entry.storageKey)?.source==='string')delete tab.entry.openedAfterDelete;
  store.set('tab/'+tab.entry.key,tab.entry);
  if(activeConsole===tab.entry.key)store.set('console',tab.entry);
}
function updateSyncedConsoles(keys) {
  if(![...keys].some(key=>/^(secondary\/)?(editor|scratch|snippet)\//.test(key)))return;
  for(const [key,tab] of [...consoleTabs]) {
    const storageKey=tab.entry.storageKey;
    if(!keys.has(storageKey))continue;
    const draft=store.values.get(storageKey);
    if(draft===null){closeConsole(key);continue;}
    if(typeof draft?.source!=='string')continue;
    tab.entry={...tab.entry,source:draft.source,files:draft.files,title:draft.title};
    rememberConsoleEntry(tab);
    tab.cleanup?.setTitle(tab.entry.title||tab.entry.exampleTitle);
    tab.cleanup?.updateFiles(draft);
  }
  if(state.page==='console')paintConsoleTabs();
}
function revealActiveConsoleTab() {
  const current=consoleTabs.get(activeConsole)?.group;
  if(!current || !dockTabs.clientWidth)return;
  const tab=current.getBoundingClientRect(), strip=dockTabs.getBoundingClientRect();
  if(tab.left<strip.left)dockTabs.scrollLeft+=tab.left-strip.left;
  else if(tab.right>strip.right)dockTabs.scrollLeft+=tab.right-strip.right;
}
function paintConsoleTabs() {
  for(const [key,tab] of consoleTabs) {
    if(!tab.group){
      const group=document.createElement('span'), select=document.createElement('button'), close=document.createElement('button');
      group.className='dock-tab';
      select.onclick=()=>selectConsole(key);
      close.textContent='×';close.onclick=()=>closeConsole(key);
      group.append(select,close);dockTabs.append(group);tab.group=group;
    }
    const [select,close]=tab.group.children;
    const title=tab.entry.title||tab.entry.exampleTitle||'Консоль';
    select.textContent=title;
    select.title=[tab.entry.topicTitle,title].filter(Boolean).join(' · ');
    close.setAttribute('aria-label','Закрыть вкладку «'+title+'»');
    select.setAttribute('aria-pressed',String(activeConsole===key));
  }
  draftManager?.refresh();
  revealActiveConsoleTab();
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
  const hadFocus=tab.group.contains(document.activeElement);
  tab.cleanup?.();tab.host.remove();tab.group.remove();consoleTabs.delete(key);
  if(activeConsole===key){
    if(consoleTabs.size)selectConsole([...consoleTabs.keys()].at(-1));
    else newConsole();
  }else{
    rememberTabs();paintConsoleTabs();
  }
  if(hadFocus)consoleTabs.get(activeConsole)?.group.firstElementChild.focus({preventScroll:true});
}
// Older saved tabs contain only the edited text. Recover their template from
// the course before applying the draft, including tabs opened in the other pane.
function consoleTemplate(entry,storageKey) {
  const [kind,id,...parts]=storageKey.replace(/^secondary\//,'').split('/');
  if(kind==='scratch')return {source:'',files:{}};
  const lesson=findLesson(id==='general'?entry.topicId:id);
  if(kind==='editor' && lesson){
    const example=id==='general'?lesson.examples.find(e=>e.name===entry.exampleTitle):lesson.examples[Number(parts[0])];
    if(example)return {source:example.code,files:example.files||{}};
  }
  if(kind==='snippet' && lesson){
    const task=lesson.exercises.find(item=>item.id===parts[0]);
    const anchor=(task?parts.slice(1):parts).join('/');
    if(anchor==='syntax-guide' && lesson.syntaxGuide)return {source:lesson.syntaxGuide.sample,files:lesson.syntaxGuide.files||{}};
    if(entry.initial && typeof entry.initial.source==='string')return entry.initial;
    // Versions through 0.4.1 stored exercise snippets under a chapter-wide
    // anchor. Recover a source only when the remaining evidence identifies it.
    const candidates=(task?[task]:lesson.exercises).map(exercise=>
      anchor==='solution'?exercise.solution:anchor==='expected-output'?exercise.output:
      anchor.startsWith('source/')?exercise.files?.[anchor.slice(7)]:undefined);
    const originals=[...new Set(candidates.filter(source=>typeof source==='string'))];
    const matches=originals.filter(source=>source && entry.source?.includes(source));
    if(originals.length===1 || matches.length===1)return {source:originals.length===1?originals[0]:matches[0],files:{}};
    if(anchor.startsWith('p-')){
      const source=[lesson.mistake?.wrong,lesson.mistake?.fix,...lesson.examples.map(e=>e.output)].find(
        text=>typeof text==='string' && anchor.startsWith(passageHash(text)+'-'));
      if(source!==undefined)return {source,files:{}};
    }
  }
  return typeof entry.initial?.source==='string'?entry.initial:{source:entry.source,files:entry.files||{}};
}
function addConsole(entry) {
  const storageKey=entry.storageKey||store.scoped(entry.key);
  const key=storageKey===store.scoped(storageKey.replace(/^secondary\//,''))?storageKey.replace(/^secondary\//,''):'linked/'+storageKey;
  if(consoleTabs.has(key)){selectConsole(key);return;}
  const draft=store.values.get(storageKey);
  const initial=consoleTemplate({...entry,initial:entry.initial||draft?.initial},storageKey);
  if(draft)entry={...entry,source:draft.source,files:draft.files,title:draft.title};
  entry={...entry,key,storageKey,initial};
  // A lesson example can be opened afresh after deleting its earlier draft.
  // Remember the observed deletion so a reload keeps this new, unedited tab.
  if(draft===null)entry.openedAfterDelete=true;
  const host=document.createElement('div');host.className='cs-console-page';
  consolePages.append(host);
  const tab={host,entry,cleanup:null};consoleTabs.set(key,tab);store.set('tab/'+key,entry);
  selectConsole(key);
  import('./console.js').then(({mountConsole})=>{
    if(consoleTabs.get(key)!==tab)return;
    tab.cleanup=mountConsole(host,{...tab.entry,showHeader:false,onBack:resumeReading,onChange:(source,files)=>{
      tab.entry={...tab.entry,source,files,openedAfterDelete:false};
      saveConsoleDraft(tab.entry);
      rememberConsoleEntry(tab);
    }});
  }).catch(e=>{host.textContent='Не удалось открыть консоль. '+e.message;});
}
function ensureConsole() {
  if(consoleTabs.size)return;
  const previous=store.get('console',null);
  for(const key of store.get('console-tabs',[])){
    const entry=store.get('tab/'+key,null);
    if(entry && (entry.openedAfterDelete || store.values.get(entry.storageKey||store.scoped(key))!==null))addConsole(entry);
  }
  if(previous && (previous.openedAfterDelete || store.values.get(previous.storageKey||store.scoped(previous.key||'editor/general'))!==null))
    addConsole({...previous,key:previous.key||'editor/general'});
  if(!consoleTabs.size && previous)newConsole();
  if(!consoleTabs.size) addConsole({...defaultEditor(findLesson(state.lesson)),key:'editor/general'});
}
function newConsole() {
  const {name:title,number}=freeProgramName('Программа',occupiedProgramNames());
  const identity=crypto.randomUUID?.()||Array.from(crypto.getRandomValues(new Uint32Array(4)),n=>n.toString(16)).join('-');
  addConsole({key:'scratch/'+number+'/'+identity,source:'',files:{},version:10,topicId:state.lesson,topicTitle:'',exampleTitle:title});
}
function contentsButton(css) {
  return button('menu',icon('menu')+icon('x')+'Содержание',css,
    'id="book-contents-button" aria-controls="book-contents" aria-expanded="'+!contentsPanel.hidden+'"');
}
function dismissContentsOutside(event) {
  if(!contentsPanel.hidden&&!event.target.closest('#book-contents,#book-contents-button'))closeContents();
}
function closeContents(restoreFocus=false) {
  if(!contentsPanel||contentsPanel.hidden)return;
  contentsPanel.hidden=true;
  const toggle=document.getElementById('book-contents-button');
  toggle?.setAttribute('aria-expanded','false');
  if(restoreFocus)toggle?.focus({preventScroll:true});
}
function positionContents() {
  if(contentsPanel.hidden)return;
  const toggle=document.getElementById('book-contents-button');
  if(!toggle?.getClientRects().length){closeContents();return;}
  const frame=root.getBoundingClientRect(), anchor=toggle.getBoundingClientRect();
  const bottomBar=root.querySelector('#book-bottom');
  const bottom=bottomBar.offsetHeight?bottomBar.getBoundingClientRect().top:frame.bottom;
  const left=Math.max(8,Math.min(anchor.right-frame.left-contentsPanel.offsetWidth,frame.width-contentsPanel.offsetWidth-8));
  contentsPanel.style.left=left+'px';
  contentsPanel.style.top=(anchor.bottom-frame.top+4)+'px';
  contentsPanel.style.maxHeight=Math.max(0,bottom-anchor.bottom-12)+'px';
}
function refreshContentsPanel() {
  if(contentsPanel.hidden)return;
  const focused=contentsPanel.contains(document.activeElement)?document.activeElement.dataset.action:null;
  const scroll=contentsPanel.scrollTop;
  contentsPanel.innerHTML=contents();
  contentsPanel.scrollTop=scroll;
  if(focused)contentsPanel.querySelector('[data-action="'+CSS.escape(focused)+'"]')?.focus({preventScroll:true});
}
function toggleContents(keyboard) {
  if(!contentsPanel.hidden){closeContents();return;}
  contentsPanel.hidden=false;
  document.getElementById('book-contents-button').setAttribute('aria-expanded','true');
  refreshContentsPanel();glyphs();positionContents();
  const selected=contentsPanel.querySelector('[aria-current="page"]')||contentsPanel.querySelector('button');
  contentsPanel.scrollTop=0;
  if(selected){
    const offset=selected.getBoundingClientRect().top-contentsPanel.getBoundingClientRect().top;
    contentsPanel.scrollTop=Math.max(0,offset-contentsPanel.clientHeight/3);
    if(keyboard)selected.focus({preventScroll:true});
  }
}
function secondaryHeader(reading) {
  const current=reading?'reader':state.page;
  const options=paneSections.map(([key,title])=>'<option value="'+key+'"'+(key===current?' selected':'')+'>'+title+'</option>').join('');
  return '<header class="pane-header"><select id="pane-section-select" aria-label="Раздел второй панели">'+options+'</select>'+
    (reading?contentsButton('pane-chapters'):'')+'</header>';
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
  addConsole({...entry,initial:{source:entry.source,files:entry.files||{}}});go('console');
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
