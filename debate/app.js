/* 토론 반박 보조 - 앱 로직 (빌드 없이 브라우저에서 바로 실행) */
'use strict';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

/* ---------- 저장 ---------- */
const store = {
  get(k, d) { try { const v = localStorage.getItem('dbt.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('dbt.' + k, JSON.stringify(v)); } catch { toast('저장 공간이 부족합니다. 기록을 지워 주세요.'); } }
};
const S = Object.assign({ apiKey: '', model: 'claude-opus-5-5', effort: 'low', fast: false, name: '', rate: 300, sec: 120, fs: 18, beep: false }, store.get('settings', {}));
const saveS = () => store.set('settings', S);
let TEAM = Object.assign({}, TEAM_DEFAULT, store.get('team', {}));
let CUSTOM = store.get('custom', []);
let LOG = store.get('log', []);
let CACHE = store.get('cache', {});
const ST = Object.assign({ opp: '', cross: '', adm: [], sel: null, q: '', poiCtx: '', poi: { team: 0, mine: 0, recv: 0 }, script: '', keys: '', core: '', extra: '', fallacy: '', qs: '', src: '' }, store.get('state', {}));
let saveTimer;
const saveST = () => { clearTimeout(saveTimer); saveTimer = setTimeout(() => store.set('state', ST), 300); };

/* ---------- 공통 ---------- */
function toast(msg, ms = 2600) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('on');
  clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('on'), ms);
}
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = s => esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/\n/g, '<br>');
const plain = s => String(s).replace(/\*\*/g, '');
const charCount = s => plain(s).replace(/\n/g, '').trim().length;
const budgetChars = () => Math.round(S.rate * S.sec / 60);
const mmss = sec => { const neg = sec < 0; sec = Math.abs(Math.round(sec)); return (neg ? '+' : '') + Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0'); };
function hash(s) { let h = 5381; for (let i = 0; i < s.length; i++) h = (h * 33 ^ s.charCodeAt(i)) >>> 0; return h.toString(36); }
function josa(word, a, b) { // 을/를, 은/는, 이/가
  const ch = word.trim().slice(-1); const code = ch.charCodeAt(0);
  if (code < 0xAC00 || code > 0xD7A3) return /[0-9LMNRlmnr]$/.test(ch) ? a : b;
  return (code - 0xAC00) % 28 ? a : b;
}
const allCards = () => CARDS.concat(CUSTOM);

/* ---------- 탭 ---------- */
let curTab = 'reb';
function showTab(id) {
  curTab = id;
  $$('#nav button').forEach(b => b.classList.toggle('on', b.dataset.tab === id));
  $$('.tab').forEach(t => t.classList.toggle('on', t.id === 'tab-' + id));
  if (id === 'log') renderLog();
}
$('#nav').addEventListener('click', e => { const b = e.target.closest('button'); if (b) showTab(b.dataset.tab); });

/* ---------- 스톱워치 ---------- */
const SW = { target: 120, running: false, start: 0, acc: 0, lastElapsed: 0, beeped30: false, beeped0: false };
const swElapsed = () => SW.acc + (SW.running ? (performance.now() - SW.start) / 1000 : 0);
function swToggle() {
  if (SW.running) { SW.acc = swElapsed(); SW.running = false; SW.lastElapsed = SW.acc; }
  else { SW.start = performance.now(); SW.running = true; }
  swRender();
}
function swReset(target) {
  if (target) SW.target = target;
  SW.running = false; SW.acc = 0; SW.beeped30 = SW.beeped0 = false; swRender();
}
function beep(freq = 880, dur = 0.15) {
  if (!S.beep) return;
  try { const a = new (window.AudioContext || window.webkitAudioContext)(); const o = a.createOscillator(); const g = a.createGain(); o.frequency.value = freq; g.gain.value = 0.08; o.connect(g); g.connect(a.destination); o.start(); o.stop(a.currentTime + dur); } catch { }
}
function swRender() {
  const rem = SW.target - swElapsed();
  const cls = !SW.running && SW.acc === 0 ? '' : rem < 0 ? 'over' : rem <= 30 ? 'warn' : 'run';
  for (const el of [$('#swTime'), $('#pTime')]) { el.textContent = mmss(rem); el.className = el.id === 'swTime' ? 'time ' + cls : 'ptime ' + cls; }
  if (SW.running && SW.target > 30 && rem <= 30 && !SW.beeped30) { SW.beeped30 = true; beep(660); }
  if (SW.running && rem <= 0 && !SW.beeped0) { SW.beeped0 = true; beep(990, 0.4); }
}
setInterval(() => { if (SW.running) swRender(); }, 200);
$('#swTime').onclick = swToggle; $('#pTime').onclick = swToggle;
$('#swReset').onclick = () => swReset();
$$('[data-sw]').forEach(b => b.onclick = () => swReset(+b.dataset.sw));

/* ---------- 음성 받아쓰기 ---------- */
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
const stt = { rec: null, on: false, target: null };
function sttStop() {
  stt.on = false;
  if (stt.rec) { try { stt.rec.stop(); } catch { } }
  $$('[data-mic]').forEach(b => b.classList.remove('on'));
  $$('[data-interim]').forEach(el => el.textContent = '');
  stt.rec = null; stt.target = null;
}
function sttToggle(targetId) {
  if (stt.on && stt.target === targetId) { sttStop(); return; }
  if (stt.on) sttStop();
  if (!SR) { toast('이 브라우저는 음성 인식을 지원하지 않습니다. Chrome이나 Edge를 쓰세요.'); return; }
  const r = new SR(); r.lang = 'ko-KR'; r.continuous = true; r.interimResults = true;
  const ta = document.getElementById(targetId); const im = $(`[data-interim="${targetId}"]`);
  r.onresult = e => {
    let interim = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const res = e.results[i];
      if (res.isFinal) {
        const t = res[0].transcript.trim();
        if (t) { ta.value += (ta.value && !/\s$/.test(ta.value) ? ' ' : '') + t + ' '; ta.dispatchEvent(new Event('input')); ta.scrollTop = ta.scrollHeight; }
      } else interim += res[0].transcript;
    }
    if (im) im.textContent = interim ? '… ' + interim : '';
  };
  r.onerror = e => { if (e.error === 'not-allowed' || e.error === 'service-not-allowed') { toast('마이크 권한이 필요합니다. 주소창의 마이크 아이콘에서 허용하세요.'); sttStop(); } };
  r.onend = () => { if (stt.on && stt.rec === r) { try { r.start(); } catch { } } }; // 침묵으로 끊기면 자동 재시작
  stt.rec = r; stt.on = true; stt.target = targetId;
  try { r.start(); } catch { }
  $$(`[data-mic="${targetId}"]`).forEach(b => b.classList.add('on'));
  toast('받아쓰는 중… 다시 누르면 멈춤');
}
document.addEventListener('click', e => {
  const m = e.target.closest('[data-mic]'); if (m) sttToggle(m.dataset.mic);
  const c = e.target.closest('[data-clear]'); if (c) { const ta = document.getElementById(c.dataset.clear); ta.value = ''; ta.dispatchEvent(new Event('input')); ta.focus(); }
});

