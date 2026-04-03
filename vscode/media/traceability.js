// @implements {DD013.§DC.16} Traceability webview script
(function () {
  const vscode = acquireVsCodeApi();
  let currentData = null;
  let gapsOnly = false;

  window.addEventListener('message', event => {
    const msg = event.data;
    if (msg.type === 'update') {
      currentData = msg;
      render();
    } else if (msg.type === 'clear') {
      currentData = null;
      renderEmpty();
    }
  });

  document.getElementById('gaps-only')?.addEventListener('change', e => {
    gapsOnly = e.target.checked;
    vscode.postMessage({ type: 'filterGaps', gapsOnly });
    render();
  });

  document.getElementById('open-full')?.addEventListener('click', () => {
    vscode.postMessage({ type: 'openFullMatrix' });
  });

  function render() {
    if (!currentData) { renderEmpty(); return; }
    const { noteId, noteTitle, columns, columnShort, rows, gapCount } = currentData;

    document.getElementById('note-title').textContent =
      noteId + ' ' + noteTitle;
    document.getElementById('empty-state').style.display = 'none';
    document.getElementById('matrix-container').style.display = '';

    // Column headers with full name tooltips
    const headerRow = document.getElementById('column-headers');
    headerRow.innerHTML = '<th>Claim</th>' +
      (columnShort || columns).map(function(c, i) {
        var fullName = columns[i] || c;
        return '<th title="' + fullName + '">' + c + '</th>';
      }).join('');

    // Rows
    const tbody = document.getElementById('matrix-body');
    tbody.innerHTML = '';
    for (const row of rows) {
      const hasGap = row.cells.some(function(c) { return !c.covered; });
      if (gapsOnly && !hasGap) continue;

      const tr = document.createElement('tr');
      if (hasGap) tr.classList.add('row-has-gap');

      const idTd = document.createElement('td');
      idTd.classList.add('claim-id');
      idTd.textContent = row.claimShortId;
      idTd.title = row.claimFqid + ': ' + row.claimHeading;
      idTd.addEventListener('click', function() {
        vscode.postMessage({ type: 'navigate', claimFqid: row.claimFqid });
      });
      tr.appendChild(idTd);

      for (var ci = 0; ci < row.cells.length; ci++) {
        var cell = row.cells[ci];
        var colName = columns[ci] || '';
        var td = document.createElement('td');
        td.classList.add(cell.covered ? 'cell-covered' : 'cell-gap');
        // Rich tooltip showing column name, claim ID, and covering notes/sources
        var tooltipLines = [row.claimShortId + ' → ' + colName];
        if (cell.covered) {
          if (cell.notes.length > 0) tooltipLines.push('Notes: ' + cell.notes.join(', '));
          if (cell.sources.length > 0) tooltipLines.push('Source: ' + cell.sources.join(', '));
        } else {
          tooltipLines.push('No coverage');
        }
        td.title = tooltipLines.join('\n');
        if (cell.covered) {
          td.addEventListener('click', function() {
            vscode.postMessage({ type: 'navigate', claimFqid: row.claimFqid });
          });
        }
        tr.appendChild(td);
      }

      tbody.appendChild(tr);
    }

    document.getElementById('gap-count').textContent =
      gapCount + ' gap' + (gapCount !== 1 ? 's' : '') + ' of ' + rows.length + ' claims';
    document.getElementById('summary').style.display = '';
  }

  function renderEmpty() {
    document.getElementById('matrix-container').style.display = 'none';
    document.getElementById('summary').style.display = 'none';
    document.getElementById('empty-state').style.display = '';
  }
})();
