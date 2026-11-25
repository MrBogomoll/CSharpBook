'use strict';

const typeFamilies = [
  {
    title:'Целые числа со знаком', icon:'minus',
    entries:[
      ['sbyte','System.SByte','8 бит, от −128 до 127. Подходит для маленького смещения, которое может быть отрицательным.','sbyte offset = -7;'],
      ['short','System.Int16','16 бит, от −32 768 до 32 767. Например, один отсчёт 16-битной звукозаписи.','short sample = -1200;'],
      ['int','System.Int32','32 бита, от −2 147 483 648 до 2 147 483 647. Обычный выбор для счётчиков, очков и индексов.','int score = 1500;'],
      ['long','System.Int64','64 бита, от −2⁶³ до 2⁶³ − 1. Для счётчика, который может перерасти диапазон int. Буква L указывает тип литерала.','long views = 5_000_000_000L;']
    ]
  },
  {
    title:'Целые числа без знака', icon:'plus',
    entries:[
      ['byte','System.Byte','8 бит, от 0 до 255. Один байт данных или яркость одного цветового канала.','byte red = 255;'],
      ['ushort','System.UInt16','16 бит, от 0 до 65 535. В этом диапазоне помещается номер сетевого порта.','ushort port = 8080;'],
      ['uint','System.UInt32','32 бита, от 0 до 4 294 967 295. Подходит для беззнакового поля в формате файла. Суффикс u задаёт беззнаковый литерал.','uint flags = 4_000_000_000u;'],
      ['ulong','System.UInt64','64 бита, от 0 до 2⁶⁴ − 1. Например, большой счётчик байтов. Суффикс UL задаёт литерал ulong.','ulong bytes = 10_000_000_000UL;']
    ]
  },
  {
    title:'Дробные числа', icon:'calculator',
    entries:[
      ['float','System.Single','32 бита, примерно 6–9 значащих цифр. Удобен для координат в игре. Дроби хранятся в двоичной системе, возможны ошибки округления. Суффикс f задаёт float.','float speed = 3.5f;'],
      ['double','System.Double','64 бита, примерно 15–17 значащих цифр. Подходит для расстояний и научных вычислений. Дробный литерал с точкой по умолчанию имеет этот тип.','double distance = 42.195;'],
      ['decimal','System.Decimal','128 бит, 28–29 значащих цифр. Для цен и сумм, где важно точно представить десятичные дроби вроде 0.1. Суффикс m задаёт decimal.','decimal price = 19.90m;']
    ]
  },
  {
    title:'Текст и логика', icon:'type',
    entries:[
      ['char','System.Char','Одна 16-битная единица UTF-16. Букву или знак записывают в одинарных кавычках. Для многих эмодзи нужны две такие единицы.','char grade = \'A\';'],
      ['string','System.String','Строка любой допустимой длины, в том числе пустая. Текст пишут в двойных кавычках. В строке "08" сохраняется первый ноль.','string code = "08";'],
      ['bool','System.Boolean','Значение true или false. Удобно для переключателя или результата сравнения, который затем проверит if.','bool isOpen = true;']
    ]
  },
  {
    title:'Объекты и динамические вызовы', icon:'box',
    entries:[
      ['object','System.Object','Общий базовый тип. В переменную можно поместить, например, число или строку. Проверка «item is string text» даст доступ к строковым операциям через text.','object item = "ключ";'],
      ['dynamic','System.Object в .NET','Вызов метода или обращение к свойству проверяется во время выполнения. У строки есть свойство Length, поэтому здесь length получит значение 4.','dynamic item = "ключ";\nint length = item.Length;']
    ]
  },
  {
    title:'Целые размером с указатель', icon:'cpu',
    entries:[
      ['nint','System.IntPtr','Знаковое целое. В 32-битном процессе имеет диапазон int, в 64-битном — long. Встречается при работе с нативными библиотеками.','nint offset = -16;'],
      ['nuint','System.UIntPtr','Беззнаковое целое. В 32-битном процессе имеет диапазон uint, в 64-битном — ulong. Например, размер буфера в нативном API.','nuint length = 4096;']
    ]
  },
  {
    title:'Из чего строятся другие типы', icon:'layers',
    preview:'Массивы, кортежи, свои типы и обобщения',
    entries:[
      ['T[]','Массив','Последовательность элементов одного типа. Здесь int задаёт тип элемента, а [] обозначает массив. После создания его длина фиксирована.','int[] scores = [10, 20];'],
      ['(T1, T2)','Кортеж','Объединяет несколько значений. Элементы могут иметь разные типы и имена. В примере position.X даёт 3.','(int X, int Y) position = (3, 5);'],
      ['enum','Перечисление','Задаёт имена для целочисленных значений. Переменная типа Mode может хранить выбранный режим, например Mode.Pause.','enum Mode { Play, Pause }'],
      ['struct','Структура','Тип-значение. При обычном присваивании копируются поля. readonly struct ограничивает изменение состояния, а ref struct ограничивает время жизни значения.','struct Point { public int X, Y; }'],
      ['class','Класс','Ссылочный тип с данными и поведением. Две переменные могут ссылаться на один экземпляр игрока.','class Player { public int Score; }'],
      ['record','Запись','record и record class объявляют ссылочный тип, record struct — тип-значение. У записей есть сравнение по значениям их компонентов.','record Item(string Name, int Price);'],
      ['interface','Интерфейс','Описывает, какие операции поддерживает тип. Например, любой объект, реализующий IReadable, можно попросить прочитать текст.','interface IReadable { string Read(); }'],
      ['delegate','Делегат','Тип для ссылки на совместимый метод. Здесь подойдёт метод, который принимает два int и возвращает int. Action и Func — готовые семейства делегатов .NET.','delegate int Compare(int a, int b);'],
      ['T / List<T>','Параметр типа и обобщение','T занимает место будущего типа. В List<string> подставлен string, поэтому в список можно добавлять строки. List — класс библиотеки .NET.','List<string> names = ["Аня", "Лев"];'],
      ['new { … }','Анонимный тип','Компилятор создаёт класс со свойствами из перечисленных значений. В примере доступны hit.Name и hit.Damage.','var hit = new { Name = "Лёд", Damage = 8 };'],
      ['union','Объединение · C# 15 / .NET 11','Объявляет тип с перечисленными вариантами. В Result можно положить число или строку и разобрать вариант с помощью switch.','union Result(int, string);'],
      ['closed class','Закрытая иерархия · C# 15 / .NET 11','Модификатор closed ограничивает объявление прямых наследников сборкой базового класса. Это помогает проверить полноту разбора вариантов.','closed class Shape { }\nsealed class Circle : Shape { }']
    ]
  },
  {
    title:'Особые записи', icon:'braces',
    preview:'Знак вопроса, var, void и указатели',
    entries:[
      ['int?','Nullable<int>','Значимый тип с дополнительным состоянием null. Подходит, пока счёт неизвестен. Ноль остаётся настоящим числом очков.','int? score = null;'],
      ['string?','Аннотация ссылочного типа','При включённой проверке nullable компилятор учитывает, что строковая ссылка может быть null. Перед обращением к Length значение можно проверить.','string? nickname = null;'],
      ['var','Вывод типа','Компилятор выводит тип локальной переменной из выражения справа. Здесь он выбирает int, и это решение сохраняется при следующих присваиваниях.','var score = 10;'],
      ['void','Метод без результата','Сообщает, что метод выполняет действие и ничего не возвращает вызывающему коду. В скобках после имени перечисляются параметры.','void Greet() => Console.WriteLine("Привет");'],
      ['T*','Указатель · unsafe','Хранит адрес значения неуправляемого типа. В этом примере int* означает указатель на int. Для такой записи нужен контекст unsafe.','int* address = null;'],
      ['delegate*','Указатель на функцию · unsafe','Хранит адрес функции с заданной сигнатурой. В примере первый int задаёт тип параметра, второй — тип результата.','delegate*<int, int> transform = null;']
    ]
  }
];

