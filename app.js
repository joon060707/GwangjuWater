/**
 * 댐 저수율 모니터링 대시보드 - 바닐라 JavaScript
 * 동복댐(전남광주통합특별시상수도사업본부 데이터) 및 주암댐(WAMIS 실시간 데이터) 연동
 */

// ==========================================================================
// 1. 전역 설정
// ==========================================================================
const CONFIG = {
  // 동복댐 GitHub raw json 주소 (상수도사업본부 데이터 미러)
  DONGBOK_API_URL: 'https://raw.githubusercontent.com/joon060707/GwangjuWater/refs/heads/main/data.json',

  // 주암댐 저장소 내 정적 JSON 주소 (GitHub Pages HTTPS 호환)
  JUAM_JSON_PATH: './data2.json',

  // 주암조절지댐(상사댐) 저장소 내 정적 JSON 주소
  JUAM_SUB_JSON_PATH: './data3.json',

  // 주암댐 국가수자원관리종합정보시스템(WAMIS) 오픈API 주소 (대체/로컬용)
  JUAM_WAMIS_BASE_URL: 'http://www.wamis.go.kr:8080/wamis/openapi/wkd/mn_hrdata',
  JUAM_DAM_CODE: '4007110',

  // 자동 새로고침 주기 (분 단위)
  AUTO_REFRESH_MINUTES: 10
};

// ==========================================================================
// 2. 날짜 및 시간 포맷팅 유틸리티
// ==========================================================================
/**
 * 오늘을 기준으로 일 오프셋을 적용한 날짜(YYYYMMDD 8자리)를 반환합니다.
 * @param {number} dayOffset - 일 오프셋 (전날은 -1, 오늘은 0)
 * @returns {string} YYYYMMDD
 */
