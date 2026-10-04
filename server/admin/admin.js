/* Admin portal page. Everything from a report is untrusted, so text is only ever set with textContent. */
(function () {
  var $ = function (id) { return document.getElementById(id); };
  var reports = [];
  var selected = null;
  var map = null;
  var layer = null;

  function el(tag, props, children) {
    var n = document.createElement(tag);
    if (props) Object.keys(props).forEach(function (k) {
      if (k === 'text') n.textContent = props[k];
      else if (k === 'class') n.className = props[k];
      else if (k === 'on') Object.keys(props.on).forEach(function (ev) { n.addEventListener(ev, props.on[ev]); });
      else n.setAttribute(k, props[k]);
    });
    (children || []).forEach(function (c) { if (c) n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return n;
  }
  function api(method, path, body) {
    return fetch(path, { method: method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
      .then(function (r) { return r.json().then(function (j) { return { status: r.status, json: j }; }); });
  }
  function short(a) { return a.length > 12 ? a.slice(0, 5) + '…' + a.slice(-5) : a; }
  function when(iso) { var d = new Date(iso); return isNaN(d) ? '' : d.toLocaleString(); }
  function usd(rows) { return rows.reduce(function (n, r) { return n + Number(r.amountUsdc); }, 0); }

  function loadOverview() {
    api('GET', '/api/overview').then(function (r) {
      if (r.status !== 200) return;
      $('waiting').textContent = r.json.waiting;
      $('payableTotal').textContent = r.json.payableTotal.toFixed(3);
      $('wallets').textContent = r.json.payable.length;
    });
  }

  function loadList() {
    $('list').textContent = 'Checking submissions…';
    api('GET', '/api/reports').then(function (r) {
      if (r.status !== 200) { $('list').textContent = (r.json && r.json.error) || 'Could not load.'; return; }
      reports = r.json.reports;
      renderList();
      if (selected) { var again = reports.filter(function (x) { return x.hash === selected; })[0]; if (again) renderDetail(again); else { selected = null; $('detail').textContent = 'Choose a submission on the left.'; } }
    });
  }

  function renderList() {
    var list = $('list');
    list.textContent = '';
    if (!reports.length) { list.textContent = 'Nothing is waiting. 🎉'; return; }
    reports.forEach(function (r) {
      var item = el('div', { class: 'item' + (r.hash === selected ? ' active' : ''), on: { click: function () { selected = r.hash; renderList(); renderDetail(r); } } }, [
        el('div', { class: 'top' }, [el('span', { class: 'mono', text: short(r.node) }), el('span', { class: 'tag ' + (r.check.ok ? 'good' : 'bad'), text: r.check.ok ? 'checks pass' : 'checks fail' })]),
        el('div', { class: 'muted', text: r.type + ' · ' + r.cellCount + ' cells · ' + when(r.receivedAt) }),
      ]);
      list.appendChild(item);
    });
  }

  function drawMap(r) {
    if (!map) {
      map = L.map('map');
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap contributors' }).addTo(map);
    }
    if (layer) layer.remove();
    layer = L.featureGroup().addTo(map);
    r.cells.forEach(function (c) {
      var corners = AzimuthHex.cellCorners(c.id);
      if (corners) L.polygon(corners, { color: '#4dd0e1', weight: 1, fillOpacity: 0.3 }).addTo(layer);
    });
    if (r.cells.length) map.fitBounds(layer.getBounds().pad(0.3)); else map.setView([0, 0], 2);
    setTimeout(function () { map.invalidateSize(); }, 50);
  }

  function renderDetail(r) {
    var d = $('detail');
    d.textContent = '';
    var rows = [
      ['Wallet', el('span', { class: 'mono', text: r.node })],
      ['Type', r.type],
      ['Received', when(r.receivedAt)],
      ['Phone', (r.device || '?') + ' · app ' + (r.app || '?')],
      ['Readings', String(r.samples) + ' over ' + String(r.durationSec) + ' s'],
      ['Top speed', r.maxSpeedMps + ' m/s'],
      ['Mock locations flagged', String(r.mockedFixes)],
      ['Cells', String(r.cellCount)],
    ];
    if (r.chest) rows.push(['Claims chest', el('span', { class: 'mono', text: r.chest.id + ' at ' + r.chest.cellId })]);
    if (r.pass) rows.push(['Satellite pass', 'NORAD ' + r.pass.noradId + ', peak ' + r.pass.maxElevationDeg + '°, ' + when(r.pass.startMs)]);
    var table = el('table', null, rows.map(function (row) { return el('tr', null, [el('th', { text: row[0] }), el('td', null, [row[1]])]); }));

    var checks = el('div', null, [el('h3', { text: 'Automatic checks (advice)', style: 'font-size:14px;margin:12px 0 4px' })]);
    if (r.check.ok) {
      checks.appendChild(el('div', null, [el('span', { class: 'tag good', text: 'all checks pass' })]));
      var total = usd(r.check.rewardRows);
      checks.appendChild(el('p', { class: 'muted', text: r.check.rewardRows.length ? 'Approving would create: ' + r.check.rewardRows.map(function (x) { return x.amountUsdc + ' USDC (' + x.kind + ')'; }).join(', ') + ' — total ' + total.toFixed(6) + ' USDC.' : 'Approving would pay nothing (no new cells, no chest).' }));
      if (r.check.alreadyCommitted) checks.appendChild(el('p', { class: 'muted', text: 'An earlier approval was interrupted; approving again finishes it.' }));
    } else {
      checks.appendChild(el('div', null, [el('span', { class: 'tag bad', text: 'would be refused' })]));
      checks.appendChild(el('ul', null, r.check.reasons.map(function (x) { return el('li', { text: x }); })));
      checks.appendChild(el('p', { class: 'muted', text: 'A report that fails these checks cannot be approved. You can reject it.' }));
    }

    var reason = el('input', { type: 'text', id: 'reason', placeholder: 'Reason for rejecting (required)' });
    var msg = el('div', { class: 'muted', id: 'msg', role: 'status' });
    var approve = el('button', { class: 'approve', text: 'Approve', on: { click: function () { decide(r, 'approve'); } } });
    if (!r.check.ok) approve.disabled = true;
    var reject = el('button', { class: 'reject', text: 'Reject', on: { click: function () { decide(r, 'reject'); } } });
    var body = el('pre', { id: 'body', style: 'display:none' });
    var show = el('button', { class: 'ghost', text: 'Show raw report', on: { click: function () {
      if (body.style.display === 'none') {
        api('GET', '/api/reports/' + r.hash + '/body').then(function (x) { body.textContent = JSON.stringify(x.json.body, null, 2); body.style.display = 'block'; });
      } else body.style.display = 'none';
    } } });

    d.appendChild(el('h2', { text: 'Submission', style: 'margin-top:0;font-size:15px' }));
    d.appendChild(table);
    d.appendChild(el('div', { id: 'map' }));
    d.appendChild(checks);
    d.appendChild(el('div', { class: 'row' }, [approve, show]));
    d.appendChild(el('div', { class: 'row' }, [reason, reject]));
    d.appendChild(msg);
    d.appendChild(body);
    drawMap(r);
  }

  function decide(r, action) {
    var msg = $('msg');
    var body = action === 'reject' ? { reason: $('reason').value } : undefined;
    msg.textContent = 'Working…';
    api('POST', '/api/reports/' + r.hash + '/' + action, body).then(function (x) {
      if (x.status === 200) {
        selected = null;
        $('detail').textContent = action === 'approve' ? 'Approved. The rewards are ready for the weekly payout.' : 'Rejected.';
        loadOverview(); loadList();
      } else {
        msg.textContent = (x.json.reasons && x.json.reasons.join('. ')) || x.json.error || 'Could not do that.';
      }
    }).catch(function () { msg.textContent = 'Could not reach the portal.'; });
  }

  $('reload').addEventListener('click', function () { loadOverview(); loadList(); });
  loadOverview(); loadList();
})();