function typeGuide() {
  const parts=[['decimal','тип'],['price','имя'],['=','присвоить'],['19.90m','значение'],[';','конец']];
  const diagram='<figure class="type-example"><figcaption>Как прочитать объявление'+button('copy-sample',icon('copy'),'type-example-copy',
    'data-source="decimal price = 19.90m;" data-label="Копировать" aria-label="Скопировать объявление переменной"')+'</figcaption>'+
    '<div>'+parts.map(([code,meaning])=>'<span><code>'+esc(code)+'</code><small>'+esc(meaning)+'</small></span>').join('')+'</div>'+
    '<small>В переменную <code>price</code> записывается цена. Буква <code>m</code> задаёт тип <code>decimal</code>, а точка с запятой завершает инструкцию.</small></figure>';
  const groups=typeFamilies.map(group=>{
    const preview=group.preview||group.entries.map(entry=>entry[0]).join(' · ');
    const rows=group.entries.map(([name,alias,meaning,example])=>
      '<div><dt><code>'+esc(name)+'</code><small>'+esc(alias)+'</small></dt><dd>'+esc(meaning)+
      button('copy-sample','<code class="type-sample">'+syntax(example)+'</code>'+icon('copy'),'lesson-command type-copy',
        'data-label="Копировать" aria-label="Скопировать пример для '+esc(name)+'"')+'</dd></div>').join('');
    return '<details class="type-group"><summary>'+icon(group.icon)+'<span><strong>'+esc(group.title)+'</strong><small>'+
      esc(preview)+'</small></span>'+icon('chevron-down')+'</summary><dl>'+rows+'</dl></details>';
  }).join('');
  return '<section class="type-guide" aria-labelledby="type-guide-title"><h2 id="type-guide-title">Памятка по типам C#</h2>'+
    diagram+'<div class="type-intro">Раскрой группу, чтобы увидеть, что хранит каждый тип и когда его выбирать. Например, <code>int</code> в C# и <code>System.Int32</code> в .NET обозначают один тип.</div>'+
    groups+'<div class="type-foot">Кроме встроенных типов, можно использовать типы библиотек, например <code>DateTime</code> для даты и времени, и объявлять свои, например класс <code>Player</code>.</div>'+
    '<a class="cs-source" href="https://learn.microsoft.com/ru-ru/dotnet/csharp/language-reference/builtin-types/built-in-types" target="_blank" rel="noopener noreferrer">Microsoft Learn · Встроенные типы C#</a></section>';
}
