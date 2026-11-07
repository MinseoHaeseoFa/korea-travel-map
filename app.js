/* ==========================================================================
   대한민국 여행 색칠 지도 (Korea Travel Map) - Core JavaScript Engine
   ========================================================================== */

// --- Global Application State ---
const AppState = {
  data: {
    visited: {} // { [code]: { visited: bool, visitDate: string, checkedSpots: [], customSpots: [], memo: string } }
  },
  currentRegionCode: null,
  currentProvinceFilter: 'all',
  svg: null,
  g: null,
  projection: null,
  pathGenerator: null,
  zoom: null,
  geojson: null,
  width: 0,
  height: 0
};

// Storage Key
const STORAGE_KEY = 'korea_travel_map_records_v1';

// Province Name to Code Prefix Mapping
const PROVINCE_MAP = {
  'all': null,
  'seoul': '11',
  'gyeonggi': '31',
  'incheon': '23',
  'gangwon': '32',
  'chungcheong': ['33', '34', '25', '29'],
  'jeolla': ['35', '36', '24'],
  'gyeongsang': ['37', '38', '21', '22', '26'],
  'jeju': '39',
  'visited_only': 'visited'
};

// --- Initialization ---
document.addEventListener('DOMContentLoaded', () => {
  loadStoredData();
  initMap();
  setupEventListeners();
  updateStats();
});

// --- LocalStorage Operations ---
function loadStoredData() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      AppState.data = JSON.parse(raw);
      if (!AppState.data.visited) AppState.data.visited = {};
      // Ensure arrays exist
      Object.values(AppState.data.visited).forEach(rec => {
        if (!rec.checkedSpots) rec.checkedSpots = [];
        if (!rec.customSpots) rec.customSpots = [];
      });
    }
  } catch (err) {
    console.error('Failed to load localStorage data:', err);
    AppState.data = { visited: {} };
  }
}

function saveStoredData() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(AppState.data));
    updateStats();
    updateMapColors();
  } catch (err) {
    console.error('Failed to save to localStorage:', err);
  }
}

// --- Map Initialization with D3.js ---
function initMap() {
  const container = document.getElementById('map-container');
  AppState.width = container.clientWidth || window.innerWidth;
  AppState.height = container.clientHeight || (window.innerHeight - 100);

  AppState.svg = d3.select('#korea-map-svg');
  AppState.svg.selectAll('*').remove();

  AppState.g = AppState.svg.append('g').attr('id', 'map-group');

  if (typeof KOREA_TOPO_DATA === 'undefined') {
    console.error('KOREA_TOPO_DATA is not defined!');
    return;
  }

  const objName = Object.keys(KOREA_TOPO_DATA.objects)[0];
  AppState.geojson = topojson.feature(KOREA_TOPO_DATA, KOREA_TOPO_DATA.objects[objName]);

  // Mercator Projection centered on South Korea
  AppState.projection = d3.geoMercator().fitSize([AppState.width, AppState.height], AppState.geojson);
  AppState.pathGenerator = d3.geoPath().projection(AppState.projection);

  // Zoom Behavior
  AppState.zoom = d3.zoom()
    .scaleExtent([1, 15])
    .on('zoom', (event) => {
      AppState.g.attr('transform', event.transform);
    });

  AppState.svg.call(AppState.zoom);

  // Render Municipalities (시·군·구 251개)
  AppState.g.selectAll('path.municipality')
    .data(AppState.geojson.features)
    .enter()
    .append('path')
    .attr('class', 'municipality')
    .attr('d', AppState.pathGenerator)
    .attr('data-code', d => d.properties.code)
    .attr('data-name', d => d.properties.name)
    .on('mouseenter', handleMouseEnter)
    .on('mousemove', handleMouseMove)
    .on('mouseleave', handleMouseLeave)
    .on('click', handleRegionClick);

  // Province Boundaries
  if (KOREA_TOPO_DATA.objects[objName]) {
    const provinceMesh = topojson.mesh(KOREA_TOPO_DATA, KOREA_TOPO_DATA.objects[objName], (a, b) => {
      return a.properties.code.substring(0, 2) !== b.properties.code.substring(0, 2);
    });
    AppState.g.append('path')
      .datum(provinceMesh)
      .attr('class', 'province-mesh')
      .attr('d', AppState.pathGenerator);
  }

  updateMapColors();

  // Resize handler
  window.addEventListener('resize', debounce(() => {
    const newW = container.clientWidth;
    const newH = container.clientHeight;
    if (newW > 0 && newH > 0 && (newW !== AppState.width || newH !== AppState.height)) {
      AppState.width = newW;
      AppState.height = newH;
      AppState.projection.fitSize([AppState.width, AppState.height], AppState.geojson);
      AppState.g.selectAll('path.municipality').attr('d', AppState.pathGenerator);
      AppState.g.selectAll('path.province-mesh').attr('d', AppState.pathGenerator);
    }
  }, 200));
}

