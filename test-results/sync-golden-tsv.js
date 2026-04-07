// golden-set-v1.json → golden-set-v1.tsv 동기화
const fs = require('fs');
const path = require('path');

const json = JSON.parse(fs.readFileSync(path.join(__dirname, 'golden-set-v1.json'), 'utf8'));
const headers = ['ID','Category','Name','Input','PreState','Sequence','ExpectedRouter','ExpectedAction','FiltersAdded','FiltersRemoved','CandidateChange','ShouldNotContain','Source'];
const rows = [headers.join('\t')];

for (const c of json.cases) {
  const e = c.expected || {};
  rows.push([
    c.id,
    c.category || '',
    c.name || '',
    c.input || '',
    c.preState ? JSON.stringify(c.preState) : '""',
    c.sequence ? JSON.stringify(c.sequence) : '',
    e.router || '',
    e.lastAction || '',
    e.filtersAdded ? JSON.stringify(e.filtersAdded) : '[]',
    e.filtersRemoved ? JSON.stringify(e.filtersRemoved) : '[]',
    e.candidateChange || '',
    e.shouldNotContain || '',
    c.source || ''
  ].join('\t'));
}

fs.writeFileSync(path.join(__dirname, 'golden-set-v1.tsv'), rows.join('\n') + '\n');
console.log('TSV synced:', rows.length - 1, 'cases');
