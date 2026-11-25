'use strict';
const root = document.getElementById('app');
const store = new PaneStore();
let chapters = [], lessons = [];
const state = {page:'home',lesson:'',step:'',taskFile:'Program.cs',example:0,read:[],saved:[],expanded:[0],started:false};
let feedback='', hideExampleOutput=false, selectedFile='Program.cs';
let detachHints=null;
let cloudSync=null;
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
  const installedApp=window.chrome?.webview || navigator.userAgent.includes('CSharpBookAndroid/');
  const preview=navigator.userAgent.includes('SharpwisePreview/');
  const betaVersion=/\bSharpwiseBeta\/(\d+\.\d+\.\d+_b\.\d+)\b/.exec(navigator.userAgent)?.[1];
  let channel='';
  if (betaVersion) channel='<p>Официальная бета. Следующая стабильная версия установится поверх неё и сохранит твой прогресс.</p>';
  else if (preview) channel='<p>Тестовая сборка. Перед обновлением ты увидишь номер стабильного выпуска.</p>';
  return '<main class="settings-view"><h1>Настройки</h1><p>Sharpwise · Версия '+(betaVersion || '0.4.2')+'</p><fieldset><legend>Оформление учебника</legend>'+
    [['auto','Как в системе'],['light','Светлая тема'],['dark','Тёмная тема']].map(([key,label])=>'<label><input type="radio" name="theme" value="'+key+'" '+(theme===key?'checked':'')+'> '+label+'</label>').join('')+
    '</fieldset><h2>Мой прогресс</h2><p>Прочитано <span id="book-read-count">'+state.read.length+'</span> из '+lessons.length+' глав. Черновики, закладки и прогресс сохраняются на этом устройстве.</p>'+
    solvedList('course')+'<section id="book-cloud-sync" hidden></section>'+
    '<section id="book-updates"><h2>Обновление приложения</h2>'+channel+'<button type="button" class="cs-tool" id="book-update-button">'+
    (installedApp?'Проверить обновления':'Обновить версию')+'</button><p id="book-update-status" role="status" aria-live="polite"></p></section>'+
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
  closeContents();
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
    state.example=0;selectedFile='Program.cs';hideExampleOutput=false;feedback='';
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
  if(!isReading)restoreReadingRoute();
  state.page=destination;
  if(destination==='exit'){split=false;for(const run of exerciseRuns.values())stopExercise(run);exerciseRuns.clear();for(const tab of consoleTabs.values())tab.cleanup?.();consoleTabs.clear();consolePages.replaceChildren();activeConsole='';}
  render(changed||!!pendingNote||(isReading&&!['lesson','chapter'].includes(previous)));
  if(isReading&&(changed||previous!==destination||pendingNote)){
    primary.scrollTop=store.get('position/'+positionKey(),0);revealNote();
  }else if(!isReading&&destination!=='console'&&destination!==previous)primary.scrollTop=pagePositions.get(destination)||0;
}
function sidebar(){
  return '<aside aria-label="Содержание" class="cs-side"><div class="cs-side-title">Содержание</div><div class="cs-sections">'+contents()+'</div><div class="cs-progress">Прочитано <strong>'+state.read.length+' из '+lessons.length+' глав</strong><div class="cs-progress-track"><i style="width:'+100*state.read.length/lessons.length+'%"></i></div></div></aside>';
}
function refreshMarks(updatePage=true) {
  const side=reader.querySelector('.cs-side');
  if(side)side.outerHTML=sidebar();
  refreshContentsPanel();
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
  }
  refreshExerciseProgress();
  if(updatePage)render();
}
function paintReader() {
  const lesson=findLesson(state.lesson);
  const key=lastReading, same=readerKey===key;
  const open=same?[...reader.querySelectorAll('details')].map(d=>d.open):[];
  const task=activeTask();
  detachHints?.();detachHints=null;
  readerKey=key;
  reader.innerHTML='<div class="cs-grid">'+sidebar()+'<main class="cs-content">'+(key.startsWith('chapter/')?chapterView(Number(key.slice(8))):stepStrip(lesson,state.step)+(task?exerciseView(lesson,task):lessonView(lesson)))+'</main></div>';
  reader.querySelectorAll('details').forEach((d,i)=>{if(i<open.length)d.open=open[i];});
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
  document.title=({home:'C# с нуля',lesson:lesson.title,chapter:readingChapter()?.title,saved:'Закладки',console:'Консоль',choose:'Вторая панель',settings:'Настройки',exit:'До встречи'})[page]+' · Sharpwise';
  const splitLabel=split?'Скрыть вторую панель':'Разделить экран';
  root.querySelector('#book-header').innerHTML=secondaryPane?secondaryHeader(reading):'<header class="cs-top">'+button('go:home','<img class="cs-logo" src="icons/book-192.png" width="32" height="32" alt="">Sharpwise','cs-brand','aria-label="Sharpwise — на главную"')+nav('cs-global')+
    '<div class="header-tools">'+(reading?contentsButton('cs-mobile-menu'):'')+
    (full?button('find-course',icon('search'),'settings-icon','aria-label="Поиск по учебнику" title="Поиск по учебнику"'):'')+
    button('dock',icon('columns-2'),'settings-icon'+(split?' on':''),'aria-label="'+splitLabel+'" title="'+splitLabel+'" aria-pressed="'+split+'"')+
    button('go:settings',icon('settings'),'settings-icon'+(page==='settings'?' on':''),'aria-label="Настройки" title="Настройки"')+'</div></header>';
  root.querySelector('#book-bottom').innerHTML=secondaryPane?'':nav('cs-mobile-nav');
  if(!full){
    reader.hidden=!reading;auxiliary.hidden=reading;
    if(reading&&forceReader)paintReader();
    if(page==='choose')auxiliary.innerHTML=choosePaneView();
    if(page==='home'){
      const listOpen=auxiliary.querySelector('.cs-home .solved-tasks')?.open;
      const field=auxiliary.querySelector('#course-query');
      const selection=field && field===document.activeElement ? [field.selectionStart,field.selectionEnd] : null;
      auxiliary.innerHTML='<main class="cs-home">'+homeView(lesson)+'</main>';
      if(listOpen)auxiliary.querySelector('.solved-tasks').open=true;
      mountCourseSearch(auxiliary.querySelector('.course-search'));
      if(selection){
        const search=auxiliary.querySelector('#course-query');
        search.focus({preventScroll:true});
        search.setSelectionRange(...selection);
      }
      mountTopicIndex(auxiliary.querySelector('.topic-index'));
    }
    if(page==='saved')auxiliary.innerHTML='<main class="cs-home">'+bookmarkedPage(lesson)+'</main>';
    if(page==='settings'){
      auxiliary.innerHTML=settingsView();
      cloudSync?.mount(auxiliary.querySelector('#book-cloud-sync'));
    }
    if(page==='exit')auxiliary.innerHTML='<main class="settings-view"><h1>До встречи!</h1><p>'+esc(store.warning||'Прогресс сохранён. Можно закрыть приложение.')+'</p>'+button('go:home','Вернуться в учебник','cs-tool')+'</main>';
  }
  root.querySelector('#book-header').hidden=page==='exit'||page==='choose';root.querySelector('#book-bottom').hidden=page==='exit'||secondaryPane;
  paintWorkspace();glyphs();positionContents();
}
async function copyText(text,trigger) {
  let ok=false;
  try {await navigator.clipboard.writeText(text); ok=true;} catch {
    const input=document.createElement('textarea');input.style.cssText='position:fixed;opacity:0';input.value=text;trigger.after(input);input.select();
    try {ok=document.execCommand('copy');} catch {ok=false;} finally {input.remove();trigger.focus({preventScroll:true});}
  }
  if(trigger.dataset.action==='copy-command'||trigger.dataset.action==='copy-sample'){
    const label=ok?'Скопировано':'Выдели текст';
    trigger.dataset.label=label;
    root.querySelector('#book-copy-status').textContent=ok?'Скопировано.':'Не удалось скопировать. Выдели текст вручную.';
    clearTimeout(trigger.copyFeedbackTimer);
    trigger.copyFeedbackTimer=setTimeout(()=>{trigger.dataset.label='Копировать';},2000);
  }else{
    trigger.setAttribute('aria-live','polite');trigger.textContent=ok?'Скопировано':'Выдели и скопируй текст';
  }
}
root.addEventListener('toggle', e => {
  if (e.target.matches('.solved-tasks[open]')) fillSolvedList(e.target);
}, true);
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
  if(action==='find-course'){
    go('home');
    auxiliary.querySelector('.course-search input')?.focus();
    return;
  }
  if(action==='go') return go(arg);
  if(action==='back') return resumeReading();
  if(action==='open-syntax' && typeof lesson.syntaxGuide?.output==='string'){
    return openConsoleEntry({key:'snippet/'+lesson.id+'/syntax-guide',source:lesson.syntaxGuide.sample,
      files:lesson.syntaxGuide.files||{},version:lesson.version||10,topicId:lesson.id,topicTitle:lesson.title,exampleTitle:'Как устроена запись'});
  }
  if(action==='open-example') return useExample();
  if(action==='open-editor-draft')return useExample();
  if(action==='open-beside')return useExample(true);
  if(action==='run-draft') return runExercise();
  if(action==='run-custom') return runExercise(true);
  if(action==='reset-draft')return resetExercise();
  if(action==='stop-draft')return stopExercise(exerciseRuns.get(readerKey));
  if(action==='copy-command'||action==='copy-sample')return copyText(trigger.dataset.source??trigger.querySelector('code').textContent,trigger);
  if(action==='copy') return copyText(selectedFile==='Program.cs'?example.code:example.files[selectedFile],trigger);
  if(action==='copy-block') return copyText(trigger.closest('.copyable').querySelector('pre').textContent,trigger);
  if(action==='exit') {
    keepReadingPosition();
    history.replaceState(null,'','#exit');route();
    window.chrome?.webview?.postMessage('close');
    return;
  }
  if(action==='menu')return toggleContents(e.detail===0);
  if(!['expand','example','file','toggle-output','answer','save','read','unsave'].includes(action))return;
  if(action==='expand'){
    state.expanded=flip(state.expanded,Number(arg));store.set('expanded',state.expanded);
    if(trigger.closest('#book-contents,.cs-side')){
      const side=reader.querySelector('.cs-side .cs-sections');
      if(side)side.innerHTML=contents();
      refreshContentsPanel();glyphs();
      if(e.detail===0&&contentsPanel.hidden)side?.querySelector('[data-action="expand:'+Number(arg)+'"]')?.focus({preventScroll:true});
      return;
    }
  }
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
function restoreReadingRoute() {
  const route=store.get('last-reading',null);
  if(typeof route!=='string')return;
  const [page,id,step]=route.split('/');
  if(page==='lesson'){
    const lesson=findLesson(id);
    if(!lesson || (step&&!lesson.exercises.some(task=>task.id===step)))return;
    state.lesson=id;
    state.example=Math.max(0,Math.min(lesson.examples.length-1,store.get('example/'+id,0)));
  }else if(page!=='chapter'||!/^\d+$/.test(id)||!chapters[Number(id)])return;
  lastReading=route;state.started=true;
}