// Update Map Fill Colors
function updateMapColors() {
  if (!AppState.g) return;

  AppState.g.selectAll('path.municipality')
    .each(function(d) {
      const code = d.properties.code;
      const record = AppState.data.visited[code];
      const isVisited = record && record.visited;

      const elem = d3.select(this);
      elem.classed('visited', isVisited);
      elem.classed('selected', AppState.currentRegionCode === code);

      if (AppState.currentProvinceFilter !== 'all') {
        const filterVal = PROVINCE_MAP[AppState.currentProvinceFilter];
        let match = false;
        if (filterVal === 'visited') {
          match = isVisited;
        } else if (Array.isArray(filterVal)) {
          match = filterVal.includes(code.substring(0, 2));
        } else if (typeof filterVal === 'string') {
          match = code.startsWith(filterVal);
        }

        elem.style('opacity', match ? 1 : 0.22);
      } else {
        elem.style('opacity', 1);
      }
    });
}

// --- Tooltip Logic (Desktop Hover) ---
const tooltip = document.getElementById('map-tooltip');

function handleMouseEnter(event, d) {
  if (window.innerWidth <= 768) return; // Suppress on mobile

  const code = d.properties.code;
  const placeInfo = (typeof PLACES_DATA !== 'undefined' && PLACES_DATA[code]) || {
    fullName: d.properties.name,
    spots: ['대표 명소 탐방', '지역 전통시장', '관광지']
  };

  const isVisited = AppState.data.visited[code] && AppState.data.visited[code].visited;

  document.getElementById('tt-title').textContent = placeInfo.fullName;
  const badge = document.getElementById('tt-badge');
  badge.textContent = isVisited ? '✅ 방문 완료' : '⬜ 미방문';
  badge.className = `tooltip-badge ${isVisited ? 'visited' : 'unvisited'}`;

  const spotList = document.getElementById('tt-spots');
  spotList.innerHTML = '';
  placeInfo.spots.slice(0, 4).forEach(s => {
    const li = document.createElement('li');
    li.textContent = s;
    spotList.appendChild(li);
  });

  tooltip.classList.add('visible');
}

function handleMouseMove(event) {
  if (window.innerWidth <= 768) return;
  const container = document.getElementById('map-container');
  const rect = container.getBoundingClientRect();
  const x = event.clientX - rect.left;
  const y = event.clientY - rect.top;

  tooltip.style.left = `${x}px`;
  tooltip.style.top = `${y - 14}px`;
}

function handleMouseLeave() {
  tooltip.classList.remove('visible');
}

function handleRegionClick(event, d) {
  const code = d.properties.code;
  openRegionDrawer(code);
}

// --- Detail Drawer / Bottom Sheet ---
function openRegionDrawer(code) {
  AppState.currentRegionCode = code;
  updateMapColors();

  const placeInfo = (typeof PLACES_DATA !== 'undefined' && PLACES_DATA[code]) || {
    name: code,
    fullName: code,
    name_eng: '',
    spots: []
  };

  if (!AppState.data.visited[code]) {
    AppState.data.visited[code] = {
      visited: false,
      visitDate: '',
      checkedSpots: [],
      customSpots: [],
      memo: ''
    };
  }

  const record = AppState.data.visited[code];
  if (!record.checkedSpots) record.checkedSpots = [];
  if (!record.customSpots) record.customSpots = [];

  document.getElementById('drawer-region-title').textContent = placeInfo.fullName;
  document.getElementById('drawer-region-eng').textContent = placeInfo.name_eng || placeInfo.province;

  renderVisitToggle(record.visited);
  renderSpotsList(placeInfo.spots, record.checkedSpots, record.customSpots);

  document.getElementById('visit-date-input').value = record.visitDate || '';
  document.getElementById('visit-memo-input').value = record.memo || '';

  document.getElementById('region-drawer').classList.add('open');
  document.getElementById('drawer-backdrop').classList.add('open');
}

