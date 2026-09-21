/**
 * GitHub Actions용 주암댐 WAMIS 데이터 수집 스크립트
 * 외부 npm 패키지 없이 Node.js 표준 내장 기능(fetch, fs)만으로 구동됩니다.
 */
const fs = require('fs');
const path = require('path');

function getFormattedDateCompact(dayOffset = 0) {
  const d = new Date();
  d.setDate(d.getDate() + dayOffset);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}${month}${day}`;
}

async function fetchAndSaveJuam() {
  const startdt = getFormattedDateCompact(-1); // 전날
  const enddt = getFormattedDateCompact(0);    // 오늘
  const damcd = '4007110';                      // 주암댐

  const url = `http://www.wamis.go.kr:8080/wamis/openapi/wkd/mn_hrdata?damcd=${damcd}&startdt=${startdt}&enddt=${enddt}&output=json`;

  console.log(`[WAMIS] 주암댐 데이터 조회 시작: ${url}`);

  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) GitHubActionBot/1.0'
    }
  });

  if (!response.ok) {
    throw new Error(`WAMIS API HTTP 오류: ${response.status} ${response.statusText}`);
  }

  const json = await response.json();
  const list = json?.list;

  if (!Array.isArray(list) || list.length === 0) {
    throw new Error('수신된 관측자료가 비어있습니다.');
  }

  // 최신 관측값 (배열 마지막 항목)
  const latest = list[list.length - 1];

  const resultData = {
    damnm: '주암(본)',
    rsrt: latest.rsrt,       // 저수율 (%)
    rsqty: latest.rsqty,     // 저수량 (백만㎥)
    itqty: latest.itqty,     // 취수량 (㎥/s)
    rwl: latest.rwl,         // 현재수위 (m)
    obsdh: latest.obsdh,     // 관측일시 (YYYYMMDDHH)
    updated_at: new Date().toISOString()
  };

  const outputPath = path.join(__dirname, 'juam.json');
  fs.writeFileSync(outputPath, JSON.stringify(resultData, null, 2), 'utf8');

  console.log('✅ juam.json 저장 완료:', resultData);
}

fetchAndSaveJuam().catch(err => {
  console.error('❌ 주암댐 데이터 수집 실패:', err);
  process.exit(1);
});
