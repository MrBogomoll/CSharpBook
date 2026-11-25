'use strict';
const root = document.getElementById('app');
const store = new PaneStore();
let chapters = [], lessons = [];
const state = {page:'home',lesson:'',step:'',taskFile:'Program.cs',example:0,read:[],saved:[],expanded:[0],started:false};
let feedback='', menuOpen=false, hideExampleOutput=false, selectedFile='Program.cs';
let detachHints=null;
let scrollTimer=null;
const pagePositions=new Map();
if ('scrollRestoration' in history) history.scrollRestoration='manual';
function keepReadingPosition() {
  clearTimeout(scrollTimer);
  if(primary&&!primary.hidden&&readerKey&&!reader.hidden)store.set('position/'+positionKey(),Math.round(primary.scrollTop));
}
function positionKey(){return readerKey.startsWith('lesson/')?readerKey.slice(7):readerKey;}
window.addEventListener('pagehide',keepReadingPosition);
const findLesson = id => lessons.find(lesson=>lesson.id===id);
const chapterIndex = id => chapters.findIndex(chapter=>chapter.topics.some(topic=>topic.id===id));
const esc = value => String(value??'').replace(/[&<>"']/g, char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const icon = name => '<i data-lucide="'+esc(name)+'" aria-hidden="true"></i>';
const button = (action,label,css='',attrs='') => '<button type="button" data-action="'+esc(action)+'" class="'+esc(css)+'" '+attrs+'>'+label+'</button>';
const flip = (list,item) => list.includes(item)?list.filter(x=>x!==item):[...list,item];
const glyphs = () => window.lucide?.createIcons({attrs:{width:16,height:16}});
const copyable = code => '<div class="copyable"><div class="copy-line">'+button('copy-block',icon('copy')+'Копировать','copy-small')+'</div><pre class="cs-snippet">'+esc(code)+'</pre></div>';
function projectLink(lesson) {
  const tour=lesson.id==='split-project'?'<section class="project-tour"></section>':'';
  return tour+(lesson.projectUrl ? '<a class="project-download" download href="'+esc(lesson.projectUrl)+'">'+icon('download')+'Скачать учебный проект</a>' : '');
}
function fileTabs(example) {
  const names = Object.keys(example.files||{}).filter(x=>x!=='Program.cs');
  return names.length ? '<div class="file-tabs" aria-label="Файлы примера">'+['Program.cs',...names].map((name,i)=>button('file:'+i,esc(name),'file-tab'+(name===selectedFile?' current':''),'aria-pressed="'+(name===selectedFile)+'"')).join('')+'</div>' : '';
}
function exampleInput(example) {
  if(!example.stdin?.length) return '';
  const values=example.stdin.map(value=>'<kbd>'+esc(value || 'пустая строка')+'</kbd>').join(' → ');
  return '<p class="sample-input">При запуске введи '+values+' и нажми Enter после каждой строки.</p>';
}
function applyTheme() {
  document.documentElement.style.colorScheme = ({light:'light',dark:'dark'})[store.get('theme','auto')] || 'light dark';
}
function syncMarks() {
  state.saved=lessons.filter(t=>store.get('saved/'+t.id,false)).map(t=>t.id);
  state.read=lessons.filter(t=>store.get('read/'+t.id,false)).map(t=>t.id);
}
function settingsView() {
  const theme=store.get('theme','auto');
  return '<main class="settings-view"><h1>Настройки</h1><p>Учебник C# · Версия 0.2.0</p><fieldset><legend>Оформление учебника</legend>'+
    [['auto','Как в системе'],['light','Светлая тема'],['dark','Тёмная тема']].map(([key,label])=>'<label><input type="radio" name="theme" value="'+key+'" '+(theme===key?'checked':'')+'> '+label+'</label>').join('')+
    '</fieldset><h2>Мой прогресс</h2><p>Прочитано '+state.read.length+' из '+lessons.length+' глав. Закладки, место остановки и черновики сохраняются в этом браузере.</p>'+
    '<section id="book-updates"><h2>Обновление приложения</h2><button type="button" class="cs-tool" id="book-update-button">Обновить версию</button><p id="book-update-status" role="status" aria-live="polite"></p></section>'+
    (store.warning?'<p role="alert">'+esc(store.warning)+'</p>':'')+
    button('exit',icon('log-out')+'Выйти из приложения','cs-tool')+'</main>';
}
function defaultEditor(lesson) {
  const example=lesson.examples[state.example];
  return {source:example.code,files:example.files||{},version:example.version||lesson.version||10,topicId:lesson.id,topicTitle:lesson.title,exampleTitle:example.name};
}
function useExample(beside=false) {
  const lesson=findLesson(state.lesson), seed=defaultEditor(lesson), key='editor/'+lesson.id+'/'+state.example;
  if(beside)openBeside({...seed,key});else openConsoleEntry({...seed,key});
}
function go(page,id,step) {
  keepReadingPosition();
  const hash='#'+page+(id!=null?'/'+encodeURIComponent(id):'')+(step?'/'+encodeURIComponent(step):'');
  if(location.hash!==hash) {
    if(secondaryPane)history.replaceState(null,'',hash);else history.pushState(null,'',hash);
  }
  route();
}
function route() {
  if(!primary)return;
  keepReadingPosition();noteMenu.hidden=true;selectionTool.hidden=true;
  const [page,arg,stepId]=location.hash.slice(1).split('/');
  const destination=page==='lesson'&&findLesson(arg)?'lesson':page==='chapter'&&/^\d+$/.test(arg)&&chapters[Number(arg)]?'chapter':
    secondaryPane&&page==='choose'?'choose':(secondaryPane?['console','saved']:['console','settings','saved','exit']).includes(page)?page:'home';
  const isReading=destination==='lesson'||destination==='chapter';
  const step=destination==='lesson'?findLesson(arg).exercises.find(task=>task.id===stepId):null;
  const key=isReading?destination+'/'+arg+(step?'/'+step.id:''):'', previous=state.page;
  const changed=isReading&&key!==readerKey;
  if(['home','saved','settings'].includes(previous))pagePositions.set(previous,primary.scrollTop);
  if(changed){
    detachHints?.();detachHints=null;
    state.taskFile='Program.cs';
    state.example=0;selectedFile='Program.cs';hideExampleOutput=false;feedback='';menuOpen=false;
  }
  if(destination==='lesson'){
    state.lesson=arg;state.step=step?.id||'';store.set('last',arg);
    state.example=Math.max(0,Math.min(findLesson(arg).examples.length-1,store.get('example/'+arg,0)));
    if(pendingNote)selectedFile=pendingNote.file||'Program.cs';
  }
  if(isReading){
    state.started=true;lastReading=key;store.set('last-reading',key);
    const index=destination==='lesson'?chapterIndex(arg):Number(arg);
    if(!state.expanded.includes(index))state.expanded.push(index);
  }
  state.page=destination;
  if(destination==='exit'){split=false;for(const run of exerciseRuns.values())stopExercise(run);exerciseRuns.clear();for(const tab of consoleTabs.values())tab.cleanup?.();consoleTabs.clear();consolePages.replaceChildren();activeConsole='';}
  render(changed||!!pendingNote);
  if(isReading&&(changed||previous!==destination||pendingNote)){
    primary.scrollTop=store.get('position/'+positionKey(),0);revealNote();
  }else if(!isReading&&destination!=='console'&&destination!==previous)primary.scrollTop=pagePositions.get(destination)||0;
}
function sidebar(){
  return '<aside aria-label="Содержание" class="cs-side'+(menuOpen?' open':'')+'"><div class="cs-side-title">Содержание</div><div class="cs-sections">'+contents()+'</div><div class="cs-progress">Прочитано <strong>'+state.read.length+' из '+lessons.length+' глав</strong><div class="cs-progress-track"><i style="width:'+100*state.read.length/lessons.length+'%"></i></div></div></aside>';
}
function refreshMarks() {
  const side=reader.querySelector('.cs-side');
  if(side)side.outerHTML=sidebar();
  if(readerKey.startsWith('lesson/')){
    const id=readerKey.split('/')[1];
    for(const [action,list,off,on,offIcon,onIcon] of [
      ['read',state.read,'Отметить прочитанным','Прочитано','circle','circle-check'],
      ['save',state.saved,'В закладки','В закладках','bookmark-plus','bookmark-check']
    ]){
      const control=reader.querySelector('[data-action="'+action+'"]');
      if(!control)continue;
      const marked=list.includes(id);
      control.setAttribute('aria-pressed',String(marked));control.classList.toggle('on',marked);
      control.innerHTML=icon(marked?onIcon:offIcon)+(marked?on:off);
    }
    const status=reader.querySelector('.bm-links [role=status]');if(status)status.textContent=feedback;
  } else if(readerKey.startsWith('chapter/')){
    const chapter=chapters[Number(readerKey.slice(8))];
    for(const link of reader.querySelectorAll('.chapter-sequence [data-action]')){
      const topic=chapter.topics.find(t=>'lesson:'+t.id===link.dataset.action);
      if(topic)link.innerHTML=icon(state.read.includes(topic.id)?'circle-check':'circle')+esc(topic.title);
    }
  }
  render();
}
function paintReader() {
  const lesson=findLesson(state.lesson);
  const key=lastReading, same=readerKey===key;
  const open=same?[...reader.querySelectorAll('details')].map(d=>d.open):[];
  const task=activeTask();
  detachHints?.();detachHints=null;
  readerKey=key;
  reader.innerHTML='<div class="cs-grid">'+sidebar()+'<main class="cs-content">'+(key.startsWith('chapter/')?chapterView(Number(key.slice(8))):stepStrip(lesson,state.step)+(task?exerciseView(lesson,task):lessonView(lesson)))+'</main></div>';
  reader.querySelectorAll('details').forEach((d,i)=>{if(open[i])d.open=true;});
  decoratePassages();
  const area=reader.querySelector('.cs-draft');
  if(area)import('./editor/completion.js').then(({attachLessonCompletions})=>{
    if(area.isConnected)detachHints=attachLessonCompletions(area,{version:task.version||lesson.version||10,files:exerciseFiles(lesson,task),fileName:state.taskFile});
  });
  const tour=reader.querySelector('.project-tour');
  if(tour)import('./project.js').then(m=>{if(tour.isConnected)m.showProject(tour,{esc,icon,copyable,glyphs});});
  showExerciseResult();
}
function render(forceReader=false) {
  const lesson=findLesson(state.lesson), page=state.page;
  const reading=page==='lesson'||page==='chapter', full=page==='console';
  document.title=({home:'C# с нуля',lesson:lesson.title,chapter:readingChapter()?.title,saved:'Закладки',console:'Консоль',choose:'Вторая панель',settings:'Настройки',exit:'До встречи'})[page]+' · Учебник C#';
  const splitLabel=split?'Скрыть вторую панель':'Разделить экран';
  root.querySelector('#book-header').innerHTML=secondaryPane?secondaryHeader(reading):'<header class="cs-top">'+button('go:home','<span class="cs-logo" aria-hidden="true">C#</span>Учебник C#','cs-brand','aria-label="На главную"')+nav('cs-global')+
    '<div class="header-tools">'+(reading?button('menu',icon(menuOpen?'x':'menu')+'Содержание','cs-mobile-menu','aria-expanded="'+menuOpen+'"'):'')+
    button('dock',icon('columns-2'),'settings-icon'+(split?' on':''),'aria-label="'+splitLabel+'" title="'+splitLabel+'" aria-pressed="'+split+'"')+
    button('go:settings',icon('settings'),'settings-icon'+(page==='settings'?' on':''),'aria-label="Настройки" title="Настройки"')+'</div></header>';
  root.querySelector('#book-bottom').innerHTML=secondaryPane?'':nav('cs-mobile-nav');
  if(!full){
    reader.hidden=!reading;auxiliary.hidden=reading;
    if(reading&&forceReader)paintReader();
    if(page==='choose')auxiliary.innerHTML=choosePaneView();
    if(page==='home')auxiliary.innerHTML='<main class="cs-home">'+homeView(lesson)+'</main>';
    if(page==='saved')auxiliary.innerHTML='<main class="cs-home">'+bookmarkedPage(lesson)+'</main>';
    if(page==='settings')auxiliary.innerHTML=settingsView();
    if(page==='exit')auxiliary.innerHTML='<main class="settings-view"><h1>До встречи!</h1><p>'+esc(store.warning||'Прогресс сохранён. Можно закрыть приложение.')+'</p>'+button('go:home','Вернуться в учебник','cs-tool')+'</main>';
  }
  root.querySelector('#book-header').hidden=page==='exit'||page==='choose';root.querySelector('#book-bottom').hidden=page==='exit'||secondaryPane;
  paintWorkspace();glyphs();
}
async function copyText(text,trigger) {
  let ok=false;
  try {await navigator.clipboard.writeText(text); ok=true;} catch {
    const input=document.createElement('textarea');input.style.cssText='position:fixed;opacity:0';input.value=text;trigger.after(input);input.select();
    try {ok=document.execCommand('copy');} finally {input.remove();trigger.focus({preventScroll:true});}
  }
  trigger.setAttribute('aria-live','polite');trigger.textContent=ok?'Скопировано':'Выдели и скопируй текст';
}
root.addEventListener('click',e=>{
  const trigger=e.target.closest('[data-action]');
  if(!trigger || trigger.closest('#editor-host')) return;
  const [action,arg]=trigger.dataset.action.split(':');
  const lesson=findLesson(state.lesson), example=lesson.examples[state.example];
  if(action==='step')return go('lesson',lesson.id,arg);
  if(action==='task-file'){
    const task=activeTask();if(!task)return;
    const name=['Program.cs',...Object.keys(task.files||{})][Number(arg)];
    if(name){state.taskFile=name;paintReader();glyphs();}
    return;
  }
  if(action==='chapter') return go('chapter',arg);
  if(action==='dock')return toggleDock();
  if(action==='new-console')return newConsole();
  if(action==='lesson') return go('lesson',arg);
  if(action==='go') return go(arg);
  if(action==='back') return resumeReading();
  if(action==='open-example') return useExample();
  if(action==='open-editor-draft')return useExample();
  if(action==='open-beside')return useExample(true);
  if(action==='run-draft') return runExercise();
  if(action==='stop-draft')return stopExercise(exerciseRuns.get(readerKey));
  if(action==='copy') return copyText(selectedFile==='Program.cs'?example.code:example.files[selectedFile],trigger);
  if(action==='copy-block') return copyText(trigger.closest('.copyable').querySelector('pre').textContent,trigger);
  if(action==='exit') {
    keepReadingPosition();
    history.replaceState(null,'','#exit');route();
    window.chrome?.webview?.postMessage('close');
    return;
  }
  if(!['menu','expand','example','file','toggle-output','answer','save','read','unsave'].includes(action))return;
  if(action==='menu'){menuOpen=!menuOpen;reader.querySelector('.cs-side')?.classList.toggle('open',menuOpen);render();return;}
  if(action==='expand') {state.expanded=flip(state.expanded,Number(arg));store.set('expanded',state.expanded);}
  if(action==='example') { state.example=Number(arg);selectedFile='Program.cs';store.set('example/'+lesson.id,state.example); }
  if(action==='file') selectedFile=['Program.cs',...Object.keys(example.files||{}).filter(x=>x!=='Program.cs')][Number(arg)]||'Program.cs';
  if(action==='toggle-output') hideExampleOutput=!hideExampleOutput;
  if(action==='answer') store.set('answer/'+lesson.id,Number(arg));
  if(action==='save'||action==='read'||action==='unsave') {
    const key=action==='read'?'read/':'saved/', id=arg||lesson.id;
    const marked=action==='unsave'?false:!store.get(key+id,false);
    store.set(key+id,marked);syncMarks();
    feedback=action==='read'?(marked?'Глава отмечена как прочитанная.':'Отметка снята.'):(marked?'Глава сохранена в закладки.':'Закладка снята.');
  }
  if(['read','save','unsave'].includes(action))refreshMarks();else render(['lesson','chapter'].includes(state.page));
  if(e.detail===0) [...root.querySelectorAll('[data-action]')].find(x=>x.dataset.action===trigger.dataset.action&&x.offsetWidth)?.focus({preventScroll:true});
});
root.addEventListener('change',e=>{if(e.target.name==='theme'){store.set('theme',e.target.value);applyTheme();}});
root.addEventListener('input',e=>{
  if(e.target.matches('.cp-input input')){
    const run=exerciseRuns.get(readerKey);if(run)run.input=e.target.value;
  }else if(e.target.matches('.cs-draft,.prediction-answer')){
    const lesson=findLesson(state.lesson),task=activeTask();if(!task)return;
    store.set(draftKey(lesson,task,task.answerMode==='output'?'Program.cs':state.taskFile),e.target.value);
    const run=exerciseRuns.get(readerKey);
    if(run&&!run.running){run.status='Ответ изменён. Проверь его ещё раз.';run.error=false;showExerciseResult();}
  }
});
root.addEventListener('keydown',e=>{if(e.target.matches('.cs-draft,.prediction-answer')&&(e.ctrlKey||e.metaKey)&&e.key==='Enter'){e.preventDefault();runExercise();}});
root.addEventListener('submit',e=>{
  if(!e.target.matches('.cp-input'))return;
  e.preventDefault();const run=exerciseRuns.get(readerKey);
  if(!run?.awaiting)return;
  const input=e.target.querySelector('input');run.awaiting=false;run.status='Программа выполняется…';run.handle?.sendInput(input.value);run.input='';showExerciseResult();
});
window.addEventListener('book-storage',e=>{if(e.detail==='theme')applyTheme();if(e.detail.startsWith('solved/'))refreshStepMarks();if(/^(read|saved)\//.test(e.detail)){syncMarks();refreshMarks();}if(e.detail.startsWith('note/')){decorateNoteMarks();if(state.page==='saved')render();else glyphs();}});
function migrateLoopExample() {
  if(store.get('migrated-loop-example',false))return;
  const oldKey='editor/while-foreach/0', newKey='editor/while-loop/0', draft=store.get(oldKey,null);
  if(draft){
    if(!store.get(newKey,null))store.set(newKey,draft);
    store.set(oldKey,null);
  }
  const previous=store.get('console',null), lesson=findLesson('while-loop');
  if(previous?.key===oldKey&&lesson)store.set('console',{...previous,key:newKey,topicId:lesson.id,topicTitle:lesson.title,exampleTitle:lesson.examples[0].name});
  store.set('migrated-loop-example',true);
}
async function boot() {
  const response=await fetch('./course.json');
  if(!response.ok)throw Error('Не удалось загрузить главы.');
  chapters=await response.json();lessons=chapters.flatMap(c=>c.topics);
  await store.open();
  migrateLoopExample();
  applyTheme();syncMarks();
  const fallbackReading=secondaryPane?parent.lastPaneReading():'chapter/0';
  const last=store.get('last',secondaryPane&&fallbackReading.startsWith('lesson/')?fallbackReading.split('/')[1]:'');
  state.started=!!findLesson(last);state.lesson=state.started?last:lessons[0].id;
  state.expanded=store.get('expanded',[chapterIndex(state.lesson)]).slice();
  if(location.hash==='#exit')history.replaceState(null,'','#home');
  lastReading=store.get('last-reading',secondaryPane?fallbackReading:state.started?'lesson/'+last:'chapter/0');
  if(!(lastReading.startsWith('lesson/')&&findLesson(lastReading.split('/')[1])||/^chapter\/\d+$/.test(lastReading)&&chapters[Number(lastReading.slice(8))]))lastReading='chapter/0';
  state.started=state.started||store.get('last-reading','')!=='';
  if(!secondaryPane&&!location.hash&&store.get('split-open',false)){
    history.replaceState(null,'','#'+store.get('active-route','home'));
  }
  createWorkspace();setupNotes();window.addEventListener('hashchange',route);route();
  if(secondaryPane)parent.secondaryReady(window);
  else if ('serviceWorker' in navigator && !window.chrome?.webview && !navigator.userAgent.includes('CSharpBookAndroid/')) navigator.serviceWorker.register('./sw.js').catch(()=>{});
}
boot().catch(e=>{root.innerHTML='<main class="loading" role="alert"><h1>Учебник не открылся</h1><p>'+esc(e.message)+'</p><button onclick="location.reload()">Попробовать снова</button></main>';});