function closeRegionDrawer() {
  document.getElementById('region-drawer').classList.remove('open');
  document.getElementById('drawer-backdrop').classList.remove('open');
  AppState.currentRegionCode = null;
  updateMapColors();
}

function renderVisitToggle(isVisited) {
  const banner = document.getElementById('visit-toggle-card');
  const btn = document.getElementById('visit-toggle-btn');
  const statusTitle = document.getElementById('visit-status-title');
  const statusDesc = document.getElementById('visit-status-desc');

  if (isVisited) {
    banner.classList.add('is-visited');
    statusTitle.textContent = '✈️ 다녀왔어요! (색칠됨)';
    statusDesc.textContent = '지도에 예쁘게 내 발자국이 표시되어 있어요.';
    btn.textContent = '방문 취소';
    btn.className = 'toggle-btn btn-unvisit';
  } else {
    banner.classList.remove('is-visited');
    statusTitle.textContent = '아직 안 가본 곳이에요';
    statusDesc.textContent = '방문하셨다면 색칠 버튼을 눌러주세요.';
    btn.textContent = '방문 완료 (색칠)';
    btn.className = 'toggle-btn btn-mark-visit';
  }
}

function toggleCurrentRegionVisit() {
  const code = AppState.currentRegionCode;
  if (!code) return;

  const record = AppState.data.visited[code];
  record.visited = !record.visited;

  renderVisitToggle(record.visited);
  saveStoredData();
}

function renderSpotsList(presetSpots, checkedSpots, customSpots) {
  const container = document.getElementById('drawer-spots-list');
  container.innerHTML = '';

  const allSpots = [
    ...presetSpots.map(s => ({ name: s, isCustom: false })),
    ...customSpots.map(s => ({ name: s, isCustom: true }))
  ];

  const checkedCount = allSpots.filter(s => checkedSpots.includes(s.name)).length;
  document.getElementById('spots-checked-count').textContent = `(${checkedCount}/${allSpots.length} 완료)`;

  allSpots.forEach(spot => {
    const isChecked = checkedSpots.includes(spot.name);
    const item = document.createElement('div');
    item.className = `spot-item ${isChecked ? 'checked' : ''}`;

    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = isChecked;
    cb.addEventListener('change', () => {
      toggleSpotChecked(spot.name);
    });

    const nameSpan = document.createElement('span');
    nameSpan.className = 'spot-name';
    nameSpan.textContent = spot.name;

    item.appendChild(cb);
    item.appendChild(nameSpan);

    if (spot.isCustom) {
      const delBtn = document.createElement('button');
      delBtn.className = 'btn-delete-custom-spot';
      delBtn.textContent = '✕';
      delBtn.title = '장소 삭제';
      delBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        deleteCustomSpot(spot.name);
      });
      item.appendChild(delBtn);
    }

    item.addEventListener('click', (e) => {
      if (e.target !== cb && e.target.tagName !== 'BUTTON') {
        cb.checked = !cb.checked;
        toggleSpotChecked(spot.name);
      }
    });

    container.appendChild(item);
  });
}

function toggleSpotChecked(spotName) {
  const code = AppState.currentRegionCode;
  if (!code) return;

  const record = AppState.data.visited[code];
  const idx = record.checkedSpots.indexOf(spotName);
  if (idx > -1) {
    record.checkedSpots.splice(idx, 1);
  } else {
    record.checkedSpots.push(spotName);
    if (!record.visited) {
      record.visited = true;
      renderVisitToggle(true);
    }
  }

  saveStoredData();
  const placeInfo = PLACES_DATA[code];
  renderSpotsList(placeInfo.spots, record.checkedSpots, record.customSpots);
}

function addCustomSpot() {
  const code = AppState.currentRegionCode;
  const input = document.getElementById('add-spot-input');
  const val = input.value.trim();
  if (!code || !val) return;

  const record = AppState.data.visited[code];
  if (!record.customSpots.includes(val)) {
    record.customSpots.push(val);
    record.checkedSpots.push(val);
    if (!record.visited) {
      record.visited = true;
      renderVisitToggle(true);
    }
    saveStoredData();
    input.value = '';

    const placeInfo = PLACES_DATA[code];
    renderSpotsList(placeInfo.spots, record.checkedSpots, record.customSpots);
  }
}

