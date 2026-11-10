/* ==========================================================================
   대한민국 여행 색칠 지도 (Korea Travel Map) - High-End JavaScript Engine
   ========================================================================== */

// --- Global Application State ---
const TOTAL_REGIONS = 167;
const TOTAL_CURATED_SPOTS = 1670;

const AppState = {
  data: {
    visited: {} // { [code]: { level: 0..4, visitDate: string, checkedSpots: [], customSpots: [], memo: string } }
  },
  currentRegionCode: null,
  currentProvinceFilter: 'all',
  showLabels: false,
  svg: null,
  g: null,
  labelsGroup: null,
  projection: null,
  pathGenerator: null,
  zoom: null,
  geojson: null,
  width: 0,
  height: 0
};

// Storage Key (V2 with 167 regions & 5 levels)
const STORAGE_KEY = 'korea_travel_map_167_v2';
const OLD_STORAGE_KEY = 'korea_travel_map_records_v1';

// Province Name to Code Prefix Mapping (Consolidated 167 Regions)
const PROVINCE_MAP = {
  'all': null,
  'capital': ['11', '31', '23'],                 // 수도권: 서울(1), 경기(31), 인천(3) = 35곳
  'gangwon': ['32'],                            // 강원권: 강원(18) = 18곳
  'chungcheong': ['25', '29', '33', '34'],       // 충청권: 대전(1), 세종(1), 충북(11), 충남(15) = 28곳
  'jeolla': ['24', '35', '36'],                 // 호남권: 광주(1), 전북(14), 전남(22) = 37곳
  'gyeongsang': ['21', '22', '26', '37', '38'], // 영남권: 부산(2), 대구(2), 울산(2), 경북(23), 경남(18) = 47곳
  'jeju': ['39'],                               // 제주권: 제주(2) = 2곳
  'visited_only': 'visited'
};

// Level Meta Information
const LEVEL_META = {
  0: { label: '미방문', color: '#f1f5f9', stroke: '#cbd5e1', emoji: '⬜' },
  1: { label: '당일치기', color: '#6ee7b7', stroke: '#059669', emoji: '🟢' },
  2: { label: '숙박 여행', color: '#10b981', stroke: '#047857', emoji: '🏕️' },
  3: { label: '단골·자주', color: '#3b82f6', stroke: '#1d4ed8', emoji: '🚀' },
  4: { label: '거주·고향', color: '#8b5cf6', stroke: '#6d28d9', emoji: '👑' }
};

// --- Initialization ---
document.addEventListener('DOMContentLoaded', () => {
  loadStoredData();
  initMap();
  setupEventListeners();
  updateStats();
  // 자동 시트 연동: 로컬 기록이 비어있으면 시트에서 자동 로드
  if (AppState.data && AppState.data.visited && Object.keys(AppState.data.visited).length === 0) {
    syncPullFromSheet(false);
  }
});

// --- LocalStorage Operations ---
function loadStoredData() {
  try {
    let raw = localStorage.getItem(STORAGE_KEY);
    // Backward compatibility with V1
    if (!raw) {
      const oldRaw = localStorage.getItem(OLD_STORAGE_KEY);
      if (oldRaw) {
        raw = oldRaw;
      }
    }

    if (raw) {
      AppState.data = JSON.parse(raw);
      if (!AppState.data.visited) AppState.data.visited = {};
      
      // Upgrade existing records to 5-level format
      Object.keys(AppState.data.visited).forEach(code => {
        const rec = AppState.data.visited[code];
        if (typeof rec.level === 'undefined') {
          rec.level = rec.visited ? 2 : 0;
        }
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

  if (typeof KOREA_167_GEO === 'undefined') {
    console.error('KOREA_167_GEO is not defined!');
    return;
  }

  AppState.geojson = KOREA_167_GEO;

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

  // 1. Render Municipalities (167 Regions)
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

  // 2. Render Region Text Labels Layer
  AppState.labelsGroup = AppState.g.append('g')
    .attr('class', `map-labels-group ${AppState.showLabels ? 'show-labels' : ''}`);

  AppState.labelsGroup.selectAll('text.map-label')
    .data(AppState.geojson.features)
    .enter()
    .append('text')
    .attr('class', 'map-label')
    .attr('transform', d => {
      const centroid = AppState.pathGenerator.centroid(d);
      return `translate(${centroid[0]}, ${centroid[1]})`;
    })
    .text(d => d.properties.name);

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
      AppState.labelsGroup.selectAll('text.map-label').attr('transform', d => {
        const centroid = AppState.pathGenerator.centroid(d);
        return `translate(${centroid[0]}, ${centroid[1]})`;
      });
    }
  }, 200));
}

