let topicIndexRequest;
const topicIndexModes = {
  practice: 'Практика', walkthrough: 'Разбор', desktop: 'На ПК', reference: 'Справка'
};

function mountTopicIndex(host) {
  const body = host.querySelector('.topic-index-body');
  host.addEventListener('toggle', async () => {
    if (!host.open || body.dataset.state) return;
    body.dataset.state = 'loading';
    body.textContent = 'Открываем указатель…';
    try {
      topicIndexRequest ??= fetch('topic-index.json').then(response => {
        if (!response.ok) throw new Error('index unavailable');
        return response.json();
      }).catch(error => { topicIndexRequest = undefined; throw error; });
      const groups = await topicIndexRequest;
      if (!host.isConnected) return;
      body.innerHTML = '<label>Найти тему или термин<input type="search" placeholder="Например, кавычки или XPath"></label>' +
        '<p class="index-status" role="status"></p><div class="index-groups"></div>';
      const search = body.querySelector('input');
      const results = body.querySelector('.index-groups');
      const normalize = text => text.toLocaleLowerCase('ru').replaceAll('ё','е');
      const rows = groups.map(group => {
        const section = document.createElement('details');
        const summary = document.createElement('summary');
        summary.textContent = group.title;
        section.append(summary);
        const items = group.topics.map(([label,id,mode,note]) => {
          const link = document.createElement('a');
          link.href = '#lesson/' + id;
          link.innerHTML = '<strong>' + esc(label) + '</strong><small>' + esc(topicIndexModes[mode]) + '</small><span>' + esc(note) + '</span>';
          section.append(link);
          return { link, text:normalize([group.title,label,note].join(' ')) };
        });
        results.append(section);
        return { section, items, wasOpen:false };
      });
      let searching = false;
      function filter() {
        const term = normalize(search.value.trim());
        let count = 0;
        for (const row of rows) {
          if (!searching && term) row.wasOpen = row.section.open;
          const matches = row.items.filter(({link,text}) => {
            link.hidden = !text.includes(term);
            return !link.hidden;
          }).length;
          row.section.hidden = !matches;
          if (term || searching) row.section.open = term ? matches > 0 : row.wasOpen;
          count += matches;
        }
        searching = Boolean(term);
        body.querySelector('.index-status').textContent = count ?
          count + ' ' + words(count,'тема','темы','тем') : 'Совпадений нет. Попробуй другое слово.';
      }
      search.addEventListener('input', filter);
      filter();
      body.dataset.state = 'ready';
    } catch {
      delete body.dataset.state;
      body.textContent = 'Указатель не загрузился. Закрой и снова открой его, чтобы повторить.';
    }
  });
}