function getFormattedDateCompact(dayOffset = 0) {
  const d = new Date();
  d.setDate(d.getDate() + dayOffset);

  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}${month}${day}`;
}

/**
 * 일시 문자열을 통일된 시간 단위('YYYY-MM-DD HH:00')로 변환합니다.
 * - '2026-09-21 16:22:45' -> '2026-09-21 16:00'
 * - '2026092116' -> '2026-09-21 16:00'
 * @param {string} timestampStr 
 * @returns {string} YYYY-MM-DD HH:00
 */
function formatToHourUnit(timestampStr) {
  if (!timestampStr) return '-';
  
  // WAMIS obsdh (YYYYMMDDHH 10자리)
  if (/^\d{10}$/.test(timestampStr)) {
    const y = timestampStr.substring(0, 4);
    const m = timestampStr.substring(4, 6);
    const d = timestampStr.substring(6, 8);
    const h = timestampStr.substring(8, 10);
    return `${y}-${m}-${d} ${h}:00`;
  }

  // YYYY-MM-DD HH:mm:ss 형식
  const match = String(timestampStr).match(/^(\d{4}[-./]\d{2}[-./]\d{2})\s+(\d{2})/);
  if (match) {
    const datePart = match[1].replace(/[/.]/g, '-');
    const hourPart = match[2];
    return `${datePart} ${hourPart}:00`;
  }

  return timestampStr;
}

// ==========================================================================
// 3. 단위 변환 및 수치 표준화 유틸리티 (저수량: ㎥, 취수량: ㎥/s)
// ==========================================================================

/**
 * 동복댐 저수량 문자열(예: '50,229천㎥')을 기본 ㎥ 수치로 변환
 * 50,229천 => 50,229,000 ㎥
 */
function formatDongbokStorage(str) {
  if (!str) return '-';
  const numMatch = String(str).replace(/,/g, '').match(/(\d+(?:\.\d+)?)/);
  if (!numMatch) return str;

  let val = parseFloat(numMatch[1]);
  if (str.includes('천')) {
    val = Math.round(val * 1000);
  } else if (str.includes('백만')) {
    val = Math.round(val * 1000000);
  }
  return `${val.toLocaleString('ko-KR')} ㎥`;
}

/**
 * 주암댐 저수량(단위: 백만㎥)을 기본 ㎥ 수치로 변환
 * 210.373 백만㎥ => 210,373,000 ㎥
 */
function formatJuamStorage(rsqty) {
  if (rsqty === undefined || rsqty === null || rsqty === '') return '-';
  const val = parseFloat(rsqty);
  if (isNaN(val)) return '-';
  const totalM3 = Math.round(val * 1000000);
  return `${totalM3.toLocaleString('ko-KR')} ㎥`;
}

/**
 * 동복댐 취수량 문자열(예: '12,144천㎥/시간')을 초당 유량(㎥/s)으로 변환
 * 1시간 = 3,600초로 나누어 ㎥/s로 환산
 */
function formatDongbokIntake(str) {
  if (!str) return '-';
  const numMatch = String(str).replace(/,/g, '').match(/(\d+(?:\.\d+)?)/);
  if (!numMatch) return str;

  const rawVal = parseFloat(numMatch[1]);
  // 시간당 수치이므로 3,600으로 나누어 초당(㎥/s)으로 변환
  const perSec = rawVal / 3600;
  return `${perSec.toFixed(1)} ㎥/s`;
}

/**
 * 주암댐 방류량(tdqty / totdcwtrqy) 포맷팅
 * 단위: ㎥/s (방류량 안에 취수량이 포함됨)
 */
function formatJuamDischarge(val) {
  if (val === undefined || val === null || val === '') return '-';
  const num = parseFloat(val);
  if (isNaN(num)) return '-';
  return `${num.toFixed(1)} ㎥/s`;
}

// ==========================================================================
// 4. 데이터 패치 함수
// ==========================================================================

/**
 * [동복댐] 데이터 조회
 */
async function fetchDongbokDam() {
  const statusEl = document.getElementById('dongbok-status');
  statusEl.textContent = '동복댐 데이터 조회 중...';

  try {
    const cacheBuster = `?_t=${Date.now()}`;
    const response = await fetch(CONFIG.DONGBOK_API_URL + cacheBuster);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const data = await response.json();
    renderDongbokDam(data);
    statusEl.textContent = '정상 수신 완료';
  } catch (error) {
    console.error('동복댐 데이터 조회 오류:', error);
    statusEl.textContent = `데이터 수신 실패 (${error.message})`;
  }
}

/**
 * [주암댐] 데이터 조회
 * 1. GitHub Pages(HTTPS) 환경에서는 저장소 내의 data2.json을 우선 조회하여 Mixed Content 오류 차단
 * 2. data2.json 실패 시 WAMIS 직접 호출 시도 (로컬 환경 등)
 */
async function fetchJuamDam() {
  const statusEl = document.getElementById('juam-status');
  statusEl.textContent = '주암댐 데이터 조회 중...';

  // [1단계] GitHub Pages HTTPS 호환용 data2.json 우선 조회
  try {
    const cacheBuster = `?_t=${Date.now()}`;
    const response = await fetch(CONFIG.JUAM_JSON_PATH + cacheBuster);

    if (response.ok) {
      const juamData = await response.json();
      renderJuamDam(juamData);
      statusEl.textContent = '정상 수신 완료';
      return;
    }
  } catch (err) {
    console.warn('data2.json 조회 실패, WAMIS 직접 호출 시도:', err);
  }

  // [2단계] 로컬 환경 또는 data2.json 부재 시 WAMIS API 직접 호출
  const startdt = getFormattedDateCompact(-1); // 전날
  const enddt = getFormattedDateCompact(0);    // 오늘

  const url = `${CONFIG.JUAM_WAMIS_BASE_URL}?damcd=${CONFIG.JUAM_DAM_CODE}&startdt=${startdt}&enddt=${enddt}&output=json`;

  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const json = await response.json();
    const list = json?.list;

    if (!Array.isArray(list) || list.length === 0) {
      throw new Error('수신된 관측자료가 없습니다.');
    }

    // 가장 마지막 항목이 최신 시각의 관측 데이터
    const latestItem = list[list.length - 1];

    renderJuamDam(latestItem);
    statusEl.textContent = '정상 수신 완료';
  } catch (error) {
    console.error('주암댐 데이터 조회 오류:', error);
    statusEl.textContent = `데이터 수신 실패 (${error.message})`;
  }
}

/**
 * [주암조절지댐 (상사댐)] 데이터 조회
 * 주암본댐과 도수터널로 연계된 조절지댐으로 data3.json을 조회합니다.
 * 연계 참고 수원지이므로 데이터가 없거나 로드 실패 시 상태를 안내합니다.
 */
async function fetchJuamSubDam() {
  const cardEl = document.getElementById('card-juam-sub');
  const statusEl = document.getElementById('juam-sub-status');
  if (!statusEl) return;

  statusEl.textContent = '조절지댐 데이터 조회 중...';

  try {
    const cacheBuster = `?_t=${Date.now()}`;
    const response = await fetch(CONFIG.JUAM_SUB_JSON_PATH + cacheBuster);

    if (response.ok) {
      const data = await response.json();
      renderJuamSubDam(data);
      statusEl.textContent = '정상 수신 완료';
      if (cardEl) cardEl.style.display = '';
    } else {
      throw new Error(`HTTP ${response.status}`);
    }
  } catch (error) {
    console.warn('주암조절지댐 data3.json 조회 실패:', error);
    statusEl.textContent = `데이터 수신 대기 중 (${error.message})`;
  }
}

/**
 * 저수율 수치별 색상 테마 적용
 * - 20% 미만: 빨간색 (.rate-level-danger, .gauge-level-danger)
 * - 30% 미만: 주황색 (.rate-level-warning, .gauge-level-warning)
 * - 40% 미만: 노란색 (.rate-level-caution, .gauge-level-caution)
 * - 40% 이상: 기본 댐 테마 색상 유지
 * @param {number} rateVal - 저수율 수치 (%)
 * @param {HTMLElement} rateEl - 저수율 텍스트 요소
 * @param {HTMLElement} gaugeEl - 게이지 바 요소
 */
function applyRateColorTheme(rateVal, rateEl, gaugeEl) {
  if (!rateEl || !gaugeEl) return;

  // 기존 상태 클래스 초기화
  rateEl.classList.remove('rate-level-caution', 'rate-level-warning', 'rate-level-danger');
  gaugeEl.classList.remove('gauge-level-caution', 'gauge-level-warning', 'gauge-level-danger');

  if (isNaN(rateVal)) return;

  if (rateVal < 20) {
    rateEl.classList.add('rate-level-danger');
    gaugeEl.classList.add('gauge-level-danger');
  } else if (rateVal < 30) {
    rateEl.classList.add('rate-level-warning');
    gaugeEl.classList.add('gauge-level-warning');
  } else if (rateVal < 40) {
    rateEl.classList.add('rate-level-caution');
    gaugeEl.classList.add('gauge-level-caution');
  }
}

// ==========================================================================
// 5. UI 렌더링 함수
// ==========================================================================

/**
 * 동복댐 데이터 화면 출력
 */
function renderDongbokDam(data) {
  const rateVal = parseFloat(data.storage_rate);
  const rateEl = document.getElementById('dongbok-rate');
  const gaugeEl = document.getElementById('dongbok-gauge');
  const amountEl = document.getElementById('dongbok-amount');
  const intakeEl = document.getElementById('dongbok-intake');
  const updatedEl = document.getElementById('dongbok-updated');

  // 저수율 수치 및 게이지
  if (!isNaN(rateVal)) {
    rateEl.textContent = rateVal.toFixed(1);
    gaugeEl.style.width = `${Math.min(Math.max(rateVal, 0), 100)}%`;
  } else {
    rateEl.textContent = data.storage_rate || '--';
  }

  // 저수율 기준별 상태 색상 적용 (40% 미만: 노랑, 30% 미만: 주황, 20% 미만: 빨강)
  applyRateColorTheme(rateVal, rateEl, gaugeEl);

  // 저수량: ㎥ 단위 통일 (50,229,000 ㎥)
  amountEl.textContent = formatDongbokStorage(data.storage_amount);

  // 취수량: ㎥/s 단위 통일 (시간당 / 3600 => 3.4 ㎥/s)
  intakeEl.textContent = formatDongbokIntake(data.intake_amount);

  // 최종 업데이트 시간 (시간 단위 포맷)
  updatedEl.textContent = formatToHourUnit(data.updated_at);
}

/**
 * 주암댐 WAMIS 데이터 화면 출력
 */
function renderJuamDam(item) {
  const rateVal = parseFloat(item.rsrt);
  const rateEl = document.getElementById('juam-rate');
  const gaugeEl = document.getElementById('juam-gauge');
  const amountEl = document.getElementById('juam-amount');
  const dischargeEl = document.getElementById('juam-discharge') || document.getElementById('juam-intake');
  const updatedEl = document.getElementById('juam-updated');

  // 저수율 수치 및 게이지 (rsrt)
  if (!isNaN(rateVal)) {
    rateEl.textContent = rateVal.toFixed(1);
    gaugeEl.style.width = `${Math.min(Math.max(rateVal, 0), 100)}%`;
  } else {
    rateEl.textContent = item.rsrt || '--';
  }

  // 저수율 기준별 상태 색상 적용 (40% 미만: 노랑, 30% 미만: 주황, 20% 미만: 빨강)
  applyRateColorTheme(rateVal, rateEl, gaugeEl);

  // 저수량: ㎥ 단위 통일 (백만㎥ * 1,000,000 => 210,373,000 ㎥)
  amountEl.textContent = formatJuamStorage(item.rsqty);

  // 방류량 (취수량 포함): ㎥/s 단위 통일
  const dischargeVal = (item.tdqty !== undefined && item.tdqty !== null) ? item.tdqty : item.itqty;
  if (dischargeEl) {
    dischargeEl.textContent = formatJuamDischarge(dischargeVal);
  }

  // 최종 업데이트 시간 (시간 단위 포맷)
  updatedEl.textContent = formatToHourUnit(item.obsdh);
}

/**
 * 주암조절지댐 (상사댐) 데이터 화면 출력
 */
function renderJuamSubDam(item) {
  const rateVal = parseFloat(item.rsrt);
  const rateEl = document.getElementById('juam-sub-rate');
  const gaugeEl = document.getElementById('juam-sub-gauge');
  const amountEl = document.getElementById('juam-sub-amount');
  const dischargeEl = document.getElementById('juam-sub-discharge');
  const updatedEl = document.getElementById('juam-sub-updated');

  // 저수율 수치 및 게이지 (rsrt)
  if (!isNaN(rateVal)) {
    rateEl.textContent = rateVal.toFixed(1);
    gaugeEl.style.width = `${Math.min(Math.max(rateVal, 0), 100)}%`;
  } else {
    rateEl.textContent = item.rsrt || '--';
  }

  // 저수율 기준별 상태 색상 적용 (40% 미만: 노랑, 30% 미만: 주황, 20% 미만: 빨강)
  applyRateColorTheme(rateVal, rateEl, gaugeEl);

  // 저수량: ㎥ 단위 통일 (백만㎥ * 1,000,000 => 140,100,000 ㎥)
  amountEl.textContent = formatJuamStorage(item.rsqty);

  // 방류량 (취수량 포함): ㎥/s 단위 통일
  const dischargeVal = (item.tdqty !== undefined && item.tdqty !== null) ? item.tdqty : item.itqty;
  if (dischargeEl) {
    dischargeEl.textContent = formatJuamDischarge(dischargeVal);
  }

  // 최종 업데이트 시간 (시간 단위 포맷)
  updatedEl.textContent = formatToHourUnit(item.obsdh);
}

/**
 * 전체 대시보드 새로고침
 */
async function refreshDashboard() {
  const refreshTimeEl = document.getElementById('last-refresh-time');
  const now = new Date();
  const timeString = now.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

  refreshTimeEl.textContent = `${timeString} 갱신`;

  // 3개 댐(동복댐, 주암본댐, 주암조절지댐) 병렬 호출
  await Promise.allSettled([fetchDongbokDam(), fetchJuamDam(), fetchJuamSubDam()]);
}

// ==========================================================================
// 6. 테마 관리 (다크 / 라이트 모드 토글)
// ==========================================================================
function initTheme() {
  const btnToggle = document.getElementById('btn-theme-toggle');
  const iconMoon = document.getElementById('theme-icon-moon');
  const iconSun = document.getElementById('theme-icon-sun');
  const themeText = document.getElementById('theme-text');

  // 저장된 테마 또는 시스템 다크모드 선호 확인
  const savedTheme = localStorage.getItem('dam_dashboard_theme');
  const systemPrefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  const initialTheme = savedTheme || (systemPrefersDark ? 'dark' : 'light');

  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('dam_dashboard_theme', theme);

    if (theme === 'dark') {
      if (iconMoon) iconMoon.style.display = 'none';
      if (iconSun) iconSun.style.display = 'inline-block';
      if (themeText) themeText.textContent = '라이트 모드';
    } else {
      if (iconMoon) iconMoon.style.display = 'inline-block';
      if (iconSun) iconSun.style.display = 'none';
      if (themeText) themeText.textContent = '다크 모드';
    }
  }

  // 초기 테마 설정
  applyTheme(initialTheme);

  // 버튼 클릭 시 토글
  if (btnToggle) {
    btnToggle.addEventListener('click', () => {
      const currentTheme = document.documentElement.getAttribute('data-theme') || 'light';
      const nextTheme = currentTheme === 'dark' ? 'light' : 'dark';
      applyTheme(nextTheme);
    });
  }
}

// ==========================================================================
// 7. 초기화
// ==========================================================================
function initApp() {
  // 테마 초기화
  initTheme();

  // 초기 데이터 로드
  refreshDashboard();

  // 10분마다 자동 새로고침
  const intervalMs = CONFIG.AUTO_REFRESH_MINUTES * 60 * 1000;
  setInterval(refreshDashboard, intervalMs);
}

// DOM 로드 완료 시 실행
document.addEventListener('DOMContentLoaded', initApp);
