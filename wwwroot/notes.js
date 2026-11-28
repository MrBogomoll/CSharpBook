'use strict';
let noteMenu,noteDialog,noteContext,editedNote,pendingNote,rightClickSelection;
function decorateNoteMarks() {
  if(!reader)return;
  const anchors=[...reader.querySelectorAll('[data-note-anchor]')];
  const currentNotes=allNotes().filter(note=>note.route===readerKey);
  for(const node of anchors){
    node.querySelector(':scope > button.passage-notes')?.remove();
    const notes=currentNotes.filter(note=>note.anchor===node.dataset.noteAnchor);
    if(!notes.length||!node.matches('p,li'))continue;
    const mark=document.createElement('button');mark.className='passage-notes';mark.type='button';
    mark.setAttribute('aria-label','Заметки к этому абзацу');mark.title='Заметки к этому абзацу';mark.innerHTML=icon('notebook-pen');
    mark.onclick=e=>{const r=mark.getBoundingClientRect();openNoteMenu(node,r.left,r.bottom,e);};
    node.append(mark);
  }
}
function allNotes() {
  return [...store.values].filter(([key,value])=>key.startsWith('note/')&&value)
    .map(([,value])=>value).sort((a,b)=>b.updated-a.updated);
}
function notesList() {
  const notes=allNotes();
  if(!notes.length)return '';
  return '<section class="cs-bm-chapter notes-list"><h2>Мои заметки</h2><ul>'+notes.map(note=>{
    const [page,id,step]=note.route.split('/');
    const lesson=findLesson(id);
    const title=page==='lesson'?[lesson?.title,lesson?.exercises.find(t=>t.id===step)?.title].filter(Boolean).join(' · '):chapters[Number(id)]?.title;
    return '<li>'+button('show-note:'+note.id,'<strong>'+esc(title)+'</strong><q>'+esc(note.quote)+'</q><span>'+esc(note.body)+'</span>','note-link')+
      button('edit-note:'+note.id,icon('pencil'),'note-edit','aria-label="Изменить заметку"')+'</li>';
  }).join('')+'</ul></section>';
}
function passageHash(text) {
  let hash=2166136261;
  for(const c of text)hash=Math.imul(hash^c.charCodeAt(0),16777619);
  return 'p-'+(hash>>>0).toString(36);
}

function markExercisePassages(content,task) {
  const instruction=content.querySelector('.practice-instruction');
  if(!instruction)return;
  if(task.stdin?.length&&instruction.nextElementSibling?.matches('p')){
    instruction.nextElementSibling.dataset.noteAnchor='input-guide';
  }
  const references=content.querySelectorAll('.cp-widget details .cs-snippet');
  const anchors=['expected-output','solution',...Object.keys(task.files||{}).map(name=>'source/'+name)];
  references.forEach((node,i)=>{if(anchors[i])node.dataset.noteAnchor=anchors[i];});
}

function migrateInlineExerciseNotes(lesson,used) {
  const notes=allNotes().filter(note=>note.route===readerKey&&
    (note.example||0)===state.example&&(note.file||'Program.cs')===selectedFile);
  if(!notes.length)return;
  const task=lesson.exercises[0], replacements=new Map();
  // In the first edition, the exercise followed the theory on the same page.
  // Continue its per-hash occurrence counts so repeated text keeps its original owner.
  function oldPassage(text,anchor) {
    const base=passageHash(text.replace(/\r\n?/g,'\n')),index=used.get(base)||0;
    used.set(base,index+1);
    if(anchor)replacements.set(base+'-'+index,anchor);
  }
  oldPassage((task.legacyInstruction||task.instruction).replace(/\x60([^\x60]+)\x60/g,'$1'),'instruction');
  if(task.stdin?.length)oldPassage('Для проверки введи по очереди '+task.stdin.join(', ')+'.','input-guide');
  if(Object.keys(task.files||{}).length){
    oldPassage('Напиши свою часть в Program.cs. Эти файлы будут скомпилированы вместе с ней.');
    for(const [name,source] of Object.entries(task.files))oldPassage(source,'source/'+name);
  }
  oldPassage(task.output,'expected-output');
  oldPassage(task.solution,'solution');
  for(const note of notes){
    const anchor=replacements.get(note.anchor);
    if(!anchor)continue;
    store.set('note/'+note.id,{...note,anchor,route:exercisePath(lesson,task),
      endAnchor:replacements.get(note.endAnchor)||note.endAnchor});
  }
}

