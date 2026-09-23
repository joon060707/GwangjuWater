/**
 * GitHub Actions용 주암댐(본댐 & 조절지댐) 공공데이터 자동 수집 스크립트
 * - 한국수자원공사 다목적댐 운영정보 API (apis.data.go.kr, HTTPS) 단일 호출로 본댐과 조절지댐 동시 수집
 * - 주암(본) => data2.json
 * - 주암(조/상사댐) => data3.json
 * - 한국 표준시(KST, UTC+9) 기준 일시 기록
 */
const fs = require('fs');
const path = require('path');

function getKSTDate(offsetDays = 0, offsetYears = 0) {
  const now = new Date();
  const kst = new Date(now.getTime() + (9 * 60 * 60 * 1000));
  kst.setUTCFullYear(kst.getUTCFullYear() + offsetYears);
  kst.setUTCDate(kst.getUTCDate() + offsetDays);

  const year = kst.getUTCFullYear();
  const month = String(kst.getUTCMonth() + 1).padStart(2, '0');
  const day = String(kst.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getKSTHour() {
  const now = new Date();
  const kst = new Date(now.getTime() + (9 * 60 * 60 * 1000));
  return String(kst.getUTCHours()).padStart(2, '0');
}

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

async function fetchFromDataGoKr(serviceKey) {
  const vdate = getKSTDate(0, 0);
  const vtime = getKSTHour();
  const tdate = getKSTDate(-1, 0);
  const ldate = getKSTDate(0, -1);

  const cleanKey = serviceKey.trim();
  const encodedKey = cleanKey.includes('%') ? cleanKey : encodeURIComponent(cleanKey);
  const url = `https://apis.data.go.kr/B500001/dam/multipurPoseDam/multipurPoseDamlist?tdate=${tdate}&ldate=${ldate}&vdate=${vdate}&vtime=${vtime}&pageNo=5&numOfRows=4&_type=json&serviceKey=${encodedKey}`;

  console.log(`[공공데이터포털] 다목적댐 목록 API 호출 중 (${vdate} ${vtime}시 KST)...`);

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
  console.log(items);
  const list = Array.isArray(items) ? items : (items ? [items] : []);

  if (list.length === 0) {
    throw new Error('API 응답에 댐 항목이 없습니다.');
  }

  // 1. 주암(본) 검색
  const juamMain = list.find(d => d.damnm && d.damnm.includes('주암(본)')) || list.find(d => d.damnm && d.damnm.includes('주암'));
  // 2. 주암(조) 검색 (상사댐)
  const juamSub = list.find(d => d.damnm && d.damnm.includes('주암(조)'));

  const kstTimestamp = getKSTTimestamp();
  const obsdh = `${vdate.replace(/-/g, '')}${vtime}`;

  // 주암(본) 저장 (data2.json)
  if (juamMain) {
    const dataMain = {
      damnm: '주암(본)',
      rsrt: juamMain.rsvwtrt,             // 저수율 (%)
      rsqty: juamMain.nowrsvwtqy,         // 저수량 (백만㎥)
      tdqty: juamMain.totdcwtrqy || '0',  // 방류량 (㎥/s)
      rwl: juamMain.nowlowlevel,          // 현재수위 (m)
      obsdh: obsdh,
      updated_at: kstTimestamp
    };
    fs.writeFileSync(path.join(__dirname, 'data2.json'), JSON.stringify(dataMain, null, 2), 'utf8');
    console.log('✅ data2.json (주암본댐) 저장 완료:', dataMain);
  } else {
    console.warn('⚠️ 주암(본) 항목을 찾지 못했습니다.');
  }

  // 주암(조) 저장 (data3.json)
  if (juamSub) {
    const dataSub = {
      damnm: '주암(조)',
      rsrt: juamSub.rsvwtrt,             // 저수율 (%)
      rsqty: juamSub.nowrsvwtqy,         // 저수량 (백만㎥)
      tdqty: juamSub.totdcwtrqy || '0',  // 방류량 (㎥/s)
      rwl: juamSub.nowlowlevel,          // 현재수위 (m)
      obsdh: obsdh,
      updated_at: kstTimestamp
    };
    fs.writeFileSync(path.join(__dirname, 'data3.json'), JSON.stringify(dataSub, null, 2), 'utf8');
    console.log('✅ data3.json (주암조절지댐) 저장 완료:', dataSub);
  } else {
    console.warn('⚠️ 주암(조) 항목을 찾지 못했습니다.');
  }
}

async function main() {
  const serviceKey = process.env.JUAM_SERVICE_KEY;

  if (!serviceKey || !serviceKey.trim()) {
    console.log('ℹ️ JUAM_SERVICE_KEY 미설정. 기존 data2.json 및 data3.json을 유지합니다.');
    return;
  }

  try {
    await fetchFromDataGoKr(serviceKey.trim());
  } catch (err) {
    console.error('⚠️ 공공데이터 API 호출 실패 (기존 데이터 유지):', err.message);
  }
}

main().catch(err => {
  console.error('오류 발생:', err);
  process.exit(0); // 기존 정적 JSON이 있으므로 워크플로 실패로 중단되지 않도록 처리
});