// Update Map Fill Colors according to 5 Levels
function updateMapColors() {
  if (!AppState.g) return;

  AppState.g.selectAll('path.municipality')
    .each(function(d) {
      const code = d.properties.code;
      const record = AppState.data.visited[code];
      const level = (record && typeof record.level === 'number') ? record.level : 0;

      const elem = d3.select(this);
      
      // Apply level class (level-0 to level-4)
      elem.attr('class', `municipality level-${level}`);
      elem.classed('selected', AppState.currentRegionCode === code);

      // Filter by Province
      if (AppState.currentProvinceFilter !== 'all') {
        const filterVal = PROVINCE_MAP[AppState.currentProvinceFilter];
        let match = false;
        if (filterVal === 'visited') {
          match = level > 0;
        } else if (Array.isArray(filterVal)) {
          match = filterVal.some(prefix => code.startsWith(prefix));
        }

        elem.style('opacity', match ? 1 : 0.2);
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
  const placeInfo = (typeof PLACES_167_DATA !== 'undefined' && PLACES_167_DATA[code]) || {
    fullName: d.properties.name,
    spots: ['대표 명소 탐방', '지역 전통시장', '관광지']
  };

  const record = AppState.data.visited[code];
  const level = (record && typeof record.level === 'number') ? record.level : 0;
  const meta = LEVEL_META[level];

  document.getElementById('tt-title').textContent = placeInfo.fullName;
  const badge = document.getElementById('tt-badge');
  badge.textContent = `${meta.emoji} ${meta.label}`;
  badge.className = `tooltip-badge lvl-${level}`;

  const spotList = document.getElementById('tt-spots');
  spotList.innerHTML = '';
  (placeInfo.spots || []).slice(0, 4).forEach(s => {
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
  
  // If clicking an unvisited region, auto-set default to Level 2 (숙박) on first click for convenience
  if (!AppState.data.visited[code] || AppState.data.visited[code].level === 0) {
    if (!AppState.data.visited[code]) {
      AppState.data.visited[code] = { level: 2, visitDate: '', checkedSpots: [], customSpots: [], memo: '' };
    } else {
      AppState.data.visited[code].level = 2;
    }
    saveStoredData();
  }

  openRegionDrawer(code);
}

// --- Detail Drawer / Bottom Sheet ---
function openRegionDrawer(code) {
  AppState.currentRegionCode = code;
  updateMapColors();

  const placeInfo = (typeof PLACES_167_DATA !== 'undefined' && PLACES_167_DATA[code]) || {
    name: code,
    fullName: code,
    province: '',
    spots: []
  };

  if (!AppState.data.visited[code]) {
    AppState.data.visited[code] = {
      level: 0,
      visitDate: '',
      checkedSpots: [],
      customSpots: [],
      memo: ''
    };
  }

  const record = AppState.data.visited[code];
  if (!record.checkedSpots) record.checkedSpots = [];
  if (!record.customSpots) record.customSpots = [];

  document.getElementById('drawer-province-tag').textContent = placeInfo.province || '대한민국';
  document.getElementById('drawer-region-title').textContent = placeInfo.name;

  renderLevelSelector(record.level);
  renderSpotsList(placeInfo.fullName, placeInfo.spots, record.checkedSpots, record.customSpots);

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

// Render Level Selector Buttons
function renderLevelSelector(currentLevel) {
  const badge = document.getElementById('current-level-badge');
  const meta = LEVEL_META[currentLevel || 0];
  badge.textContent = `${meta.emoji} ${meta.label}`;
  badge.className = `level-panel-badge lvl-${currentLevel || 0}`;

  for (let i = 1; i <= 4; i++) {
    const btn = document.getElementById(`btn-lvl-${i}`);
    if (btn) {
      btn.classList.toggle('active', currentLevel === i);
    }
  }
}

function setRegionLevel(level) {
  const code = AppState.currentRegionCode;
  if (!code) return;

  if (!AppState.data.visited[code]) {
    AppState.data.visited[code] = { level: 0, visitDate: '', checkedSpots: [], customSpots: [], memo: '' };
  }

  AppState.data.visited[code].level = level;
  renderLevelSelector(level);
  saveStoredData();
}

// Render Curated 10 Spots List + Naver Map Links
function renderSpotsList(regionFullName, presetSpots, checkedSpots, customSpots) {
  const container = document.getElementById('drawer-spots-list');
  container.innerHTML = '';

  const allSpots = [
    ...(presetSpots || []).map(s => ({ name: s, isCustom: false })),
    ...(customSpots || []).map(s => ({ name: s, isCustom: true }))
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

    // Direct Naver Map Search Link
    const cleanSpotName = spot.name.split('&')[0].split('(')[0].trim();
    const naverSearchQuery = `${regionFullName} ${cleanSpotName}`;
    const naverLink = document.createElement('a');
    naverLink.className = 'btn-naver-map';
    naverLink.href = `https://map.naver.com/p/search/${encodeURIComponent(naverSearchQuery)}`;
    naverLink.target = '_blank';
    naverLink.rel = 'noopener noreferrer';
    naverLink.title = '네이버 지도에서 위치·리뷰 보기';
    naverLink.innerHTML = '🗺️ 지도';
    naverLink.addEventListener('click', (e) => e.stopPropagation());

    item.appendChild(cb);
    item.appendChild(nameSpan);
    item.appendChild(naverLink);

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
      if (e.target !== cb && e.target.tagName !== 'A' && e.target.tagName !== 'BUTTON') {
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
    // Auto-mark as visited if currently level 0
    if (record.level === 0) {
      record.level = 2; // Default to overnight
      renderLevelSelector(record.level);
    }
  }

  saveStoredData();
  const placeInfo = PLACES_167_DATA[code];
  renderSpotsList(placeInfo.fullName, placeInfo.spots, record.checkedSpots, record.customSpots);
}

function checkAllSpots() {
  const code = AppState.currentRegionCode;
  if (!code) return;

  const record = AppState.data.visited[code];
  const placeInfo = PLACES_167_DATA[code];
  const allSpots = [...(placeInfo.spots || []), ...(record.customSpots || [])];

  record.checkedSpots = [...allSpots];
  if (record.level === 0) {
    record.level = 2;
    renderLevelSelector(record.level);
  }

  saveStoredData();
  renderSpotsList(placeInfo.fullName, placeInfo.spots, record.checkedSpots, record.customSpots);
}

function uncheckAllSpots() {
  const code = AppState.currentRegionCode;
  if (!code) return;

  const record = AppState.data.visited[code];
  const placeInfo = PLACES_167_DATA[code];
  record.checkedSpots = [];

  saveStoredData();
  renderSpotsList(placeInfo.fullName, placeInfo.spots, record.checkedSpots, record.customSpots);
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
    if (record.level === 0) {
      record.level = 2;
      renderLevelSelector(record.level);
    }
    saveStoredData();
    input.value = '';

    const placeInfo = PLACES_167_DATA[code];
    renderSpotsList(placeInfo.fullName, placeInfo.spots, record.checkedSpots, record.customSpots);
  }
}

function deleteCustomSpot(spotName) {
  const code = AppState.currentRegionCode;
  if (!code) return;

  const record = AppState.data.visited[code];
  record.customSpots = record.customSpots.filter(s => s !== spotName);
  record.checkedSpots = record.checkedSpots.filter(s => s !== spotName);

  saveStoredData();
  const placeInfo = PLACES_167_DATA[code];
  renderSpotsList(placeInfo.fullName, placeInfo.spots, record.checkedSpots, record.customSpots);
}

// --- Real-Time Statistics ---
function updateStats() {
  const visitedCodes = Object.keys(AppState.data.visited).filter(k => {
    return AppState.data.visited[k] && AppState.data.visited[k].level > 0;
  });
  const visitedCount = visitedCodes.length;
  const percentage = ((visitedCount / TOTAL_REGIONS) * 100).toFixed(1);

  // Count by levels
  let lvl1 = 0, lvl2 = 0, lvl3 = 0, lvl4 = 0;
  let totalSpots = 0;

  Object.values(AppState.data.visited).forEach(rec => {
    if (rec.level === 1) lvl1++;
    else if (rec.level === 2) lvl2++;
    else if (rec.level === 3) lvl3++;
    else if (rec.level === 4) lvl4++;

    if (rec.checkedSpots) totalSpots += rec.checkedSpots.length;
  });

  document.getElementById('stat-visited-count').textContent = visitedCount;
  document.getElementById('stat-percentage').textContent = `${percentage}%`;
  document.getElementById('stat-progress-bar').style.width = `${percentage}%`;

  document.getElementById('stat-lvl1-count').textContent = lvl1;
  document.getElementById('stat-lvl2-count').textContent = lvl2;
  document.getElementById('stat-lvl3-count').textContent = lvl3;
  document.getElementById('stat-lvl4-count').textContent = lvl4;

  document.getElementById('stat-spots-count').textContent = totalSpots;
}

// --- Random Travel Explorer (🎲) ---
function pickRandomTravelDestination() {
  // Find all unvisited regions (level === 0 or undefined)
  const allCodes = Object.keys(PLACES_167_DATA);
  const unvisitedCodes = allCodes.filter(c => {
    const rec = AppState.data.visited[c];
    return !rec || rec.level === 0;
  });

  if (unvisitedCodes.length === 0) {
    showToast('🏆 축하합니다! 전국 167개 시·군을 모두 여행하셨습니다!');
    return;
  }

  // Random pick
  const randomIndex = Math.floor(Math.random() * unvisitedCodes.length);
  const pickedCode = unvisitedCodes[randomIndex];
  const placeInfo = PLACES_167_DATA[pickedCode];

  // Show Toast
  showToast(`🎲 오늘의 추천 여행지: [${placeInfo.fullName}] 로 떠나보세요!`);

  // Zoom to picked region
  focusOnRegion(pickedCode);

  // Open Drawer
  openRegionDrawer(pickedCode);
}

function showToast(message) {
  const toast = document.getElementById('random-toast');
  toast.textContent = message;
  toast.classList.add('show');
  setTimeout(() => {
    toast.classList.remove('show');
  }, 3500);
}

// --- Event Listeners Setup ---
function setupEventListeners() {
  // Level selector buttons
  for (let i = 1; i <= 4; i++) {
    const btn = document.getElementById(`btn-lvl-${i}`);
    if (btn) {
      btn.addEventListener('click', () => setRegionLevel(i));
    }
  }

  document.getElementById('btn-reset-level').addEventListener('click', () => {
    setRegionLevel(0);
  });

  document.getElementById('btn-close-drawer').addEventListener('click', closeRegionDrawer);
  document.getElementById('drawer-backdrop').addEventListener('click', closeRegionDrawer);

  document.getElementById('btn-check-all-spots').addEventListener('click', checkAllSpots);
  document.getElementById('btn-uncheck-all-spots').addEventListener('click', uncheckAllSpots);

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

  // 맨 하단 안심 💾 [여행 기록 저장 완료] 버튼
  const saveBtn = document.getElementById('btn-save-confirm');
  if (saveBtn) {
    saveBtn.addEventListener('click', () => {
      const code = AppState.currentRegionCode;
      if (!code) return;
      const place = KOREA_REGIONS_10SPOTS[code];
      const regionName = place ? place.fullName : '해당 지역';

      if (!AppState.data.visited[code]) {
        AppState.data.visited[code] = { level: 2, spots: [], visitDate: '', memo: '' };
      }
      AppState.data.visited[code].visitDate = document.getElementById('visit-date-input').value;
      AppState.data.visited[code].memo = document.getElementById('visit-memo-input').value;

      saveStoredData();

      // 버튼 피드백 애니메이션
      saveBtn.classList.add('saved-success');
      const originalHtml = saveBtn.innerHTML;
      saveBtn.innerHTML = '<span class="save-icon">✓</span><span class="save-text">저장 완료!</span>';

      setTimeout(() => {
        saveBtn.classList.remove('saved-success');
        saveBtn.innerHTML = originalHtml;
      }, 1500);

      // 안심 토스트 알림
      showToast(`✅ [${regionName}] 여행 기록이 안전하게 저장되었습니다! 💾`);
    });
  }

  // Random Explorer
  document.getElementById('btn-random-pick').addEventListener('click', pickRandomTravelDestination);

  // Toggle Map Labels
  const btnToggleLabels = document.getElementById('btn-toggle-labels');
  btnToggleLabels.addEventListener('click', () => {
    AppState.showLabels = !AppState.showLabels;
    btnToggleLabels.classList.toggle('active', AppState.showLabels);
    if (AppState.labelsGroup) {
      AppState.labelsGroup.classed('show-labels', AppState.showLabels);
    }
  });

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
    return filterVal.some(prefix => c.startsWith(prefix));
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
    Object.values(PLACES_167_DATA).forEach(place => {
      const matchName = place.fullName.toLowerCase().includes(query) || place.name.toLowerCase().includes(query);
      const matchSpot = (place.spots || []).some(s => s.toLowerCase().includes(query));

      if (matchName || matchSpot) {
        matches.push({
          code: place.code,
          name: place.name,
          fullName: place.fullName,
          matchedSpot: matchSpot ? place.spots.find(s => s.toLowerCase().includes(query)) : null
        });
      }
    });

    if (matches.length > 0) {
      searchDropdown.innerHTML = '';
      matches.slice(0, 10).forEach(item => {
        const div = document.createElement('div');
        div.className = 'search-item';
        div.innerHTML = `
          <div class="search-item-top">
            <strong>${item.name}</strong>
            <span class="search-item-prov">${item.fullName}</span>
          </div>
          ${item.matchedSpot ? `<div class="search-item-spot">📍 ${item.matchedSpot}</div>` : ''}
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
  const scale = 5.0;
  const translate = [AppState.width / 2 - scale * x, AppState.height / 2 - scale * y];

  AppState.svg.transition().duration(600).call(
    AppState.zoom.transform,
    d3.zoomIdentity.translate(translate[0], translate[1]).scale(scale)
  );
}

// --- Bulletproof Image Export (PNG) ---
function exportMapAsImage() {
  const svgElement = document.getElementById('korea-map-svg');
  const visitedCodes = Object.keys(AppState.data.visited).filter(k => AppState.data.visited[k] && AppState.data.visited[k].level > 0);
  const visitedCount = visitedCodes.length;
  const percentage = ((visitedCount / TOTAL_REGIONS) * 100).toFixed(1);

  const clone = svgElement.cloneNode(true);
  clone.setAttribute('width', 1200);
  clone.setAttribute('height', 1600);

  const group = clone.querySelector('#map-group');
  if (group) group.removeAttribute('transform');

  // Explicitly apply 5-level colors
  clone.querySelectorAll('path.municipality').forEach(p => {
    const code = p.getAttribute('data-code');
    const record = AppState.data.visited[code];
    const level = (record && typeof record.level === 'number') ? record.level : 0;
    const meta = LEVEL_META[level];

    p.setAttribute('fill', meta.color);
    p.setAttribute('stroke', meta.stroke);
    p.setAttribute('stroke-width', '0.7');
  });

  // Hide label text in export for crystal clarity unless user enabled
  if (!AppState.showLabels) {
    const labelsInClone = clone.querySelector('.map-labels-group');
    if (labelsInClone) labelsInClone.remove();
  }

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

    // Title
    ctx.fillStyle = '#0f172a';
    ctx.font = 'bold 44px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('나의 대한민국 여행 Trail Log', 600, 90);

    ctx.fillStyle = '#64748b';
    ctx.font = '500 22px sans-serif';
    ctx.fillText('나의 전국 167개 시·군 여행 발자국', 600, 130);

    // Stats Card
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#e2e8f0';
    ctx.lineWidth = 2;
    roundRect(ctx, 200, 160, 800, 90, 20);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#059669';
    ctx.font = 'bold 34px sans-serif';
    ctx.fillText(`${visitedCount} / ${TOTAL_REGIONS}곳`, 450, 218);

    ctx.fillStyle = '#3b82f6';
    ctx.fillText(`${percentage}% 정복`, 750, 218);

    // Draw Map
    ctx.drawImage(img, 0, 260, 1200, 1260);

    // 5-Level Legend at Bottom
    const legendItems = [
      { label: '거주/고향', color: '#8b5cf6' },
      { label: '단골/자주', color: '#3b82f6' },
      { label: '숙박 여행', color: '#10b981' },
      { label: '당일치기', color: '#6ee7b7' },
      { label: '미방문', color: '#f1f5f9', stroke: '#cbd5e1' }
    ];

    let startX = 260;
    legendItems.forEach(item => {
      ctx.fillStyle = item.color;
      roundRect(ctx, startX, 1540, 22, 22, 4);
      ctx.fill();
      if (item.stroke) {
        ctx.strokeStyle = item.stroke;
        ctx.stroke();
      }
      ctx.fillStyle = '#334155';
      ctx.font = 'bold 18px sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(item.label, startX + 30, 1557);
      startX += 140;
    });

    // Download
    const a = document.createElement('a');
    a.download = `나의_대한민국_여행_Trail_Log_${new Date().toISOString().slice(0,10)}.png`;
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
    a.download = `korea_travel_167_backup_${new Date().toISOString().slice(0,10)}.json`;
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

  // 구글 시트 동기화 버튼 연동
  const btnHeaderSync = document.getElementById('btn-header-sync');
  if (btnHeaderSync) {
    btnHeaderSync.addEventListener('click', () => {
      modal.classList.add('open');
    });
  }

  const btnSyncPull = document.getElementById('btn-sync-pull');
  if (btnSyncPull) {
    btnSyncPull.addEventListener('click', () => syncPullFromSheet(true));
  }

  const btnSyncPush = document.getElementById('btn-sync-push');
  if (btnSyncPush) {
    btnSyncPush.addEventListener('click', () => syncPushToSheet());
  }
}

// --- Google Sheet Real-time Sync ---
const GOOGLE_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbwylu_1JxOFwI66iI3X0Fc7IQz7PiA5zJKjrjZkvNF1XzPKVzmvLZSHnB-bilwVdawE/exec';

async function syncPullFromSheet(showFeedback = true) {
  const statusEl = document.getElementById('sync-status');
  if (statusEl && showFeedback) {
    statusEl.style.display = 'block';
    statusEl.style.color = '#2563eb';
    statusEl.textContent = '⏳ 구글 시트에서 최신 여행 기록을 불러오는 중...';
  }
  try {
    const res = await fetch(`${GOOGLE_SCRIPT_URL}?action=korea`);
    const json = await res.json();
    if (json && json.korea) {
      const incoming = json.korea;
      const count = Object.keys(incoming).length;
      if (count === 0) {
        if (statusEl && showFeedback) {
          statusEl.style.display = 'block';
          statusEl.style.color = '#64748b';
          statusEl.textContent = 'ℹ️ 구글 시트에 아직 저장된 방문 기록이 없습니다.';
        }
        return;
      }
      if (!AppState.data.visited) AppState.data.visited = {};
      Object.keys(incoming).forEach(code => {
        const item = incoming[code];
        if (!AppState.data.visited[code]) {
          AppState.data.visited[code] = { level: 0, visitDate: '', checkedSpots: [], customSpots: [], memo: '' };
        }
        const rec = AppState.data.visited[code];
        rec.level = Number(item.level) || 0;
        rec.visitDate = item.visitDate || item.visitedDate || '';
        rec.checkedSpots = Array.isArray(item.checkedSpots) ? item.checkedSpots : [];
        rec.customSpots = Array.isArray(item.customSpots) ? item.customSpots : [];
        
        // 10대 기본 명소에 없는 체크 항목은 자동으로 customSpots에 복원하여 나만의 랜드마크 누락 방지
        const placeInfo = PLACES_167_DATA[code];
        if (placeInfo && placeInfo.spots) {
          rec.checkedSpots.forEach(s => {
            if (!placeInfo.spots.includes(s) && !rec.customSpots.includes(s)) {
              rec.customSpots.push(s);
            }
          });
        }
        rec.memo = item.memo || '';
      });
      saveStoredData();
      if (statusEl && showFeedback) {
        statusEl.style.display = 'block';
        statusEl.style.color = '#059669';
        statusEl.textContent = `✅ 구글 시트에서 ${count}개 지역 기록을 성공적으로 불러왔습니다!`;
      }
    }
  } catch (err) {
    console.error('Sync pull failed:', err);
    if (statusEl && showFeedback) {
      statusEl.style.display = 'block';
      statusEl.style.color = '#dc2626';
      statusEl.textContent = '❌ 동기화 실패: 네트워크 상태를 확인해 주세요.';
    }
  }
}

async function syncPushToSheet() {
  const statusEl = document.getElementById('sync-status');
  if (statusEl) {
    statusEl.style.display = 'block';
    statusEl.style.color = '#2563eb';
    statusEl.textContent = '⏳ 구글 시트로 현재 지도 기록을 저장하는 중...';
  }
  try {
    const visited = AppState.data.visited || {};
    const count = Object.keys(visited).length;
    const payload = {
      type: 'korea',
      data: visited
    };
    const res = await fetch(GOOGLE_SCRIPT_URL, {
      method: 'POST',
      body: JSON.stringify(payload)
    });
    const json = await res.json();
    if (json && json.status === 'ok') {
      if (statusEl) {
        statusEl.style.display = 'block';
        statusEl.style.color = '#059669';
        statusEl.textContent = `✅ 구글 시트에 ${count}개 기록을 저장했습니다! (PC·모바일 동기화 완료)`;
      }
    } else {
      throw new Error((json && json.message) || '저장 실패');
    }
  } catch (err) {
    console.error('Sync push failed:', err);
    if (statusEl) {
      statusEl.style.display = 'block';
      statusEl.style.color = '#dc2626';
      statusEl.textContent = '❌ 저장 실패: 잠시 후 다시 시도해 주세요.';
    }
  }
}

function debounce(func, wait) {
  let timeout;
  return function(...args) {
    clearTimeout(timeout);
    timeout = setTimeout(() => func.apply(this, args), wait);
  };
}
