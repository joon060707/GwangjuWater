/**
 * GitHub Actions용 주암댐 수문 데이터 자동 수집 스크립트
 * 1. 공공데이터포털(apis.data.go.kr, HTTPS) 키가 등록된 경우 해외 러너에서도 100% 정상 통신
 * 2. 키가 없는 경우 WAMIS(wamis.go.kr:8080) 직접 호출 시도 (국내 환경 호환)
 * 3. 한국 표준시(KST, UTC+9) 기준으로 계산 및 data2.json에 저장
 */
const fs = require('fs');
const path = require('path');

/**
 * 한국 표준시(KST, UTC+9) 기준 날짜 문자열 반환 (YYYY-MM-DD)
 */
function getKSTDate(offsetDays = 0, offsetYears = 0) {
  const now = new Date();
  // 해외 GitHub 서버(UTC)에서도 KST(UTC+9)가 유지되도록 9시간 추가
  const kst = new Date(now.getTime() + (9 * 60 * 60 * 1000));
  kst.setUTCFullYear(kst.getUTCFullYear() + offsetYears);
  kst.setUTCDate(kst.getUTCDate() + offsetDays);

  const year = kst.getUTCFullYear();
  const month = String(kst.getUTCMonth() + 1).padStart(2, '0');
  const day = String(kst.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * 한국 표준시(KST) 기준 YYYYMMDD 반환
 */
function getKSTDateCompact(offsetDays = 0) {
  return getKSTDate(offsetDays).replace(/-/g, '');
}

/**
 * 한국 표준시(KST) 기준 2자리 시간(HH) 반환
 */
function getKSTHour() {
  const now = new Date();
  const kst = new Date(now.getTime() + (9 * 60 * 60 * 1000));
  return String(kst.getUTCHours()).padStart(2, '0');
}

/**
 * 한국 표준시(KST) 기준 'YYYY-MM-DD HH:mm:ss' 포맷 일시 반환
 */
function getKSTTimestamp() {
  const now = new Date();
  const kst = new Date(now.getTime() + (9 * 60 * 60 * 1000));
  const year = kst.getUTCFullYear();
  const month = String(kst.getUTCMonth() + 1).padStart(2, '0');
  const day = String(kst.getUTCDate()).padStart(2, '0');
  const hour = String(kst.getUTCHours()).padStart(2, '0');
  const min = String(kst.getUTCMinutes()).padStart(2, '0');
  const sec = String(kst.getUTCSeconds()).padStart(2, '0');
  return `${year}-${month}-${day} ${hour}:${min}:${sec}`;
}

/**
 * 1. 공공데이터포털(data.go.kr) 다목적댐 API (공식 HTTPS 포트 443 - 해외 GitHub Actions 서버 호환)
 */
async function fetchFromDataGoKr(serviceKey) {
  const vdate = getKSTDate(0, 0);
  const vtime = getKSTHour();
  const tdate = getKSTDate(-1, 0);
  const ldate = getKSTDate(0, -1);

  const cleanKey = serviceKey.trim();
  const encodedKey = cleanKey.includes('%') ? cleanKey : encodeURIComponent(cleanKey);
  const url = `https://apis.data.go.kr/B500001/dam/multipurPoseDam/multipurPoseDamlist?tdate=${tdate}&ldate=${ldate}&vdate=${vdate}&vtime=${vtime}&pageNo=2&numOfRows=10&_type=json&serviceKey=${encodedKey}`;

  console.log(`[공공데이터포털] 주암댐 API 호출 중 (${vdate} ${vtime}시 KST)...`);

  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) GitHubActionsBot/1.0' }
  });

  if (!res.ok) {
    throw new Error(`HTTP ${res.status} (${res.statusText})`);
  }

  const json = await res.json();
  const header = json?.response?.header;
  if (header && header.resultCode !== '00') {
    throw new Error(`API 오류 [${header.resultCode}]: ${header.resultMsg}`);
  }

  const items = json?.response?.body?.items?.item;
  const list = Array.isArray(items) ? items : (items ? [items] : []);
  const juam = list.find(d => d.damnm && d.damnm.includes('주암'));

  if (!juam) {
    throw new Error('응답 목록에서 주암댐 항목을 찾을 수 없습니다.');
  }

  return {
    damnm: juam.damnm || '주암(본)',
    rsrt: juam.rsvwtrt,             // 저수율 (%)
    rsqty: juam.nowrsvwtqy,         // 현재 저수량 (백만㎥)
    tdqty: juam.totdcwtrqy || '0',  // 방류량 (㎥/s, 취수량 포함)
    itqty: juam.totdcwtrqy || '0',
    rwl: juam.nowlowlevel,          // 현재수위 (m)
    obsdh: `${vdate.replace(/-/g, '')}${vtime}`,
    updated_at: getKSTTimestamp()   // 한국 표준시 (KST)
  };
}

/**
 * 2. WAMIS API (국내 환경 전용 오픈API)
 */
async function fetchFromWamis() {
  const startdt = getKSTDateCompact(-1);
  const enddt = getKSTDateCompact(0);
  const url = `http://www.wamis.go.kr:8080/wamis/openapi/wkd/mn_hrdata?damcd=4007110&startdt=${startdt}&enddt=${enddt}&output=json`;

  console.log(`[WAMIS] 주암댐 API 호출 중 (${startdt} ~ ${enddt} KST)...`);

  const res = await fetch(url, {
    signal: AbortSignal.timeout(8000),
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) GitHubActionsBot/1.0' }
  });

  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }

  const json = await res.json();
  const list = json?.list;
  if (!Array.isArray(list) || list.length === 0) {
    throw new Error('수신된 관측자료가 비어있습니다.');
  }

  const latest = list[list.length - 1];
  return {
    damnm: '주암(본)',
    rsrt: latest.rsrt,
    rsqty: latest.rsqty,
    tdqty: latest.tdqty || latest.itqty || '0', // 방류량 (㎥/s, 취수량 포함)
    itqty: latest.itqty || latest.tdqty || '0',
    rwl: latest.rwl,
    obsdh: latest.obsdh,
    updated_at: getKSTTimestamp() // 한국 표준시 (KST)
  };
}

async function main() {
  const serviceKey = process.env.JUAM_SERVICE_KEY;
  let resultData = null;

  // 1. GitHub Secrets에 공공데이터 키(JUAM_SERVICE_KEY)가 등록되어 있으면 data.go.kr 우선 호출 (해외 서버 호환)
  if (serviceKey && serviceKey.trim()) {
    try {
      resultData = await fetchFromDataGoKr(serviceKey.trim());
      console.log('✅ 공공데이터포털(data.go.kr) 주암댐 수신 성공');
    } catch (e) {
      console.warn('⚠️ 공공데이터포털 호출 실패:', e.message);
    }
  }

  // 2. 키가 없거나 실패한 경우 WAMIS 호출 시도
  if (!resultData) {
    try {
      resultData = await fetchFromWamis();
      console.log('✅ WAMIS 주암댐 수신 성공');
    } catch (e) {
      console.error('❌ WAMIS 호출 실패:', e.message);
      throw e;
    }
  }

  // data2.json 파일로 저장
  const outputPath = path.join(__dirname, 'data2.json');
  fs.writeFileSync(outputPath, JSON.stringify(resultData, null, 2), 'utf8');
  console.log('✅ data2.json 저장 완료:', resultData);
}

main().catch(err => {
  console.error('❌ 최종 수집 실패:', err.message);
  process.exit(1);
});
