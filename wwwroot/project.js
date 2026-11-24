const descriptions=[
  ['Program.cs','Здесь начинается приложение. Прочитай верхние команды по порядку и найди места, где программа создаёт расходы и обращается к отчёту.'],
  ['Expense.cs','Модель расхода хранит данные одной покупки. В имени файла использовано имя типа Expense. Так проще найти определение, встретив Expense в другом файле.'],
  ['ExpenseReport.cs','Здесь собраны операции над расходами для отчёта. Если меняется способ подсчёта итога, начни поиск с этого файла.'],
  ['.csproj','Файл проекта сообщает инструментам .NET, что и для какой версии собирать. В обычном проекте SDK файлы .cs во вложенных папках включаются автоматически.'],
  ['.slnx','Файл решения объединяет проекты для совместной работы. В одном решении можно держать саму программу и отдельный проект с её тестами.'],
  ['.sln','Файл решения объединяет проекты для совместной работы.'],
  ['.md','Это документ для человека. Его можно открыть в текстовом редакторе и прочитать порядок запуска.']
];
const notes={Models:'Здесь собраны типы, описывающие данные программы.',Reports:'Здесь лежит код построения отчётов.',before:'Начальная версия примера.',after:'Версия после разделения кода.'};
export async function showProject(parent,{esc,icon,copyable,glyphs}) {
  try{
    const response=await fetch('./projects/structure.json');
    if(!response.ok) throw Error();
    const files=await response.json(),tree={};
    if(!parent.isConnected)return;
    for (const path of Object.keys(files)) {
      const pieces=path.split('/');let branch=tree;
      for(const part of pieces.slice(0,-1))branch=branch[part]??={};
      branch[pieces.at(-1)]=path;
    }
    const list=(branch)=>Object.entries(branch).sort(([a,x],[b,y])=>(typeof x==='string')-(typeof y==='string')||a.localeCompare(b)).map(([name,value])=>{
      if(typeof value==='string') return '<li><button type="button" data-project-file="'+esc(value)+'">'+icon('file-code')+esc(name)+'</button></li>';
      return '<li><details open><summary>'+icon('folder')+' '+esc(name)+'</summary>'+(notes[name]?'<small>'+esc(notes[name])+'</small>':'')+'<ul>'+list(value)+'</ul></details></li>';
    }).join('');
    parent.innerHTML='<h3>Посмотри, как устроен проект</h3><p>Выбери файл в дереве. Откроется его содержимое из архива этого урока.</p><div class="project-browser"><ul class="project-files">'+list(tree)+'</ul><div class="project-file-content"></div></div><p>После сборки рядом с файлом проекта появятся папки <code>bin</code> с результатом сборки и <code>obj</code> с промежуточными файлами. Инструменты .NET создают их автоматически.</p>';
    const choose=path=>{
      for(const b of parent.querySelectorAll('[data-project-file]'))b.setAttribute('aria-pressed',String(b.dataset.projectFile===path));
      const note=descriptions.find(([extension])=>path.endsWith(extension))?.[1]||'Исходный код проекта. Обрати внимание на имя типа и на то, какие задачи выполняют его методы.';
      parent.querySelector('.project-file-content').innerHTML='<strong>'+esc(path)+'</strong><p>'+esc(note)+'</p>'+copyable(files[path].trimEnd());
      glyphs();
    };
    parent.addEventListener('click',e=>{const file=e.target.closest('[data-project-file]');if(file)choose(file.dataset.projectFile);});
    const first=Object.keys(files).find(path=>path.endsWith('Program.cs'));
    choose(first);
  }catch{ if(parent.isConnected)parent.innerHTML='<p>Скачай архив ниже, чтобы посмотреть все файлы проекта.</p>'; }
}