function deleteCustomSpot(spotName) {
  const code = AppState.currentRegionCode;
  if (!code) return;

  const record = AppState.data.visited[code];
  record.customSpots = record.customSpots.filter(s => s !== spotName);
  record.checkedSpots = record.checkedSpots.filter(s => s !== spotName);

  saveStoredData();
  const placeInfo = PLACES_DATA[code];
  renderSpotsList(placeInfo.spots, record.checkedSpots, record.customSpots);
}

// --- Statistics ---
function updateStats() {
  const totalRegions = 251;
  const visitedKeys = Object.keys(AppState.data.visited).filter(k => AppState.data.visited[k].visited);
  const visitedCount = visitedKeys.length;
  const percentage = ((visitedCount / totalRegions) * 100).toFixed(1);

  let totalSpots = 0;
  Object.values(AppState.data.visited).forEach(rec => {
    if (rec.checkedSpots) totalSpots += rec.checkedSpots.length;
  });

  document.getElementById('stat-visited-count').textContent = visitedCount;
  document.getElementById('stat-total-count').textContent = totalRegions;
  document.getElementById('stat-percentage').textContent = `${percentage}%`;
  document.getElementById('stat-spots-count').textContent = totalSpots;
  document.getElementById('stat-progress-bar').style.width = `${percentage}%`;
}

// --- Event Listeners Setup ---
function setupEventListeners() {
  document.getElementById('visit-toggle-btn').addEventListener('click', toggleCurrentRegionVisit);
  document.getElementById('btn-close-drawer').addEventListener('click', closeRegionDrawer);
  document.getElementById('drawer-backdrop').addEventListener('click', closeRegionDrawer);

  document.getElementById('btn-add-spot').addEventListener('click', addCustomSpot);
  document.getElementById('add-spot-input').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') addCustomSpot();
  });

  document.getElementById('visit-date-input').addEventListener('change', (e) => {
    const code = AppState.currentRegionCode;
    if (code) {
      AppState.data.visited[code].visitDate = e.target.value;
      saveStoredData();
    }
  });

  document.getElementById('visit-memo-input').addEventListener('input', debounce((e) => {
    const code = AppState.currentRegionCode;
    if (code) {
      AppState.data.visited[code].memo = e.target.value;
      saveStoredData();
    }
  }, 400));

  // Zoom Controls
  document.getElementById('btn-zoom-in').addEventListener('click', () => {
    AppState.svg.transition().duration(300).call(AppState.zoom.scaleBy, 1.4);
  });
  document.getElementById('btn-zoom-out').addEventListener('click', () => {
    AppState.svg.transition().duration(300).call(AppState.zoom.scaleBy, 0.7);
  });
  document.getElementById('btn-zoom-reset').addEventListener('click', () => {
    AppState.svg.transition().duration(400).call(AppState.zoom.transform, d3.zoomIdentity);
  });

  // Province Filters
  document.querySelectorAll('.filter-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      document.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      AppState.currentProvinceFilter = chip.dataset.filter;
      updateMapColors();
      zoomToProvince(chip.dataset.filter);
    });
  });

  // Search
  setupSearch();

  // Export Image
  document.getElementById('btn-export-image').addEventListener('click', exportMapAsImage);

  // Backup & Restore
  setupBackupModal();

  // Keyboard shortcut: ESC closes drawer
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeRegionDrawer();
  });
}

// --- Zoom to Province ---
function zoomToProvince(filterKey) {
  if (filterKey === 'all' || filterKey === 'visited_only') {
    AppState.svg.transition().duration(500).call(AppState.zoom.transform, d3.zoomIdentity);
    return;
  }

  const filterVal = PROVINCE_MAP[filterKey];
  const targetFeatures = AppState.geojson.features.filter(f => {
    const c = f.properties.code;
    if (Array.isArray(filterVal)) return filterVal.includes(c.substring(0, 2));
    return c.startsWith(filterVal);
  });

  if (targetFeatures.length === 0) return;

  const bounds = d3.geoPath().projection(AppState.projection).bounds({
    type: 'FeatureCollection',
    features: targetFeatures
  });

  const dx = bounds[1][0] - bounds[0][0];
  const dy = bounds[1][1] - bounds[0][1];
  const x = (bounds[0][0] + bounds[1][0]) / 2;
  const y = (bounds[0][1] + bounds[1][1]) / 2;

  const scale = Math.max(1, Math.min(8, 0.8 / Math.max(dx / AppState.width, dy / AppState.height)));
  const translate = [AppState.width / 2 - scale * x, AppState.height / 2 - scale * y];

  AppState.svg.transition().duration(600).call(
    AppState.zoom.transform,
    d3.zoomIdentity.translate(translate[0], translate[1]).scale(scale)
  );
}