/* ---------- Claude API ---------- */
let sdkPromise = null;
function loadSDK() {
  // vendor/anthropic-sdk.js (같은 폴더에 포함된 SDK)를 먼저 쓰고, 없으면 CDN에서 불러옴
  if (window.AnthropicSDK) return Promise.resolve(window.AnthropicSDK);
  if (!sdkPromise) sdkPromise = import('https://esm.sh/@anthropic-ai/sdk').then(m => m.default || m.Anthropic).catch(e => { sdkPromise = null; throw e; });
  return sdkPromise;
}
async function getClient() {
  if (!S.apiKey) throw Object.assign(new Error('NOKEY'), { nokey: true });
  const Anthropic = await loadSDK();
  return new Anthropic({ apiKey: S.apiKey, dangerouslyAllowBrowser: true, maxRetries: 1 });
}
function setDot(state) { $('#aiDot').className = 'dot ' + (state || ''); }

function buildSystem() {
  const ev = EVIDENCE.map(e => `[${e.id}] ${e.title}: ${e.fact} (출처: ${e.source})`).join('\n');
  return `너는 대학 수업 토론에서 긍정측 토론자 2(반박 담당)를 실시간으로 돕는 코치다.
논제: "인간은 인공지능을 통제할 수 있다". 우리 팀은 긍정측이다.
사용자는 실제 토론 중에 네 결과를 보고 그대로 소리 내어 말한다. 그러므로:
- 바로 읽을 수 있는 구어체 한국어. 짧은 문장(대부분 40자 이내). 번역투와 불필요한 영어 금지.
- 마크다운 제목·표·코드블록 금지. 강조는 **두 별표**로만, 원고 하나에 3~5곳.
- 요청된 [태그] 형식만 출력한다. 태그 앞뒤에 인사나 설명을 붙이지 않는다.

[사실 규칙: 가장 중요]
- 숫자, 날짜, 기관·법 이름, 인물의 말은 아래 [근거 자료]와 [우리 팀 자료]에 있는 것만 쓴다. 기억에 의존해 새로운 통계나 인용을 만들지 않는다. 상대가 출처를 물었을 때 답할 수 없는 말은 하지 않는다.
- 근거 자료에 없는 사실이 필요하면 숫자 없이 일반론으로 말한다.
- 상대가 든 사실이 의심스러우면 단정하지 말고 "출처 확인 필요"로 표시한다.

[전략]
- 우리 정의: 통제 = 무결점이 아니라 최종 결정권(무엇을 할지 정하고, 어디까지 쓸지 제한하고, 위험하면 멈출 권한).
- 우리 입론의 세 기둥: 설계권 / 규칙 / 선택. 반박은 이 안에서 한다(새 주장 금지).
- 쓸 프레임: 어렵다 ≠ 불가능 / 약하다 ≠ 없다 / 이해 ≠ 통제 / 부작용 ≠ 통제 불능 / 예측 ≠ 사실 / 시험에서 찾은 위험 = 통제 과정 / 능력 ≠ 결정권.
- 팀 역할: 교차조사는 토론자 1·3, 최종발언은 토론자 3. 반박은 최종발언이 이어받을 세 틀(통제의 기준 / 부정측 사례 / 규칙)을 깔아 준다.

${RULES_TEXT}

[우리 팀 자료: 긍정측 입론]
${TEAM.ipron}

[우리 팀 자료: 교차조사 계획]
${TEAM.cross}

[우리 팀 자료: 최종발언 계획]
${TEAM.final}

[근거 자료]
${ev}`;
}

let current = null; // 진행 중인 요청
function abortAI() { if (current) { current.abort(); current = null; setDot('ready'); } }