function refreshCloudChanges(changes) {
  if(!reader || !changes.length)return;
  const keys=new Set(changes), page=state.page;
  const reading=page==='lesson'||page==='chapter';
  if(!reading && keys.has(store.scoped('last-reading')))restoreReadingRoute();
  const marks=changes.some(key=>/^(read|saved)\//.test(key));
  if(marks){
    syncMarks();refreshMarks(false);
    const count=document.getElementById('book-read-count');
    if(count)count.textContent=state.read.length;
  }
  const solved=changes.some(key=>key.startsWith('solved/'));
  if(solved && !marks)refreshExerciseProgress();
  if(changes.some(key=>key.startsWith('note/')))decorateNoteMarks();
  updateSyncedConsoles(keys);
  if(page==='home' && changes.every(key=>key.startsWith('solved/')))return;
  if(page==='home'||page==='saved'){render();return;}
  if(reading){
    const task=activeTask(), area=reader.querySelector('.cs-draft,.prediction-answer');
    if(task && area){
      const lesson=findLesson(state.lesson);
      const key=draftKey(lesson,task,task.answerMode==='output'?'Program.cs':state.taskFile);
      if(keys.has(store.scoped(key))){
        const value=store.get(key,'');
        if(typeof value==='string'&&area.value!==value){
          const {selectionStart,selectionEnd,selectionDirection,scrollTop}=area;
          area.value=value;
          area.setSelectionRange(selectionStart,selectionEnd,selectionDirection);
          area.scrollTop=scrollTop;
        }
      }
    }else if(page==='lesson' && keys.has(store.scoped('answer/'+state.lesson))) {
      // The theory view has no editable code. Repaint its quiz after receiving the answer.
      paintReader();
    }
  }
  glyphs();
}
function describeSyncKey(key) {
  const [kind, id, step, file]=key.replace(/^secondary\//,'').split('/');
  const lesson=findLesson(id), exercise=lesson?.exercises.find(item=>item.id===step);
  if(kind==='draft')return [lesson?.title || id,exercise?.title || 'Упражнение',file || 'Program.cs'].join(' · ');
  if(kind==='editor')return [lesson?.title || 'Консоль', lesson?.examples[Number(step)]?.name || 'Черновик'].join(' · ');
  if(kind==='scratch')return 'Программа '+id;
  if(kind==='snippet')return [lesson?.title || id, 'Фрагмент кода'].join(' · ');
  if(kind==='note')return 'Заметка';
  return key;
}
window.addEventListener('book-storage',event=>{
  if(event.detail==='theme')applyTheme();
  if(/^(secondary\/)?(last-reading$|read\/|saved\/|solved\/|note\/|answer\/|draft\/|scratch\/|editor\/|snippet\/)/.test(event.detail)) refreshCloudChanges([event.detail]);
});
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
  else {
    import('./sync-ui.js').then(({startCloudSync})=>startCloudSync({
      store, label:window.chrome?.webview?'ПК':navigator.userAgent.includes('Android')?'Android':'Браузер', refresh:refreshCloudChanges, describeKey:describeSyncKey
    })).then(controller=>{
      cloudSync=controller;
      cloudSync?.mount(document.getElementById('book-cloud-sync'));
    }).catch(error=>{
      const section=document.getElementById('book-cloud-sync');
      if(section){section.hidden=false;section.textContent='Синхронизация недоступна. '+error.message;}
      console.error('Cloud sync',error);
    });
    if('serviceWorker' in navigator && !window.chrome?.webview && !navigator.userAgent.includes('CSharpBookAndroid/'))
      navigator.serviceWorker.register('./sw.js').catch(()=>{});
  }
}
boot().catch(e=>{root.innerHTML='<main class="loading" role="alert"><h1>Учебник не открылся</h1><p>'+esc(e.message)+'</p><button onclick="location.reload()">Попробовать снова</button></main>';});