// --- Search Implementation ---
function setupSearch() {
  const searchInput = document.getElementById('search-input');
  const searchDropdown = document.getElementById('search-dropdown');

  searchInput.addEventListener('input', (e) => {
    const query = e.target.value.trim().toLowerCase();
    if (!query) {
      searchDropdown.classList.remove('open');
      return;
    }

    const matches = [];
    Object.values(PLACES_DATA).forEach(place => {
      const matchName = place.fullName.toLowerCase().includes(query) || place.name.toLowerCase().includes(query);
      const matchSpot = place.spots.some(s => s.toLowerCase().includes(query));

      if (matchName || matchSpot) {
        matches.push({
          code: place.code,
          fullName: place.fullName,
          matchedSpot: matchSpot ? place.spots.find(s => s.toLowerCase().includes(query)) : null
        });
      }
    });

    if (matches.length > 0) {
      searchDropdown.innerHTML = '';
      matches.slice(0, 8).forEach(item => {
        const div = document.createElement('div');
        div.className = 'search-item';
        div.innerHTML = `
          <span><strong>${item.fullName}</strong></span>
          ${item.matchedSpot ? `<span style="font-size:11px;color:#059669;">📍 ${item.matchedSpot}</span>` : ''}
        `;
        div.addEventListener('click', () => {
          searchInput.value = '';
          searchDropdown.classList.remove('open');
          openRegionDrawer(item.code);
          focusOnRegion(item.code);
        });
        searchDropdown.appendChild(div);
      });
      searchDropdown.classList.add('open');
    } else {
      searchDropdown.innerHTML = '<div style="padding:10px 12px;font-size:12px;color:#94a3b8;">검색 결과가 없습니다.</div>';
      searchDropdown.classList.add('open');
    }
  });

  document.addEventListener('click', (e) => {
    if (!e.target.closest('.search-box')) {
      searchDropdown.classList.remove('open');
    }
  });
}

function focusOnRegion(code) {
  const feature = AppState.geojson.features.find(f => f.properties.code === code);
  if (!feature) return;

  const bounds = AppState.pathGenerator.bounds(feature);
  const x = (bounds[0][0] + bounds[1][0]) / 2;
  const y = (bounds[0][1] + bounds[1][1]) / 2;
  const scale = 4.5;
  const translate = [AppState.width / 2 - scale * x, AppState.height / 2 - scale * y];

  AppState.svg.transition().duration(500).call(
    AppState.zoom.transform,
    d3.zoomIdentity.translate(translate[0], translate[1]).scale(scale)
  );
}