function decoratePassages() {
  const content=reader.querySelector('.cs-content');
  if(!content)return;
  const lesson=readerKey.startsWith('lesson/')?findLesson(state.lesson):null;
  const task=lesson?.exercises.find(t=>t.id===state.step);
  if(task)markExercisePassages(content,task);
  const used=new Map();
  for(const node of content.querySelectorAll('p,.cs-walk li,.cs-code-area pre code,.cs-snippet')){
    if(!node.textContent.trim()||node.closest('.cp-console,.project-browser,.bm-links')||node.classList.contains('cs-feedback'))continue;
    if(!node.dataset.noteAnchor){
      // A text-based anchor survives insertion of unrelated paragraphs in later editions.
      const base=passageHash(node.textContent),n=used.get(base)||0;
      used.set(base,n+1);node.dataset.noteAnchor=base+'-'+n;
    }
    if(node.matches('p,.cs-walk li')){
      const action=document.createElement('button');action.className='passage-more';action.type='button';
      action.setAttribute('aria-label','Действия с абзацем');action.title='Действия с абзацем';action.innerHTML=icon('ellipsis');
      action.addEventListener('pointerdown',e=>e.preventDefault());
      action.onclick=e=>{const rect=action.getBoundingClientRect();openNoteMenu(node,rect.left,rect.bottom,e);};
      node.append(action);
    }
  }
  if(lesson&&!task)migrateInlineExerciseNotes(lesson,used);
  decorateNoteMarks();
}
function passageContext(node) {
  const selection=window.getSelection();
  let quote='',start=0,endAnchor='',endOffset=0;
  if(selection?.rangeCount&&!selection.isCollapsed){
    const range=selection.getRangeAt(0);
    if(node.contains(range.startContainer)){
      const prefix=document.createRange();prefix.selectNodeContents(node);prefix.setEnd(range.startContainer,range.startOffset);
      start=prefix.toString().length;
      const inside=range.cloneRange();
      if(!node.contains(inside.endContainer)){
        const end=inside.endContainer.nodeType===1?inside.endContainer:inside.endContainer.parentElement;
        const last=end?.closest('[data-note-anchor]');
        if(last&&reader.contains(last)){
          const suffix=document.createRange();suffix.selectNodeContents(last);suffix.setEnd(inside.endContainer,inside.endOffset);
          endAnchor=last.dataset.noteAnchor;endOffset=suffix.toString().length;
        }else inside.setEnd(node,node.childNodes.length);
      }
      quote=inside.toString();
    }
  }
  return {route:readerKey,anchor:node.dataset.noteAnchor,quote:quote||node.textContent.trim(),start,endAnchor,endOffset,
    example:state.example,file:selectedFile};
}
function menuItem(label,action) {
  const item=document.createElement('button');item.type='button';item.textContent=label;item.setAttribute('role','menuitem');
  item.onclick=()=>{noteMenu.hidden=true;action();};noteMenu.append(item);
}
function setTopicMark(key,ids) {
  const value=!ids.every(id=>store.get(key+'/'+id,false));
  for(const id of ids)store.set(key+'/'+id,value);
  syncMarks();refreshMarks();
}
function openNoteMenu(target,x,y,event) {
  const passage=target.closest('[data-note-anchor]');
  const topic=target.closest('[data-action^="lesson:"]'),chapter=target.closest('[data-action^="expand:"],[data-action^="chapter:"]');
  const inArticle=reader.contains(target)&&target.closest('.cs-content');
  if(!(passage||topic||chapter||inArticle)||target.closest('textarea,input,.cm-editor,.cp-console'))return;
  event?.preventDefault();noteMenu.replaceChildren();
  const context=passage?(rightClickSelection?.node===passage?rightClickSelection.context:passageContext(passage)):null;
  rightClickSelection=null;
  if(context){
    for(const note of allNotes().filter(item=>item.route===context.route&&item.anchor===context.anchor)){
      menuItem('Заметка · '+note.body.slice(0,40),()=>editNote(note));
    }
    menuItem('Добавить заметку',()=>editNote(context));
    menuItem(passage.matches('code,.cs-snippet')?'Копировать код':'Копировать текст',()=>copyNoteQuote(context.quote));
    if(passage.matches('.cs-code-area pre code'))menuItem('Открыть код рядом',()=>useExample(true));
    else if(passage.matches('.cs-snippet'))menuItem('Открыть код рядом',()=>{
      const lesson=findLesson(state.lesson);
      openBeside({key:'snippet/'+context.route.slice('lesson/'.length)+'/'+context.anchor,source:passage.textContent,files:{},version:lesson.version||10,topicId:lesson.id,topicTitle:lesson.title,exampleTitle:'Фрагмент кода'});
    });
  }
  const ids=topic?[topic.dataset.action.slice(7)]:chapter?chapters[Number(chapter.dataset.action.split(':')[1])]?.topics.map(t=>t.id):
    inArticle&&readerKey.startsWith('lesson/')?[state.lesson]:[];
  if(ids?.length){
    const many=ids.length>1;
    menuItem(ids.every(id=>state.read.includes(id))?'Снять отметку о прочтении':many?'Отметить все главы прочитанными':'Отметить прочитанным',()=>setTopicMark('read',ids));
    menuItem(ids.every(id=>state.saved.includes(id))?'Убрать из закладок':many?'Добавить главы в закладки':'Добавить в закладки',()=>setTopicMark('saved',ids));
  }
  if(!noteMenu.childElementCount)return;
  // Keep the quote for the menu actions and dismiss the native selection before opening the menu.
  getSelection()?.removeAllRanges();
  noteMenu.hidden=false;
  noteMenu.style.left=Math.max(4,Math.min(x,innerWidth-noteMenu.offsetWidth-5))+'px';
  noteMenu.style.top=Math.max(4,Math.min(y,innerHeight-noteMenu.offsetHeight-5))+'px';
  if(event?.type==='contextmenu'&&!context?.quote)noteMenu.firstElementChild.focus();
}
async function copyNoteQuote(value) {
  try {await navigator.clipboard.writeText(value);}
  catch {
    const input=document.createElement('textarea');input.style='position:fixed;left:-3000px';document.body.append(input);input.value=value;input.select();document.execCommand('copy');input.remove();
  }
}
function editNote(context) {
  if(!context)return;
  noteContext=context;editedNote=context.id||'';
  noteDialog.querySelector('h2').textContent=editedNote?'Изменить заметку':'Новая заметка';
  noteDialog.querySelector('blockquote').textContent=context.quote;
  noteDialog.querySelector('textarea').value=context.body||'';
  noteDialog.querySelector('[data-delete]').hidden=!editedNote;
  noteDialog.showModal();noteDialog.querySelector('textarea').focus();
}
function goToNote(note) {
  if(!note)return;
  pendingNote=note;
  if(note.route.startsWith('lesson/'))store.set('example/'+note.route.split('/')[1],Number(note.example)||0);
  go(...note.route.split('/'));
}
function revealNote() {
  const note=pendingNote;
  if(!note||readerKey!==note.route)return;
  const current=store.get('note/'+note.id,note);
  if(current&&current.route!==note.route){
    pendingNote=current;
    history.replaceState(null,'','#'+current.route);
    route();
    return;
  }
  pendingNote=null;
  const nodes=[...reader.querySelectorAll('[data-note-anchor]')];
  const node=nodes.find(n=>n.dataset.noteAnchor===note.anchor)||nodes.find(n=>n.textContent.includes(note.quote));
  if(!node){feedback='Этот фрагмент изменился. Цитата сохранена в заметке.';const status=reader.querySelector('[role=status]');if(status)status.textContent=feedback;return;}
  for(let parent=node.parentElement;parent&&parent!==reader;parent=parent.parentElement)if(parent.matches('details'))parent.open=true;
  node.scrollIntoView({block:'center'});node.classList.add('note-flash');setTimeout(()=>node.classList.remove('note-flash'),2500);
  const end=note.endAnchor?nodes.find(n=>n.dataset.noteAnchor===note.endAnchor):node;
  if(!end)return;
  const text=node.textContent,offset=end!==node?note.start:text.slice(note.start,note.start+note.quote.length)===note.quote?note.start:text.indexOf(note.quote);
  if(offset<0)return;
  function point(element,position) {
    const walker=document.createTreeWalker(element,NodeFilter.SHOW_TEXT);
    let part;
    while(part=walker.nextNode()){
      if(position<=part.length)return [part,position];
      position-=part.length;
    }
    return null;
  }
  const start=point(node,offset),finish=point(end,end===node?offset+note.quote.length:note.endOffset);
  if(start&&finish){
    const range=document.createRange();range.setStart(...start);range.setEnd(...finish);
    const selection=getSelection();selection.removeAllRanges();selection.addRange(range);
  }
}
function setupNotes() {
  noteMenu=document.createElement('div');noteMenu.className='book-popup';noteMenu.setAttribute('role','menu');noteMenu.hidden=true;
  noteMenu.addEventListener('contextmenu',e=>e.preventDefault());
  noteDialog=document.createElement('dialog');noteDialog.className='note-dialog';
  noteDialog.innerHTML='<form><h2>Новая заметка</h2><blockquote></blockquote><label>Текст заметки<textarea required rows="4"></textarea></label><div><button type="button" data-delete>Удалить</button><button type="button" data-cancel>Отмена</button><button type="submit">Сохранить</button></div></form>';
  document.body.append(noteMenu,noteDialog);
  noteDialog.querySelector('form').onsubmit=e=>{
    e.preventDefault();const body=noteDialog.querySelector('textarea').value.trim();if(!body)return;
    const id=editedNote||crypto.randomUUID?.()||('n'+Date.now().toString(36)+Math.random().toString(36).slice(2));
    store.set('note/'+id,{...noteContext,id,body,updated:Date.now()});noteDialog.close();
    decorateNoteMarks();glyphs();if(state.page==='saved')render();
  };
  noteDialog.querySelector('[data-cancel]').onclick=()=>noteDialog.close();
  noteDialog.querySelector('[data-delete]').onclick=()=>{store.set('note/'+editedNote,null);noteDialog.close();decorateNoteMarks();glyphs();if(state.page==='saved')render();};
  document.addEventListener('pointerdown',e=>{if(!noteMenu.contains(e.target))noteMenu.hidden=true;});
  document.addEventListener('keydown',e=>{if(e.key==='Escape')noteMenu.hidden=true;});
  let lastPointerType='';
  root.addEventListener('pointerdown',event=>{
    lastPointerType=event.pointerType;rightClickSelection=null;
    const node=event.target.closest('[data-note-anchor]');
    if(event.button===2&&node&&!getSelection().isCollapsed)rightClickSelection={node,context:passageContext(node)};
  },true);
  root.addEventListener('contextmenu',e=>{
    // Some touch browsers report a long press as a mouse context menu.
    if(e.pointerType==='touch'||e.sourceCapabilities?.firesTouchEvents||
       lastPointerType==='touch'||matchMedia('(pointer: coarse)').matches)return;
    openNoteMenu(e.target,e.clientX,e.clientY,e);
  });
  root.addEventListener('click',e=>{
    const action=e.target.closest('[data-action]')?.dataset.action||'', [type,id]=action.split(':');
    if(type==='edit-note')editNote(store.get('note/'+id,null));
    if(type==='show-note')goToNote(store.get('note/'+id,null));
  });
}