/* 스트리밍 호출. onText(전체누적텍스트). 반환: {text, content} */
async function aiStream({ messages, maxTokens = 16000, onText }) {
  const client = await getClient();
  abortAI();
  const ac = new AbortController(); current = ac;
  setDot('busy');
  const base = {
    model: S.model, max_tokens: maxTokens, messages,
    system: [{ type: 'text', text: buildSystem(), cache_control: { type: 'ephemeral', ttl: '1h' } }],
    output_config: { effort: S.effort }
  };
  const fastOK = S.fast && S.model === 'claude-opus-5-5';
  const fallbackOK = S.model === 'claude-opus-5-5' || S.model === 'claude-sonnet-5-5';
  let acc = '', got = false;
  const run = async full => {
    let stream;
    if (full && fallbackOK) stream = client.beta.messages.stream({ ...base, ...(fastOK ? { speed: 'fast' } : {}), betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' }, { signal: ac.signal });
    else stream = client.messages.stream({ ...base, ...(full && fastOK ? { speed: 'fast' } : {}) }, { signal: ac.signal });
    for await (const ev of stream) {
      if (ev.type === 'content_block_delta' && ev.delta.type === 'text_delta') { got = true; acc += ev.delta.text; onText(acc); }
    }
    const fm = await stream.finalMessage();
    if (fm.stop_reason === 'refusal' && !got) throw new Error('AI가 이 요청을 거절했습니다. 다른 모델로 바꿔 보세요.');
    return fm;
  };
  try {
    let fm;
    try { fm = await run(true); }
    catch (e) {
      // 빠른 모드·폴백 옵션을 계정에서 못 쓰는 경우: 기본 요청으로 한 번 더
      if (!got && !ac.signal.aborted && (e.status === 400 || e.status === 429 || e.status === 403) && (fastOK || fallbackOK)) fm = await run(false);
      else throw e;
    }
    setDot('ready');
    return { text: acc, content: fm.content };
  } catch (e) {
    if (ac.signal.aborted) { setDot('ready'); return { text: acc, aborted: true, content: null }; }
    setDot('err'); throw e;
  } finally { if (current === ac) current = null; }
}
function errMsg(e) {
  if (e && e.nokey) return 'API 키가 없습니다. 📚 자료·설정 탭에서 입력하세요. (즉석 조립·준비된 답은 키 없이 됩니다)';
  if (e && e.status === 401) return 'API 키가 올바르지 않습니다.';
  if (e && e.status === 429) return '요청이 너무 많습니다(속도 제한). 잠시 뒤 다시.';
  if (e && e.status >= 500) return 'Anthropic 서버 오류. 다시 시도하거나 준비된 카드를 쓰세요.';
  if (e && /Failed to fetch|NetworkError|import|Connection error/i.test(String(e.message))) return '인터넷 연결 문제. 준비된 카드(즉석 조립)를 쓰세요.';
  return '오류: ' + (e && e.message || e);
}

/* 태그 파싱: "[핵심] ... [원고] ..." → {핵심:..., 원고:...} */
function parseTags(text, tags) {
  const re = new RegExp('\\[(' + tags.join('|') + ')\\]', 'g');
  const out = {}; let m, last = null, lastIdx = 0;
  while ((m = re.exec(text))) {
    if (last) out[last] = text.slice(lastIdx, m.index).trim();
    last = m[1]; lastIdx = re.lastIndex;
  }
  if (last) out[last] = text.slice(lastIdx).trim();
  return out;
}
function renderTagged(el, text, tags, big) {
  const p = parseTags(text, tags);
  if (!Object.keys(p).length) { el.innerHTML = fmt(text); return p; }
  el.innerHTML = tags.filter(t => p[t] != null).map(t =>
    `<div class="blk"><div class="lab">${esc(t)}</div><div class="${big && big.includes(t) ? 'quick' : ''}">${fmt(p[t])}</div></div>`).join('');
  return p;
}

function addLog(kind, input, output) {
  LOG.unshift({ t: Date.now(), kind, model: S.model, input, output });
  if (LOG.length > 150) LOG.length = 150;
  store.set('log', LOG);
}
function cacheGet(k) { return CACHE[k]; }
function cachePut(k, v) {
  CACHE[k] = v; const keys = Object.keys(CACHE);
  if (keys.length > 60) delete CACHE[keys[0]];
  store.set('cache', CACHE);
}

/* ---------- ⚡ 반박 ---------- */
const oppTA = $('#oppText'), crossTA = $('#crossNote');
oppTA.value = ST.opp; crossTA.value = ST.cross;

function renderAdmissions() {
  $('#admList').innerHTML = ADMISSIONS.map(a =>
    `<label class="chk"><input type="checkbox" data-adm="${a.id}" ${ST.adm.includes(a.id) ? 'checked' : ''}> <span>${esc(a.label)}</span></label>`).join('');
}
$('#admList').addEventListener('change', e => {
  const id = e.target.dataset.adm; if (!id) return;
  ST.adm = e.target.checked ? [...new Set([...ST.adm, id])] : ST.adm.filter(x => x !== id); saveST();
});

function detect(text) {
  const t = text.toLowerCase();
  return allCards().map(c => {
    const hits = c.keys.filter(k => k && t.includes(k.toLowerCase()));
    return { c, score: hits.length, hits };
  }).filter(x => x.score > 0).sort((a, b) => b.score - a.score);
}
let autoSel = ST.sel == null;
function selectedIds() { return ST.sel || []; }
function renderDetected() {
  const det = detect(oppTA.value);
  if (autoSel) ST.sel = det.slice(0, 3).map(x => x.c.id);
  const showAll = $('#showAll').checked;
  const list = showAll ? allCards().map(c => det.find(d => d.c.id === c.id) || { c, score: 0, hits: [] }) : det;
  const sel = selectedIds();
  $('#detected').innerHTML = list.length ? list.map(({ c, score, hits }) => `
    <div class="argcard ${sel.includes(c.id) ? 'sel' : ''}">
      <input type="checkbox" data-card="${c.id}" ${sel.includes(c.id) ? 'checked' : ''}>
      <div class="t">${esc(c.title || c.label)}${score ? `<span class="score" title="${esc(hits.join(', '))}">${score}</span>` : ''}</div>
      <div class="c">→ ${esc(c.core || '')}</div>
      ${c.fallacy ? `<div class="f">⚠ ${esc(c.fallacy)}</div>` : ''}
      <details><summary>반박 문장 보기</summary>${fmt(c.short + (c.long || ''))}${c.ev && c.ev.length ? `<div class="hint">근거: ${c.ev.map(id => esc((EVIDENCE.find(e => e.id === id) || {}).title || id)).join(', ')}</div>` : ''}</details>
    </div>`).join('') : '<div class="hint">상대 입론에서 아직 감지된 논거가 없습니다. 단어 몇 개만 입력해도 됩니다. \'전체 카드\'를 켜면 직접 고를 수 있습니다.</div>';
  saveST();
}
$('#detected').addEventListener('change', e => {
  const id = e.target.dataset.card; if (!id) return;
  autoSel = false;
  const s = new Set(selectedIds()); e.target.checked ? s.add(id) : s.delete(id);
  ST.sel = [...s]; renderDetected();
});
$('#showAll').onchange = renderDetected;
let detTimer;
oppTA.addEventListener('input', () => { ST.opp = oppTA.value; clearTimeout(detTimer); detTimer = setTimeout(renderDetected, 120); });
crossTA.addEventListener('input', () => { ST.cross = crossTA.value; saveST(); });

/* 출력 영역 */
const outCore = $('#outCore'), outScript = $('#outScript'), outKeys = $('#outKeys');
function setScriptMeta() {
  const n = charCount(outScript.innerText);
  const b = budgetChars();
  $('#scriptMeta').textContent = n ? `${n}자 · 약 ${mmss(n / S.rate * 60)} (목표 ${b}자 · ${mmss(S.sec)})` : '';
  $('#scriptMeta').style.color = n > b * 1.1 ? 'var(--bad)' : '';
}
function renderRebuttal(p, src) {
  if (p.core != null) outCore.innerHTML = fmt(p.core);
  if (p.script != null) { outScript.innerHTML = fmt(p.script); setScriptMeta(); }
  if (p.keys != null) outKeys.innerHTML = fmt(p.keys);
  if (p.extra != null) $('#outExtra').innerHTML = fmt(p.extra);
  if (p.fallacy != null) $('#outFallacy').innerHTML = fmt(p.fallacy);
  if (p.qs != null) renderQs(p.qs);
  if (src) { $('#scriptSrc').hidden = false; $('#scriptSrc').textContent = src; }
}
function renderQs(text) {
  // "Q: ... \n A: ..." 형식 → 클릭 가능한 목록
  const items = []; let cur = null;
  for (const line of String(text).split('\n')) {
    const l = line.trim(); if (!l) continue;
    const mq = l.match(/^[-\d.\s]*Q[:：.]\s*(.*)/i), ma = l.match(/^[-\s]*A[:：.]\s*(.*)/i);
    if (mq) { cur = { q: mq[1], a: '' }; items.push(cur); }
    else if (ma && cur) cur.a += ma[1];
    else if (cur) cur.a += ' ' + l;
  }
  if (!items.length) { $('#outQ').innerHTML = fmt(text); return; }
  const html = items.map(it => `<div class="qa"><div class="q pill-q" data-q="${esc(it.q)}" style="cursor:pointer">Q. ${fmt(it.q)}</div><div>${fmt(it.a)}</div></div>`).join('');
  $('#outQ').innerHTML = html;
  $('#aiQList').innerHTML = items.map(it => `<span class="pill" data-q="${esc(it.q)}">${esc(it.q)}</span>`).join('');
}
document.addEventListener('click', e => {
  const q = e.target.closest('[data-q]'); if (!q) return;
  $('#qText').value = q.dataset.q; $('#qText').dispatchEvent(new Event('input')); showTab('ans'); $('#qText').focus();
});
outScript.addEventListener('input', () => { ST.script = outScript.innerHTML; setScriptMeta(); saveST(); });

const REB_TAGS = ['핵심', '원고', '키워드', '추가', '오류', '예상질문'];
const TAGMAP = { 핵심: 'core', 원고: 'script', 키워드: 'keys', 추가: 'extra', 오류: 'fallacy', 예상질문: 'qs' };
function tagsToP(parsed) { const p = {}; for (const [k, v] of Object.entries(parsed)) p[TAGMAP[k]] = v; return p; }
function persistOut() {
  ST.core = outCore.innerHTML; ST.script = outScript.innerHTML; ST.keys = outKeys.innerHTML;
  ST.extra = $('#outExtra').innerHTML; ST.fallacy = $('#outFallacy').innerHTML; ST.qs = $('#outQ').innerHTML; ST.src = $('#scriptSrc').textContent; saveST();
}
function rebuttalPrompt() {
  const adm = ADMISSIONS.filter(a => ST.adm.includes(a.id)).map(a => '- ' + a.label);
  if (crossTA.value.trim()) adm.push('- ' + crossTA.value.trim());
  const sel = allCards().filter(c => selectedIds().includes(c.id)).map(c => c.title || c.label);
  return `[작업: 반박 원고]
발언 시간: ${S.sec}초. 원고 분량: 공백 포함 ${budgetChars()}자 안팎(±5%). 분량을 반드시 지켜라.
${S.name ? `원고는 "긍정측 반박을 맡은 ${S.name}입니다."로 시작.` : '원고는 인사 없이 바로 시작.'}

부정측 입론(받아쓰기라 오타·끊김이 있을 수 있음):
"""
${oppTA.value.trim() || '(입력 없음: 부정측이 흔히 쓰는 논거를 가정)'}
"""
우리 교차조사에서 부정측이 답하거나 인정한 것:
${adm.length ? adm.join('\n') : '없음'}
사용자가 고른 우선 쟁점: ${sel.length ? sel.join(' / ') : '없음 (네가 우리에게 가장 유리한 2~3개 선택)'}

출력 형식 (이 순서, 태그 그대로):
[핵심]
"상대 논거 → 우리 한마디" 3줄. 각 줄 35자 이내.
[원고]
서론: 부정측 입론을 1~2문장으로 정리.
본론: 상대 논거 2~3개를 "첫째, 둘째, 셋째"로 1:1 반박. 쟁점마다 상대 근거보다 우리 근거가 왜 더 믿을 만한지 비교하는 문장 하나. 교차조사에서 상대가 인정한 것이 있으면 해당 쟁점에서 "부정측도 ~라고 인정했습니다"로 쓴다.
결론: 우리 입장 2문장 이내(입론 문장을 그대로 반복하지 말 것. 고삐 비유는 새 표현으로), "감사합니다."로 끝.
한 문장마다 줄바꿈.
[키워드]
원고 흐름 그대로 6~9줄, 줄마다 15자 이내. 원고를 안 보고 말할 때 보는 메모.
[추가]
원고에 못 넣었지만 쓸 수 있는 반박 3~5개. 줄마다 "- 쟁점: 한두 문장".
[오류]
부정측 입론의 논리 오류 2~4개. 줄마다 "- 오류 이름: 상대 발언 요약 → 한 줄 지적".
[예상질문]
이 반박 직후 부정측 교차조사에서 나올 질문 4개. 각각 "Q: 질문" 다음 줄 "A: 즉답 한 문장 + 보충 한 문장".`;
}
async function genRebuttal(force) {
  const msg = rebuttalPrompt();
  const key = 'reb:' + S.model + ':' + hash(msg);
  const st = $('#rebStatus'); st.className = 'status';
  if (!force && cacheGet(key)) {
    renderRebuttal(tagsToP(parseTags(cacheGet(key), REB_TAGS)), 'AI · 저장됨');
    st.textContent = '같은 입력의 저장된 결과입니다. 새로 만들려면 Ctrl+Shift+Enter.'; persistOut(); return;
  }
  for (const el of [outCore, outScript, outKeys, $('#outExtra'), $('#outFallacy'), $('#outQ')]) el.innerHTML = '';
  st.textContent = 'AI가 쓰는 중… (핵심 3줄이 먼저 나옵니다)';
  const t0 = performance.now(); let first = 0, raf = 0, latest = '';
  try {
    const r = await aiStream({
      messages: [{ role: 'user', content: msg }], maxTokens: 16000,
      onText: acc => {
        if (!first) { first = performance.now(); st.textContent = `첫 글자 ${((first - t0) / 1000).toFixed(1)}초 · 쓰는 중…`; }
        latest = acc;
        if (!raf) raf = requestAnimationFrame(() => { raf = 0; renderRebuttal(tagsToP(parseTags(latest, REB_TAGS)), 'AI'); });
      }
    });
    cancelAnimationFrame(raf);
    renderRebuttal(tagsToP(parseTags(r.text, REB_TAGS)), 'AI');
    if (r.aborted) { st.textContent = '중지했습니다.'; persistOut(); return; }
    st.textContent = `완료 · ${((performance.now() - t0) / 1000).toFixed(1)}초`;
    cachePut(key, r.text); addLog('반박', oppTA.value, r.text); persistOut();
  } catch (e) { st.className = 'status err'; st.textContent = errMsg(e) + ' → 지금은 🧩 즉석 조립을 쓰세요.'; }
}

/* 즉석 조립: AI 없이 준비된 카드로 2분 원고 */
function assemble() {
  let picks = allCards().filter(c => selectedIds().includes(c.id));
  if (!picks.length) picks = detect(oppTA.value).slice(0, 3).map(x => x.c);
  if (!picks.length) { toast('카드를 하나 이상 고르세요 (\'전체 카드\'를 켜면 직접 선택 가능)'); return; }
  const order = detect(oppTA.value).map(x => x.c.id);
  picks.sort((a, b) => (order.indexOf(a.id) + 1 || 99) - (order.indexOf(b.id) + 1 || 99));
  let adm = ADMISSIONS.filter(a => ST.adm.includes(a.id)).slice(0, 2);
  const budget = budgetChars();
  let useLong = picks.length <= 2, shortEnd = false;
  const ord = ['첫째, ', '둘째, ', '셋째, ', '넷째, ', '다섯째, '];
  const build = () => {
    const labels = picks.map(c => c.label);
    const lab = labels.join(', ');
    const parts = [];
    parts.push((S.name ? `긍정측 반박을 맡은 ${S.name}입니다. ` : '') +
      `부정측은 ${lab}${josa(lab, '을', '를')} 근거로 인간이 AI를 통제할 수 없다고 했습니다. 핵심 ${picks.length}가지를 바로잡겠습니다.`);
    picks.forEach((c, i) => parts.push(ord[i] + (c.short || '') + (useLong && c.long ? c.long : '')));
    parts.push((adm.length ? adm.map(a => a.line).join(' ') + ' ' : '') +
      (shortEnd ? '' : '부정측이 보여준 것은 통제가 끊어진 모습이 아니라, 통제가 어렵다는 것, 그리고 그 어려움을 인간이 하나씩 풀어 가고 있다는 사실입니다. ') +
      '통제의 기준은 무결점이 아니라 결정권이고, 그 결정권은 지금도 인간의 손에 있습니다. 감사합니다.');
    return parts.map(p => p.replace(/([.?!])\s+/g, '$1\n')).join('\n\n');
  };
  let text = build();
  while (charCount(text) > budget * 1.08) {
    if (useLong) useLong = false;
    else if (!shortEnd) shortEnd = true;
    else if (adm.length > 1) adm = adm.slice(0, 1);
    else if (picks.length > 1) picks = picks.slice(0, -1);
    else break;
    text = build();
  }
  const keys = ['서론: 상대 논거 ' + picks.length + '개 정리'].concat(picks.map((c, i) => ord[i] + c.label + ' → ' + (c.core || '').split(/[.(]/)[0])).concat(adm.length ? ['상대 인정 활용'] : []).concat(['결론: 어려움 ≠ 불가능, 결정권']);
  const rest = detect(oppTA.value).map(x => x.c).filter(c => !picks.includes(c));
  const qs = QA_BANK.map(q => ({ q, s: picks.reduce((n, c) => n + q.keys.filter(k => c.keys.some(ck => ck.includes(k) || k.includes(ck))).length, 0) }))
    .sort((a, b) => b.s - a.s).slice(0, 4).map(x => `Q: ${x.q.q}\nA: ${x.q.quick} ${x.q.answer}`).join('\n');
  renderRebuttal({
    core: picks.map(c => `${c.label} → ${c.core}`).join('\n'),
    script: text,
    keys: keys.join('\n'),
    extra: rest.length ? rest.map(c => `- ${c.label}: ${c.core}`).join('\n') : '- (감지된 다른 논거 없음)',
    fallacy: picks.filter(c => c.fallacy).map(c => `- ${c.label}: ${c.fallacy}`).join('\n'),
    qs
  }, '즉석 조립');
  $('#rebStatus').className = 'status';
  $('#rebStatus').textContent = `즉석 조립 완료 · ${picks.length}개 쟁점. 원고를 직접 고쳐도 됩니다.`;
  persistOut(); addLog('즉석 조립', oppTA.value, text);
}

$('#btnReb').onclick = () => genRebuttal(false);
$('#btnAsm').onclick = assemble;
$('#btnStop').onclick = () => { abortAI(); sttStop(); };
let keyView = false;
function toggleView() {
  keyView = !keyView; outScript.hidden = keyView; outKeys.hidden = !keyView;
  $('#viewToggle').textContent = keyView ? '원고 보기' : '키워드만 보기';
  if (presentOn) renderPresent();
}
$('#viewToggle').onclick = toggleView;
$('#btnCalib').onclick = () => {
  const n = charCount(outScript.innerText); const t = SW.lastElapsed || SW.acc;
  if (!n || t < 10) { toast('원고를 스톱워치로 재면서 소리 내어 끝까지 읽은 뒤(정지) 누르세요.'); return; }
  S.rate = Math.round(n / t * 60); saveS(); fillSettings(); setScriptMeta();
  toast(`내 속도: ${S.rate}자/분으로 저장. 이제 원고 분량이 ${budgetChars()}자로 맞춰집니다.`, 4000);
};

/* ---------- 발표 모드 ---------- */
let presentOn = false;
function renderPresent() { $('#pBody').innerHTML = (keyView ? outKeys : outScript).innerHTML || '<span class="hint">원고가 없습니다.</span>'; }
function present(on) { presentOn = on; $('#present').classList.toggle('on', on); if (on) { renderPresent(); swRender(); } }
$('#btnPresent').onclick = () => present(true);

/* ---------- 🛡 답변 ---------- */
const qTA = $('#qText'); qTA.value = ST.q;
const ansMode = () => $('input[name=ansMode]:checked').value;
function bigrams(s) { s = s.replace(/\s+/g, ''); const g = new Set(); for (let i = 0; i < s.length - 1; i++) g.add(s.slice(i, i + 2)); return g; }
function matchQA(text, n = 3) {
  const t = text.toLowerCase(); if (!t.trim()) return [];
  const g = bigrams(t);
  return QA_BANK.map(item => {
    const hits = item.keys.filter(k => t.includes(k.toLowerCase())).length;
    const gb = bigrams(item.q.toLowerCase()); let ov = 0; g.forEach(x => { if (gb.has(x)) ov++; });
    return { item, s: hits * 3 + ov / Math.max(4, g.size) * 4 };
  }).filter(x => x.s > 0.8).sort((a, b) => b.s - a.s).slice(0, n);
}
const qaHTML = it => `<div class="qa"><div class="q">Q. ${esc(it.q)}</div><div class="a1">${esc(it.quick)}</div><div>${esc(it.answer)}</div><div class="tr">함정: ${esc(it.trap)}</div></div>`;
function renderQAMatch() {
  const m = matchQA(qTA.value);
  $('#qaMatch').innerHTML = m.map(x => qaHTML(x.item)).join('');
  ST.q = qTA.value; saveST();
}
let qTimer; qTA.addEventListener('input', () => { clearTimeout(qTimer); qTimer = setTimeout(renderQAMatch, 100); });
$('#qaAll').innerHTML = QA_BANK.map(qaHTML).join('');

async function genAnswer() {
  const q = qTA.value.trim(); if (!q) { toast('질문을 입력하세요'); return; }
  const poi = ansMode() === 'poi';
  const msg = `[작업: ${poi ? '보충질의 즉답 (받은 즉시 30초 안에 답해야 함)' : '교차조사 답변 (질문자의 시간이므로 짧게)'}]
지금 부정측이 나에게 한 질문(받아쓰기라 오타 가능):
"""
${q}
"""
참고: 내가 한 반박 원고:
"""
${plain(outScript.innerText).trim().slice(0, 1500) || '(아직 없음)'}
"""
참고: 부정측 입론:
"""
${oppTA.value.trim().slice(0, 1500) || '(없음)'}
"""
규칙: 예/아니오 질문이면 "예." 또는 "아니오."로 먼저 답하고 바로 이유. 불리한 사실은 짧게 인정하고 우리 틀(결정권, 약함≠없음, 어려움≠불가능)로 다시 가져온다. 질문의 함정을 피한다. 말 돌리기 금지.
출력 형식:
[즉답]
한 문장, 30자 이내.
[답변]
즉답 뒤에 이어 말할 내용, ${poi ? '약 90자' : '약 120자'}.
[함정]
이 질문이 노리는 것 한 줄.
[역공]
되물을 수 있는 한 문장. 지금 쓰기 위험하면 "반박·최종발언으로 넘길 것:"으로 시작.`;
  const st = $('#ansStatus'); st.className = 'status'; st.textContent = 'AI가 답 쓰는 중…';
  const out = $('#ansOut'); out.innerHTML = '';
  const tags = ['즉답', '답변', '함정', '역공'];
  const t0 = performance.now();
  try {
    const r = await aiStream({ messages: [{ role: 'user', content: msg }], maxTokens: 8000, onText: acc => renderTagged(out, acc, tags, ['즉답']) });
    renderTagged(out, r.text, tags, ['즉답']);
    st.textContent = r.aborted ? '중지했습니다.' : `완료 · ${((performance.now() - t0) / 1000).toFixed(1)}초`;
    if (!r.aborted) addLog(poi ? '보충질의 답변' : '교차조사 답변', q, r.text);
  } catch (e) { st.className = 'status err'; st.textContent = errMsg(e) + ' → 왼쪽 준비된 답을 쓰세요.'; }
}
$('#btnAns').onclick = genAnswer;

/* ---------- 🎯 보충질의 ---------- */
const poiTA = $('#poiCtx'); poiTA.value = ST.poiCtx;
function renderPoiCount() { $('#poiTeam').textContent = ST.poi.team; $('#poiMine').textContent = ST.poi.mine; $('#poiRecv').textContent = ST.poi.recv; }
$$('[data-poi]').forEach(b => b.onclick = () => {
  const [k, d] = b.dataset.poi.split(','); const max = { team: 3, mine: 1, recv: 9 }[k];
  ST.poi[k] = Math.max(0, Math.min(max, ST.poi[k] + +d));
  if (k === 'mine' && +d > 0 && ST.poi.team < 3) ST.poi.team++;
  renderPoiCount(); saveST();
});
function renderPoiBank() {
  const t = ((poiTA.value || '') + ' ' + oppTA.value).toLowerCase();
  const ranked = POI_BANK.map(p => ({ p, s: p.keys.filter(k => t.includes(k.toLowerCase())).length + (p.star ? 0.5 : 0) })).sort((a, b) => b.s - a.s);
  $('#poiBank').innerHTML = ranked.map(({ p, s }) => `<div class="qa"><div class="q">${p.star ? '★ ' : ''}${esc(p.q)} ${s >= 1 ? '<span class="score">관련</span>' : ''}</div><div class="hint">${esc(p.use)}</div></div>`).join('');
}
let pTimer; poiTA.addEventListener('input', () => { ST.poiCtx = poiTA.value; saveST(); clearTimeout(pTimer); pTimer = setTimeout(renderPoiBank, 120); });
async function genPoi() {
  const ctx = poiTA.value.trim() || oppTA.value.trim();
  const msg = `[작업: 내 보충질의 1회]
지금 부정측이 말하고 있는 내용(받아쓰기):
"""
${ctx || '(없음: 부정측이 흔히 쓰는 논거를 가정)'}
"""
부정측 입론 전체:
"""
${oppTA.value.trim().slice(0, 1500) || '(없음)'}
"""
우리 팀이 이미 쓴 보충질의 수: ${ST.poi.team}/3
조건: 상대 발언 중 일어나서 하는 질문. 질문 자체는 한 문장 40자 이내. 예/아니오나 단답이 나오게 만들고, 어느 쪽 답이 나와도 우리에게 유리해야 한다. 우리 최종발언 계획("규제가 필요하다"는 답을 받으면 활용)과 연결되면 우선.
출력 형식:
[추천]
질문 한 문장
이유: 한 줄
[후보]
- 질문 2개
[활용]
"~라고 답하면 → 우리가 할 말" 2~3줄`;
  const st = $('#poiStatus'); st.className = 'status'; st.textContent = 'AI가 질문 만드는 중…';
  const out = $('#poiOut'); out.innerHTML = '';
  const tags = ['추천', '후보', '활용'];
  try {
    const r = await aiStream({ messages: [{ role: 'user', content: msg }], maxTokens: 8000, onText: acc => renderTagged(out, acc, tags, ['추천']) });
    renderTagged(out, r.text, tags, ['추천']);
    st.textContent = r.aborted ? '중지했습니다.' : '완료';
    if (!r.aborted) addLog('보충질의', ctx, r.text);
  } catch (e) { st.className = 'status err'; st.textContent = errMsg(e) + ' → 왼쪽 준비된 질의를 쓰세요.'; }
}
$('#btnPoi').onclick = genPoi;

/* ---------- 🧪 연습 ---------- */
let mockIpronText = '';
$('#btnMockIpron').onclick = async () => {
  const pool = CARDS.slice().sort(() => Math.random() - 0.5).slice(0, 3).map(c => c.title);
  const msg = `[작업: 모의 부정측 입론]
연습용이다. 실제 대학 토론의 부정측 토론자 1처럼 2분 30초 분량(공백 포함 약 750자) 입론을 써라.
서론(통제의 뜻을 엄격하게 정의) - 논거 3개(첫째, 둘째, 셋째) - 결론.
이번에 쓸 논거: ${pool.join(' / ')}.
사례는 근거 자료에 있는 사실 위주로, 실제 부정측처럼 설득력 있게.
출력: [입론] 다음에 원고만.`;
  const out = $('#mockIpron'); out.innerHTML = ''; $('#mockStatus').textContent = '';
  try {
    const r = await aiStream({ messages: [{ role: 'user', content: msg }], maxTokens: 8000, onText: acc => { out.innerHTML = fmt(acc.replace('[입론]', '').trim()); } });
    mockIpronText = r.text.replace('[입론]', '').trim(); out.innerHTML = fmt(mockIpronText);
    addLog('모의 부정측 입론', pool.join(' / '), mockIpronText);
  } catch (e) { out.textContent = errMsg(e); }
};
$('#btnMockSend').onclick = () => {
  if (!mockIpronText) { toast('먼저 모의 입론을 만드세요'); return; }
  oppTA.value = mockIpronText; oppTA.dispatchEvent(new Event('input')); autoSel = true; renderDetected(); showTab('reb'); swReset(120);
  toast('반박 탭에 넣었습니다. 감지된 카드를 보고 반박해 보세요.');
};
let mockMsgs = [];
function chatAdd(cls, html) { const d = document.createElement('div'); d.className = 'm ' + cls; d.innerHTML = html; $('#mockChat').appendChild(d); d.scrollIntoView({ block: 'nearest' }); return d; }
async function mockTurn(userContent) {
  mockMsgs.push({ role: 'user', content: userContent });
  const bubble = chatAdd('ai', '…');
  const tags = ['평가', '더 나은 답', '질문'];
  try {
    const r = await aiStream({ messages: mockMsgs, maxTokens: 8000, onText: acc => renderTagged(bubble, acc, tags, ['질문']) });
    renderTagged(bubble, r.text, tags, ['질문']);
    if (r.aborted || !r.content) { mockMsgs.pop(); return; }
    mockMsgs.push({ role: 'assistant', content: r.content });
    addLog('모의 교차조사', typeof userContent === 'string' ? userContent.slice(0, 300) : '', r.text);
    swReset(30);
  } catch (e) { bubble.textContent = errMsg(e); mockMsgs.pop(); }
}
$('#btnMockStart').onclick = () => {
  const script = plain(outScript.innerText).trim();
  if (!script) { toast('반박 탭에 원고가 있어야 합니다 (AI 생성이나 즉석 조립)'); return; }
  mockMsgs = []; $('#mockChat').innerHTML = '';
  mockTurn(`[작업: 모의 교차조사]
연습용 역할극이다. 너는 부정측 토론자 1이고, 방금 긍정측 반박을 들었다. 교차조사 요령(짧은 폐쇄형 질문, 예상 가능한 답을 유도해 함정으로 연결, 상대의 약한 고리 공략)을 따라 질문을 한 번에 하나씩 한다.
긍정측 반박 원고:
"""
${script}
"""
출력 형식: [질문] 다음에 질문 한 문장만.`);
};
$('#btnMockReply').onclick = () => {
  const a = $('#mockAns').value.trim(); if (!a) { toast('답변을 입력하세요'); return; }
  if (!mockMsgs.length) { toast('먼저 시작을 누르세요'); return; }
  chatAdd('me', esc(a)); $('#mockAns').value = '';
  mockTurn(`[내 답변] ${a}
이 답변을 평가하고 다음 질문을 해라. 출력 형식:
[평가]
10점 만점 점수와 한 줄 이유
[더 나은 답]
즉답 한 문장 + 보충 한 문장
[질문]
다음 질문 한 문장`);
};
$('#btnFeedback').onclick = async () => {
  const script = plain(outScript.innerText).trim();
  if (!script) { toast('반박 탭에 원고가 있어야 합니다'); return; }
  const t = SW.lastElapsed || SW.acc;
  const msg = `[작업: 반박 피드백]
내 반박 원고:
"""
${script}
"""
${t >= 10 ? `실제로 말한 시간: ${Math.round(t)}초 (제한 ${S.sec}초).` : '실제로 말한 시간: 측정 안 함.'} 글자 수 ${charCount(script)}자, 내 속도 ${S.rate}자/분.
부정측 입론:
"""
${oppTA.value.trim().slice(0, 1500) || '(없음)'}
"""
반박 구성 원칙 A~H 기준으로 평가. 출력 형식:
[점수]
10점 만점과 한 줄 총평
[잘한 점]
2개
[고칠 점]
3개, 각각 "원문 → 고친 문장"
[시간]
시간 조절 조언 한 줄`;
  const out = $('#feedbackOut'); out.innerHTML = '';
  const tags = ['점수', '잘한 점', '고칠 점', '시간'];
  try {
    const r = await aiStream({ messages: [{ role: 'user', content: msg }], maxTokens: 8000, onText: acc => renderTagged(out, acc, tags) });
    renderTagged(out, r.text, tags); addLog('반박 피드백', script, r.text);
  } catch (e) { out.textContent = errMsg(e); }
};

/* ---------- 📚 자료·설정 ---------- */
function fillSettings() {
  $('#sKey').value = S.apiKey; $('#sModel').value = S.model; $('#sEffort').value = S.effort; $('#sFast').checked = S.fast;
  $('#sName').value = S.name; $('#sRate').value = S.rate; $('#sSec').value = S.sec; $('#sFs').value = S.fs; $('#sBeep').checked = S.beep;
  $('#sChars').textContent = budgetChars();
  document.documentElement.style.setProperty('--fs', S.fs + 'px');
  $('#sFast').disabled = S.model !== 'claude-opus-5-5';
  setDot(S.apiKey ? '' : 'err');
}
const bindS = (id, key, conv = v => v, ev = 'change') => $(id).addEventListener(ev, e => {
  const el = e.target; S[key] = conv(el.type === 'checkbox' ? el.checked : el.value); saveS(); fillSettings(); setScriptMeta();
});
bindS('#sKey', 'apiKey', v => v.trim());
bindS('#sModel', 'model'); bindS('#sEffort', 'effort'); bindS('#sFast', 'fast');
bindS('#sName', 'name', v => v.trim(), 'input');
bindS('#sRate', 'rate', v => Math.max(150, Math.min(500, +v || 300)));
bindS('#sSec', 'sec', v => Math.max(30, Math.min(300, +v || 120)));
bindS('#sFs', 'fs', v => +v, 'input'); bindS('#sBeep', 'beep');

$('#btnWarm').onclick = async () => {
  const st = $('#warmStatus'); st.className = 'status'; st.textContent = '연결 중…';
  try {
    const client = await getClient(); setDot('busy');
    const t0 = performance.now();
    const params = {
      model: S.model, max_tokens: 0, messages: [{ role: 'user', content: '준비' }],
      system: [{ type: 'text', text: buildSystem(), cache_control: { type: 'ephemeral', ttl: '1h' } }],
      output_config: { effort: S.effort }
    };
    if (S.fast && S.model === 'claude-opus-5-5') params.speed = 'fast';
    let r;
    try { r = await client.messages.create(params); }
    catch (e) { if (e.status === 400 && params.speed) { delete params.speed; r = await client.messages.create(params); } else throw e; }
    const u = r.usage || {};
    setDot('ready');
    st.textContent = `연결됨 · ${((performance.now() - t0) / 1000).toFixed(1)}초 · 캐시 ${u.cache_creation_input_tokens ? '저장' : u.cache_read_input_tokens ? '이미 있음' : '없음(내용이 짧음)'}`;
  } catch (e) {
    // max_tokens 0을 못 받는 경우: 아주 짧은 실제 요청으로 연결만 확인
    if (e && e.status === 400) {
      try {
        const r = await aiStream({ messages: [{ role: 'user', content: '연결 확인. "준비 완료"라고만 답해.' }], maxTokens: 2000, onText: () => { } });
        st.textContent = '연결됨 · ' + r.text.trim().slice(0, 20); return;
      } catch (e2) { e = e2; }
    }
    setDot('err'); st.className = 'status err'; st.textContent = errMsg(e);
  }
};

function fillTeam() { $('#tIpron').value = TEAM.ipron; $('#tCross').value = TEAM.cross; $('#tFinal').value = TEAM.final; }
for (const [id, k] of [['#tIpron', 'ipron'], ['#tCross', 'cross'], ['#tFinal', 'final']]) {
  $(id).addEventListener('input', e => { TEAM[k] = e.target.value; store.set('team', TEAM); });
}
$('#btnTeamReset').onclick = () => { if (confirm('팀 자료를 처음 값으로 되돌릴까요?')) { TEAM = Object.assign({}, TEAM_DEFAULT); store.set('team', {}); fillTeam(); } };
$('#evList').innerHTML = EVIDENCE.map(e => `<div class="ev"><b>${esc(e.title)}</b> ${e.check ? '<span class="chkflag">⚠ 최신 확인</span>' : ''}<br>${esc(e.fact)} <span class="hint">(${esc(e.source)})</span></div>`).join('');

function renderCustom() {
  $('#customList').innerHTML = CUSTOM.map((c, i) => `<div class="ev"><b>${esc(c.label)}</b> <span class="hint">${esc(c.keys.join(', '))}</span> <button class="btn" data-delcard="${i}">삭제</button><br>${esc(c.short)}</div>`).join('');
}
$('#btnAddCard').onclick = () => {
  const label = $('#cLabel').value.trim(), keys = $('#cKeys').value.split(/[,，]/).map(s => s.trim()).filter(Boolean), text = $('#cText').value.trim();
  if (!label || !keys.length || !text) { toast('이름, 키워드, 반박 문장을 모두 입력하세요'); return; }
  CUSTOM.push({ id: 'u' + Date.now(), label, title: label + ' (내 카드)', keys, core: $('#cCore').value.trim() || label, fallacy: '', short: text, long: '', ev: [] });
  store.set('custom', CUSTOM); renderCustom(); renderDetected();
  for (const id of ['#cLabel', '#cKeys', '#cCore', '#cText']) $(id).value = '';
  toast('카드를 추가했습니다');
};
$('#customList').addEventListener('click', e => {
  const i = e.target.dataset.delcard; if (i == null) return;
  CUSTOM.splice(+i, 1); store.set('custom', CUSTOM); renderCustom(); renderDetected();
});

/* ---------- 🗂 기록 ---------- */
function renderLog() {
  $('#logList').innerHTML = LOG.length ? LOG.map(l => `<div class="log"><b>${esc(l.kind)}</b> <span class="hint">${new Date(l.t).toLocaleString('ko-KR')} · ${esc(l.model || '')}</span>
    ${l.input ? `<details><summary class="hint">입력</summary><pre>${esc(l.input)}</pre></details>` : ''}<pre>${esc(l.output)}</pre></div>`).join('') : '<div class="hint">아직 기록이 없습니다.</div>';
}
$('#btnExport').onclick = () => {
  const md = '# 토론 기록\n\n' + LOG.slice().reverse().map(l => `## ${l.kind} (${new Date(l.t).toLocaleString('ko-KR')})\n\n${l.input ? '**입력**\n\n' + l.input + '\n\n' : ''}**결과**\n\n${l.output}\n`).join('\n---\n\n');
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([md], { type: 'text/markdown' }));
  a.download = '토론기록_' + new Date().toISOString().slice(0, 10) + '.md'; a.click();
};
$('#btnClearLog').onclick = () => { if (confirm('기록과 저장된 AI 결과를 모두 지울까요?')) { LOG = []; CACHE = {}; store.set('log', LOG); store.set('cache', CACHE); renderLog(); } };

/* ---------- 단축키 ---------- */
document.addEventListener('keydown', e => {
  if (presentOn) {
    if (e.key === 'Escape') present(false);
    else if (e.code === 'Space') swToggle();
    else if (e.key === 'r' || e.key === 'R' || e.key === 'ㄱ') swReset();
    else if (e.key === 'k' || e.key === 'K' || e.key === 'ㅏ') toggleView();
    else if (e.key === '+' || e.key === '=') { S.fs = Math.min(40, S.fs + 2); saveS(); fillSettings(); }
    else if (e.key === '-') { S.fs = Math.max(12, S.fs - 2); saveS(); fillSettings(); }
    else return;
    e.preventDefault(); return;
  }
  const mod = e.ctrlKey || e.metaKey;
  if (mod && e.key === 'Enter') {
    e.preventDefault();
    if (curTab === 'reb') genRebuttal(e.shiftKey);
    else if (curTab === 'ans') genAnswer();
    else if (curTab === 'poi') genPoi();
    else if (curTab === 'mock') $('#btnMockReply').click();
    return;
  }
  if (e.key === 'F2') { e.preventDefault(); swToggle(); return; }
  if (e.key === 'Escape') { abortAI(); sttStop(); return; }
  if (e.altKey && !mod) {
    const n = { Digit1: 'reb', Digit2: 'ans', Digit3: 'poi', Digit4: 'mock', Digit5: 'set', Digit6: 'log' }[e.code];
    if (n) { e.preventDefault(); showTab(n); return; }
    const act = {
      KeyS: swToggle, KeyR: () => swReset(), KeyA: () => { showTab('reb'); assemble(); }, KeyP: () => present(true),
      KeyM: () => sttToggle({ reb: 'oppText', ans: 'qText', poi: 'poiCtx', mock: 'mockAns' }[curTab] || 'oppText')
    }[e.code];
    if (act) { e.preventDefault(); act(); }
  }
});

/* ---------- 시작 ---------- */
fillSettings(); fillTeam(); renderAdmissions(); renderCustom(); renderPoiCount(); renderPoiBank();
renderDetected(); renderQAMatch();
if (ST.script) {
  outCore.innerHTML = ST.core; outScript.innerHTML = ST.script; outKeys.innerHTML = ST.keys;
  $('#outExtra').innerHTML = ST.extra; $('#outFallacy').innerHTML = ST.fallacy; $('#outQ').innerHTML = ST.qs;
  if (ST.src) { $('#scriptSrc').hidden = false; $('#scriptSrc').textContent = ST.src; }
  setScriptMeta();
}
swRender();
if (S.apiKey) loadSDK().then(() => setDot('ready')).catch(() => setDot('err')); // SDK 미리 불러오기