// --- Bulletproof Image Export (PNG) ---
function exportMapAsImage() {
  const svgElement = document.getElementById('korea-map-svg');
  const totalRegions = 251;
  const visitedCount = Object.keys(AppState.data.visited).filter(k => AppState.data.visited[k].visited).length;
  const percentage = ((visitedCount / totalRegions) * 100).toFixed(1);

  const clone = svgElement.cloneNode(true);
  clone.setAttribute('width', 1200);
  clone.setAttribute('height', 1600);

  const group = clone.querySelector('#map-group');
  if (group) group.removeAttribute('transform');

  // Explicitly apply colors to each path in clone to avoid canvas cross-origin or CSS issues
  clone.querySelectorAll('path.municipality').forEach(p => {
    const code = p.getAttribute('data-code');
    const isVisited = AppState.data.visited[code] && AppState.data.visited[code].visited;
    p.setAttribute('fill', isVisited ? '#10b981' : '#e2e8f0');
    p.setAttribute('stroke', isVisited ? '#059669' : '#cbd5e1');
    p.setAttribute('stroke-width', '0.6');
  });

  const serializer = new XMLSerializer();
  const svgString = serializer.serializeToString(clone);

  const img = new Image();
  const svgBlob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
  const URL = window.URL || window.webkitURL || window;
  const blobURL = URL.createObjectURL(svgBlob);

  img.onload = () => {
    const canvas = document.createElement('canvas');
    canvas.width = 1200;
    canvas.height = 1600;
    const ctx = canvas.getContext('2d');

    // Background
    ctx.fillStyle = '#f8fafc';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Title Card
    ctx.fillStyle = '#0f172a';
    ctx.font = 'bold 44px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('대한민국 방방곡곡 여행 지도', 600, 90);

    ctx.fillStyle = '#64748b';
    ctx.font = '500 24px sans-serif';
    ctx.fillText('나의 전국 251개 시·군·구 여행 발자국', 600, 135);

    // Stats Card
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#e2e8f0';
    ctx.lineWidth = 2;
    roundRect(ctx, 200, 170, 800, 100, 20);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#059669';
    ctx.font = 'bold 36px sans-serif';
    ctx.fillText(`${visitedCount} / ${totalRegions}곳`, 450, 232);

    ctx.fillStyle = '#3b82f6';
    ctx.fillText(`${percentage}% 정복`, 750, 232);

    // Draw Map
    ctx.drawImage(img, 0, 280, 1200, 1250);

    // Legend
    ctx.fillStyle = '#10b981';
    roundRect(ctx, 430, 1540, 24, 24, 4);
    ctx.fill();
    ctx.fillStyle = '#1e293b';
    ctx.font = 'bold 20px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('방문 완료', 465, 1558);

    ctx.fillStyle = '#e2e8f0';
    roundRect(ctx, 620, 1540, 24, 24, 4);
    ctx.fill();
    ctx.strokeStyle = '#cbd5e1';
    ctx.stroke();
    ctx.fillStyle = '#64748b';
    ctx.fillText('미방문', 655, 1558);

    // Download
    const a = document.createElement('a');
    a.download = `대한민국_여행지도_${new Date().toISOString().slice(0,10)}.png`;
    a.href = canvas.toDataURL('image/png');
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);

    URL.revokeObjectURL(blobURL);
  };

  img.src = blobURL;
}

function roundRect(ctx, x, y, width, height, radius) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + width - radius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
  ctx.lineTo(x + width, y + height - radius);
  ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  ctx.lineTo(x + width, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

// --- Backup & Restore Modal ---
function setupBackupModal() {
  const modal = document.getElementById('backup-modal');
  document.getElementById('btn-open-backup').addEventListener('click', () => {
    modal.classList.add('open');
  });
  document.getElementById('btn-close-backup').addEventListener('click', () => {
    modal.classList.remove('open');
  });

  document.getElementById('btn-export-json').addEventListener('click', () => {
    const jsonStr = JSON.stringify(AppState.data, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const a = document.createElement('a');
    a.download = `korea_travel_backup_${new Date().toISOString().slice(0,10)}.json`;
    a.href = URL.createObjectURL(blob);
    a.click();
  });

  const fileInput = document.getElementById('import-file-input');
  document.getElementById('btn-trigger-import').addEventListener('click', () => {
    fileInput.click();
  });

  fileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const parsed = JSON.parse(event.target.result);
        if (parsed && typeof parsed.visited === 'object') {
          AppState.data = parsed;
          saveStoredData();
          modal.classList.remove('open');
          alert('여행 기록 데이터가 성공적으로 복원되었습니다! 🎉');
        } else {
          alert('올바른 백업 JSON 형식이 아닙니다.');
        }
      } catch (err) {
        alert('파일을 읽는 중 오류가 발생했습니다: ' + err.message);
      }
    };
    reader.readAsText(file);
  });

  document.getElementById('btn-reset-data').addEventListener('click', () => {
    if (confirm('정말로 모든 여행 기록을 초기화하시겠습니까? 이 작업은 되돌릴 수 없습니다.')) {
      AppState.data = { visited: {} };
      saveStoredData();
      modal.classList.remove('open');
      closeRegionDrawer();
    }
  });
}

function debounce(func, wait) {
  let timeout;
  return function(...args) {
    clearTimeout(timeout);
    timeout = setTimeout(() => func.apply(this, args), wait);
  };
}
