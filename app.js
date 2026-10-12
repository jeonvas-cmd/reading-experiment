// 실험 흐름: 참가자 번호 → (기록이 있으면 이어서 하기/처음부터) → 실험 메뉴 ⇄ 연습·본 Trial → 실험 종료(기록 묶음을 다운로드 폴더에도 내려받음).
// 안내(OT)는 처음 연습이나 Trial을 시작할 때 한 번 보인다.
// Trial: 읽기(중단 전, 한 문장씩) → 중단 영상(영상이 끝나면 넘어감) → cue(MDDS·상황 모델만) → 퀴즈 1(자유 회상) → 퀴즈 2(T/F 한 문제씩) → 설문(7점 한 문항씩) → Word 파일(서버).
// 모든 기록은 S.data 하나에 쌓이고, 단계마다 자동 저장된다.
// 저장 방식은 두 가지다: 서버 모드(python experiment/server.py, data/ 폴더에 저장)와
// 서버 없는 모드(config.mode = 'static', GitHub Pages): 브라우저 저장 + 실험 끝 zip 다운로드 + Trial마다 Google 드라이브 전송(static_store.js).
// P99는 연구자 체험용 번호다(배정은 P01과 같고, 기록에 test 표시가 남는다).
'use strict';

const DEBUG = new URLSearchParams(location.search).get('debug') === '1';
const TEST_PID = 'P99';
const T0 = performance.now();
const app = document.getElementById('app');
const S = { cfg: null, stim: null, cb: null, prac: null, qs: null, pid: null, data: null, lastSaveOk: null };

// 안내 문구. 연구자가 바꾸기 쉽게 한곳에 둔다.
const TXT = {
  ot: [
    ['실험 안내', ['이 실험에서는 짧은 소설 세 편을 읽습니다.',
      '글은 한 문장씩 나타납니다. <span class="key">Space</span>를 누르면 다음 문장으로 넘어갑니다.',
      '지나간 문장으로는 돌아갈 수 없습니다. 평소 소설을 읽듯 한 문장씩 이해하며 읽어 주세요.']],
    ['진행 순서', ['글을 읽는 도중에 영상 시청으로 넘어갑니다. 영상이 끝나면 자동으로 다음 단계로 넘어갑니다.',
      '그다음 방금 읽은 글에 관한 질문에 글로 답합니다. 시간 제한은 없으니 생각나는 대로 충분히 적어 주세요.',
      '먼저 짧은 글로 연습을 해 보겠습니다.']],
  ],
  readHint: 'Space: 다음 문장',
  cueTitle: '앞에서 읽은 내용',
  cueHint: '지금까지 읽은 글의 내용 일부입니다. 읽어 본 뒤 <span class="key">Space</span>를 누르거나 버튼을 눌러 다음으로 넘어가세요.',  // 최소 시간(cue_min_sec)은 안내하지 않고 그동안 버튼과 Space를 막아 둔다
};

// ---------- 시각·기록·저장 ----------
const stamp = () => ({ t: Math.round((performance.now() - T0) * 10) / 10, iso: new Date().toISOString() });
const dur = (a, b) => Math.round((b.t - a.t) * 10) / 10;
const logEvent = (type, detail = {}) => { if (S.data) S.data.events.push({ type, ...stamp(), ...detail }); };
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function dot(state) { const d = document.getElementById('save-dot'); d.className = state; }

let saveChain = Promise.resolve();
function save(stage) {
  if (!S.data) return Promise.resolve();
  S.data.meta.stage = stage;
  saveChain = saveChain.then(async () => {
    const body = JSON.stringify({ pid: S.pid, data: S.data });
    let local = true;
    try { localStorage.setItem('exp_' + S.pid, body); } catch (e) { local = false; }
    if (S.STATIC) {  // 서버 없는 모드: 브라우저 저장소가 기록의 원본이다
      S.lastSaveOk = local; dot(local ? 'ok' : 'bad');
      if (!local) S.data.events.push({ type: 'save_failed', stage, error: 'localStorage 저장 실패(용량)', ...stamp() });
      return;
    }
    try {
      const r = await fetch('/api/save', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      S.lastSaveOk = true; dot('ok');
    } catch (e) {
      S.lastSaveOk = false; dot('bad');
      S.data.events.push({ type: 'save_failed', stage, error: String(e), ...stamp() });
    }
  });
  return saveChain;
}

addEventListener('pagehide', () => {
  if (S.data && !S.STATIC) navigator.sendBeacon('/api/save', new Blob([JSON.stringify({ pid: S.pid, data: S.data })], { type: 'application/json' }));
});
addEventListener('beforeunload', (e) => { if (S.data && !S.data.meta.finished) { e.preventDefault(); e.returnValue = ''; } });
document.addEventListener('visibilitychange', () => logEvent('visibility', { state: document.visibilityState }));
document.addEventListener('fullscreenchange', () => logEvent('fullscreen', { on: !!document.fullscreenElement }));
// Space는 문장 넘기기 전용이다(글쓰기 칸 제외). 읽기 직후 Space를 더 눌러도 버튼이 눌리지 않게, 버튼은 Space·Enter로 누를 수 없다.
addEventListener('keydown', (e) => {
  if (e.code === 'Space' && !/INPUT|TEXTAREA/.test(e.target.tagName)) e.preventDefault();
  if (e.key === 'Enter' && e.target.tagName === 'BUTTON') e.preventDefault();
});
document.addEventListener('contextmenu', (e) => e.preventDefault());

// ---------- 작은 도구 ----------
const waitClick = (el) => new Promise((resolve) => el.addEventListener('click', resolve, { once: true }));
async function sha12(text) {
  try {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 12);
  } catch (e) { return null; }
}
function panel(html) { app.innerHTML = `<section class="panel">${html}</section>`; return app.querySelector('.panel'); }
// 안내 화면: 버튼 클릭이나 Space로 넘어간다. 화면이 뜬 직후 250ms 동안의 Space와 꾹 누른 반복 입력은 무시해, 앞 화면에서 누른 Space로 건너뛰지 않게 한다.
function waitClickOrSpace(btn) {
  const t0 = performance.now();
  return new Promise((resolve) => {
    const onKey = (e) => {
      if (e.code !== 'Space' || e.repeat || btn.disabled || performance.now() - t0 < 250) return;
      removeEventListener('keydown', onKey); resolve('key');
    };
    addEventListener('keydown', onKey);
    btn.addEventListener('click', () => { removeEventListener('keydown', onKey); resolve('click'); }, { once: true });
  });
}
async function message(title, lines, button = '다음') {
  const p = panel(`<h2>${title}</h2>${lines.map((l) => `<p>${l}</p>`).join('')}<button type="button">${button}</button>`);
  return waitClickOrSpace(p.querySelector('button'));
}
// 서버 모드는 이 컴퓨터의 파일(/videos/), 서버 없는 모드는 원본 주소(config의 url, 국가유산채널 HTTPS)를 쓴다.
const videoUrl = (v) => (S.STATIC && v.url) ? v.url : '/videos/' + encodeURIComponent(v.file);

// ---------- 1. 참가자 번호 ----------
async function idScreen() {
  const n = Object.keys(S.cb).length;
  const p = panel(`<h1>읽기 실험</h1>
    <p>참가자 번호를 입력하세요. (예: P01)</p>
    <input type="text" id="pid" maxlength="3" autocomplete="off" spellcheck="false">
    <div class="error" id="err"></div>
    <button type="button" id="go">확인</button>`);
  const input = p.querySelector('#pid'), err = p.querySelector('#err'), go = p.querySelector('#go');
  input.focus();
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') go.click(); });
  for (;;) {
    await waitClick(go);
    const pid = input.value.trim().toUpperCase();
    if (!/^P\d{2}$/.test(pid)) { err.textContent = 'P와 두 자리 숫자로 입력하세요. (예: P01)'; continue; }
    if (!S.cb[pid] && pid !== TEST_PID && !DEBUG) { err.textContent = `${pid}는 배정표(P01–P${String(n).padStart(2, '0')})에 없습니다. 연구자 체험은 ${TEST_PID}입니다.`; continue; }
    const assign = S.cb[pid] || S.cb.P01;
    // 이 참가자에게 쓸 영상 파일이 서버에 있는지 확인
    const vids = [S.cfg.practice.video, ...[...new Set(assign.trials.map((t) => t.video))].map((v) => S.cfg.videos[v])];
    const missing = [];
    for (const v of S.STATIC ? [] : vids) {  // 서버 없는 모드는 원본 주소라 미리 확인하지 않는다
      if (!v || !v.file) { missing.push('(config.json에 파일 이름 없음)'); continue; }
      try { if (!(await fetch(videoUrl(v), { method: 'HEAD' })).ok) missing.push(v.file); } catch (e) { missing.push(v.file); }
    }
    if (missing.length && !DEBUG) { err.textContent = `영상 파일을 찾을 수 없습니다: ${missing.join(', ')} (stimuli/interruption_videos/ 확인)`; continue; }
    let existing = null;
    if (S.STATIC) {
      try { existing = JSON.parse(localStorage.getItem('exp_' + pid) || 'null')?.data || null; } catch (e) { existing = null; }
      return { pid, assign, missing, existing };
    }
    try {
      const r = await fetch(`/api/record?pid=${pid}`);
      if (r.ok) existing = await r.json(); else if (r.status !== 404) throw new Error('HTTP ' + r.status);
    } catch (e) { err.textContent = '서버에 연결할 수 없습니다. server.py가 켜져 있는지 확인하세요.'; continue; }
    return { pid, assign, missing, existing };
  }
}

// 같은 번호의 기록이 있을 때: 이어서 하기(기본) 또는 처음부터
async function resumeScreen(pid, d) {
  const done = (d.trials || []).filter((t) => t.end).length;
  const p = panel(`<h2>${pid}의 기록이 있습니다</h2>
    <p>마지막 저장 ${esc(d.meta?.saved_at?.replace('T', ' ') || '?')} · 본 Trial ${done} / 3 완료${d.meta?.finished ? ' · 실험 완료' : ''}</p>
    <p class="hint">이어서 하면 끝낸 Trial은 그대로 두고, 끝내지 못한 Trial은 처음부터 다시 합니다. 처음부터 하면 기존 기록은 data/backup으로 옮겨집니다.</p>
    <div class="row-btns"><button type="button" id="resume">이어서 하기</button><button type="button" class="ghost" id="fresh">처음부터</button></div>`);
  return new Promise((resolve) => {
    p.querySelector('#resume').onclick = () => resolve('resume');
    p.querySelector('#fresh').onclick = () => { if (confirm('기존 기록을 backup으로 옮기고 처음부터 시작할까요?')) resolve('fresh'); };
  });
}

// ---------- 실험 메뉴 ----------
// 조건은 기호로 보인다(참가자도 볼 수 있으므로): 글 1·2·3 = T1·T2·T3, Cue A·B·C = 없음·MDDS·상황 모델
// (실험의 T2 = 판정 파이프라인의 T4)
const TEXT_LABEL = { T1: '글 1', T2: '글 2', T3: '글 3' };
const CUE_LABEL = { none: 'Cue A', mdds: 'Cue B', sm: 'Cue C' };
const doneTrials = () => S.data.trials.filter((t) => t.end);
const nextSpec = () => S.data.meta.assignment.find((a) => !doneTrials().some((t) => t.trial === a.trial));
async function menuScreen() {
  const next = nextSpec(), nDone = doneTrials().length, nAborted = (S.data.aborted || []).length;
  const practiced = (S.data.practice_runs || []).some((r) => r.end) || !!S.data.practice?.end;
  const p = panel(`<div class="menu">
    <div class="menu-head"><h1>실험 메뉴</h1><span>참가자: <b>${S.pid}</b>${S.pid === TEST_PID ? ' (연구자 체험)' : ''}</span></div>
    <button type="button" class="btn-practice" id="practice">Practice 시작</button>
    <hr>
    ${next ? `<div class="menu-label">다음 진행</div>
      <div class="menu-next">Trial ${next.trial} / 3 — ${TEXT_LABEL[next.text]} / ${CUE_LABEL[next.cue]}</div>
      ${practiced ? '' : '<p class="hint">연습을 먼저 하는 것을 권장합니다.</p>'}
      <button type="button" class="btn-trial" id="trial">본 Trial ${next.trial} 시작</button>`
    : `<div class="menu-next">본 Trial을 모두 마쳤습니다</div><button type="button" class="btn-trial" id="finish">실험 종료</button>`}
    <hr>
    <p class="menu-status">진행 상황: 본 Trial ${nDone} / 3 완료${nAborted ? ` · 중단 후 다시 한 시도 ${nAborted}회` : ''}</p>
  </div>`);
  return new Promise((resolve) => {
    p.querySelector('#practice').onclick = () => resolve('practice');
    p.querySelector('#trial')?.addEventListener('click', () => resolve('trial'));
    p.querySelector('#finish')?.addEventListener('click', () => resolve('finish'));
  });
}
async function ensureFullscreen() {
  if (document.fullscreenElement) return;
  try { await document.documentElement.requestFullscreen(); } catch (e) { logEvent('fullscreen_failed', { error: String(e) }); }
}

// ---------- 2. 자기 속도 읽기 (중단 전) ----------
function readSentences(list, rec, phase) {
  const R = { start: stamp(), end: null, duration_ms: null, n_sentences: list.length, sentences: [] };
  rec[phase] = R;
  app.innerHTML = `<div id="reader"><div class="column"></div><div class="foot">${TXT.readHint}</div></div>`;
  const col = app.querySelector('.column');
  let i = 0, prevPara = null, cur = null;
  return new Promise((resolve) => {
    const show = () => {
      const s = list[i];
      const el = document.createElement('p');
      el.className = 's' + (prevPara !== null && s.para !== prevPara ? ' newpara' : '');
      el.textContent = s.text;
      col.appendChild(el);
      prevPara = s.para;
      cur = { s, el, shown: null };
      col.style.transform = `translate(-50%, ${Math.round(innerHeight * 0.45 - el.offsetTop)}px)`;
      requestAnimationFrame(() => { cur.shown = stamp(); });
    };
    const finish = (at) => {
      removeEventListener('keydown', onKey);
      R.end = at; R.duration_ms = dur(R.start, at);
      resolve(R);
    };
    const onKey = (e) => {
      if (e.repeat) return;
      if (DEBUG && e.key === ']') {  // 시험용: 이 구간을 건너뜀
        const at = stamp();
        for (; i < list.length; i++) R.sentences.push({ sid: list[i].sid, para: list[i].para, chars: list[i].text.length, skipped: true });
        logEvent('debug_skip', { phase });
        return finish(at);
      }
      if (e.code !== 'Space' || !cur || !cur.shown) return;
      const at = stamp();
      R.sentences.push({ sid: cur.s.sid, para: cur.s.para, event: cur.s.event ?? null, chars: cur.s.text.length,
                         shown_t: cur.shown.t, advanced_t: at.t, rt_ms: dur(cur.shown, at) });
      cur.el.classList.add('read');
      i++;
      if (i % 20 === 0) save(`${phase}_${i}`);
      if (i >= list.length) return finish(at);
      show();
    };
    addEventListener('keydown', onKey);
    show();
  });
}

// ---------- 3. 중단 영상 (영상이 끝나면 넘어감) ----------
// 로컬 영상 파일(config의 file)을 HTML5 video로 재생한다. 조작 막대가 없고 클릭으로 멈출 수 없다.
// 연습에서는 '건너뛰기' 버튼을 보인다. 시험(debug)에서는 debug.interruption_sec 뒤에 끊고 ] 키로 건너뛸 수 있다.
async function interruption(rec, video, practice) {
  const I = { start: stamp(), end: null, duration_ms: null, video_id: rec.video_id, video_file: video?.file || null,
              video_duration: null, video_time_at_stop: null, ended_by: null, error: null, events: [] };
  rec.interruption = I;
  const log = (state, detail = {}) => I.events.push({ state, ...stamp(), ...detail });
  app.innerHTML = `<div id="stage"><video id="vid" playsinline preload="auto"></video><div class="yt-shield"></div>
    <div class="yt-fallback hidden"><button type="button">영상 재생</button></div>
    ${practice ? '<button type="button" class="skip-video">건너뛰기</button>' : ''}</div>`;
  const stage = app.querySelector('#stage'), v = stage.querySelector('#vid'), fallback = stage.querySelector('.yt-fallback');
  const vt = () => Math.round(v.currentTime * 1000) / 1000;
  save('interruption');
  await new Promise((resolve) => {
    let finished = false, timer = null;
    const done = (by) => {
      if (finished) return; finished = true;
      I.ended_by = by; I.video_time_at_stop = vt();
      clearTimeout(timer); removeEventListener('keydown', onKey);
      v.pause(); v.removeAttribute('src'); v.load();
      resolve();
    };
    const onKey = (e) => { if (DEBUG && e.key === ']') { logEvent('debug_skip', { phase: 'interruption' }); done('debug_skip'); } };
    addEventListener('keydown', onKey);
    if (practice) stage.querySelector('.skip-video').onclick = () => { log('skip_click', { video_time: vt() }); done('practice_skip'); };
    if (!video || !video.file) {
      I.error = '영상 파일이 지정되지 않음'; log('error', { message: I.error });
      stage.insertAdjacentHTML('beforeend', `<div class="placeholder">${DEBUG ? '영상 없음 (debug) — ] 키로 건너뛰기' : ''}</div>`);
      timer = setTimeout(() => done('no_video'), (DEBUG ? S.cfg.debug.interruption_sec : S.cfg.video_error_wait_sec) * 1000);
      return;
    }
    v.addEventListener('loadedmetadata', () => { I.video_duration = Math.round(v.duration * 1000) / 1000; log('loadedmetadata', { duration: I.video_duration }); });
    v.addEventListener('playing', () => { log('playing', { video_time: vt() }); fallback.classList.add('hidden'); });
    v.addEventListener('waiting', () => log('buffering', { video_time: vt() }));
    v.addEventListener('stalled', () => log('stalled', { video_time: vt() }));
    v.addEventListener('pause', () => {
      if (finished || v.ended) return;
      log('paused', { video_time: vt() });
      v.play().catch(() => {});  // 키보드 미디어 키 등으로 멈춰도 다시 재생
    });
    v.addEventListener('ended', () => { log('ended', { video_time: vt() }); done('ended'); });
    v.addEventListener('error', () => {
      I.error = `영상 재생 오류 (code ${v.error?.code})`; log('error', { message: I.error });
      stage.insertAdjacentHTML('beforeend', `<div class="alert">${esc(I.error)} — ${S.cfg.video_error_wait_sec}초 뒤 자동으로 넘어갑니다.</div>`);
      clearTimeout(timer); timer = setTimeout(() => done('error_timeout'), S.cfg.video_error_wait_sec * 1000);
    });
    v.src = videoUrl(video);
    v.play().catch((e) => {  // 브라우저가 소리 있는 자동 재생을 막으면 참가자가 직접 누를 버튼을 띄운다
      log('autoplay_blocked', { error: String(e) });
      fallback.classList.remove('hidden');
      fallback.querySelector('button').onclick = () => { log('fallback_click'); v.play().catch(() => {}); };
    });
    if (DEBUG) timer = setTimeout(() => done('debug_timeout'), S.cfg.debug.interruption_sec * 1000);
  });
  I.end = stamp(); I.duration_ms = dur(I.start, I.end);
  app.innerHTML = '';
  return I;
}

// ---------- 4. cue ----------
async function cueScreen(rec, items, minSec) {
  const C = { condition: rec.cue_condition, items, min_sec: minSec, start: stamp(), enabled: null, end: null, duration_ms: null };
  rec.cue = C;
  const p = panel(`<h2>${TXT.cueTitle}</h2><p class="hint">${TXT.cueHint}</p>
    <ul class="cue-list">${items.map((x) => `<li>${esc(x.text)}</li>`).join('')}</ul>
    <button type="button" disabled>다음</button>`);
  save('cue');
  const b = p.querySelector('button');
  setTimeout(() => { b.disabled = false; C.enabled = stamp(); }, minSec * 1000);
  C.input = await waitClickOrSpace(b);  // 최소 시간이 지나 버튼이 켜진 뒤 클릭 또는 Space로 넘어감
  C.end = stamp(); C.duration_ms = dur(C.start, C.end);
  return C;
}

// ---------- 5. 퀴즈 1: 자유 회상 (한 화면, 시간 제한 없음) ----------
async function recallScreen(rec) {
  const Q = S.qs.recall;
  const R = { start: stamp(), end: null, duration_ms: null, answer: null, chars: null, chars_no_space: null,
              first_input_t: null, last_input_t: null, n_inputs: 0, submit_blocked: 0 };
  rec.recall = R;
  const p = panel(`<h2>${esc(Q.title)}</h2><div class="instr-box">${Q.instructions.map((l) => `<p class="instr">${esc(l)}</p>`).join('')}</div>
    <textarea id="recall" class="recall-box" spellcheck="false"></textarea>
    <div class="error" id="rerr"></div>
    <button type="button" id="submit">제출</button>`);
  save('recall');
  const ta = p.querySelector('#recall'), err = p.querySelector('#rerr'), submit = p.querySelector('#submit');
  ta.addEventListener('input', () => { const t = stamp().t; R.n_inputs++; R.first_input_t ??= t; R.last_input_t = t; if (ta.value.trim()) ta.classList.remove('missing'); });
  setTimeout(() => ta.focus(), 200);  // 앞 화면에서 누른 키가 글 칸에 입력되지 않도록 잠깐 뒤에 커서를 둔다
  for (;;) {  // 빈 답은 제출되지 않는다
    await waitClick(submit);
    if (ta.value.trim()) break;
    R.submit_blocked++; ta.classList.add('missing'); err.textContent = '내용을 작성한 뒤 제출해 주세요.'; ta.focus();
    logEvent('submit_blocked', { phase: 'recall' });
  }
  R.end = stamp(); R.duration_ms = dur(R.start, R.end);
  R.answer = ta.value; R.chars = ta.value.length; R.chars_no_space = ta.value.replace(/\s/g, '').length;
  await save('recall_submitted');
  return R;
}

// ---------- 6. 퀴즈 2: T/F (한 문제씩) ----------
// 본 실험은 텍스트별 '중단 전' 6문항, 연습은 questions.json의 tf_practice. 순서는 참가자·텍스트별 시드로 섞는다.
function seeded(str) {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) { h = Math.imul(h ^ str.charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19); }
  let a = h >>> 0;
  return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function shuffle(arr, seedStr) {
  const r = seeded(seedStr), a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
const nextFrame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function tfQuiz(rec, items, seedStr) {
  const Q = S.qs.tf;
  await message(Q.title, Q.instructions.map(esc), '시작');
  const order = Q.seed_order === false ? items.slice() : shuffle(items, seedStr);
  const T = { order: order.map((q) => q.qid), seed: seedStr, start: stamp(), end: null, duration_ms: null, n_correct: null, items: [] };
  rec.tf = T;
  for (let k = 0; k < order.length; k++) {
    const q = order[k], key = q.answer === 'O' ? 'T' : 'F';
    app.innerHTML = `<section class="tf"><div class="tf-inner"><div class="tf-progress">문제 ${k + 1} / ${order.length}</div>
      <p class="tf-stmt">${esc(q.statement)}</p>
      <div class="tf-btns"><button type="button" class="tf-t"><b>T</b><span>True</span></button><button type="button" class="tf-f"><b>F</b><span>False</span></button></div>
      <p class="tf-hint">T 또는 F 키를 눌러 응답하세요.</p></div></section>`;
    await nextFrame();
    const shown = stamp();
    const bt = app.querySelector('.tf-t'), bf = app.querySelector('.tf-f');
    const { response, input, at } = await new Promise((resolve) => {
      const fin = (response, input) => { removeEventListener('keydown', onKey); resolve({ response, input, at: stamp() }); };
      const onKey = (e) => { if (e.repeat) return; if (e.code === 'KeyT') fin('T', 'key'); else if (e.code === 'KeyF') fin('F', 'key'); };
      addEventListener('keydown', onKey);
      bt.onclick = () => fin('T', 'click'); bf.onclick = () => fin('F', 'click');
    });
    (response === 'T' ? bt : bf).classList.add('pressed');
    T.items.push({ position: k + 1, qid: q.qid, statement: q.statement, level: q.level ?? null, type: q.type ?? null, source: q.source ?? null,
                   cue_category: q.cue_category ?? null, pre_event: q.pre_event ?? null, answer_key: key, response, correct: response === key,
                   shown_t: shown.t, response_t: at.t, rt_ms: dur(shown, at), input });
    save(`tf_${k + 1}`);
    await sleep(250); app.innerHTML = ''; await sleep(250);
  }
  T.end = stamp(); T.duration_ms = dur(T.start, T.end); T.n_correct = T.items.filter((x) => x.correct).length;
  T.rt_total_ms = Math.round(T.items.reduce((n, x) => n + x.rt_ms, 0) * 10) / 10;  // 문항 사이 간격을 뺀 순수 응답 시간 합
  T.rt_mean_ms = Math.round(T.rt_total_ms / T.items.length * 10) / 10;
  return T;
}

// ---------- 7. 주관 설문 (7점, 한 문항씩) ----------
async function surveyScreens(rec) {
  const showCue = rec.cue_condition !== 'none';
  const items = S.qs.survey.filter((q) => !q.cueOnly || showCue);
  const V = { start: stamp(), end: null, duration_ms: null, items: [] };
  rec.survey = V;
  for (const q of items) {
    const p = panel(`<div class="survey-card"><div class="survey-label">${esc(S.qs.survey_label)}</div>
      <h2>${esc(q.q)}</h2><p class="hint">${esc(S.qs.survey_hint)}</p>
      <div class="survey-anchors"><span><b>1</b> · ${esc(q.lo)}</span><span><b>7</b> · ${esc(q.hi)}</span></div>
      <div class="survey-scale">${[1, 2, 3, 4, 5, 6, 7].map((v) => `<button type="button" data-v="${v}">${v}</button>`).join('')}</div></div>`);
    await nextFrame();
    const shown = stamp();
    const { value, input, at } = await new Promise((resolve) => {
      const fin = (value, input) => { removeEventListener('keydown', onKey); resolve({ value, input, at: stamp() }); };
      const onKey = (e) => { if (e.repeat) return; const m = e.code.match(/^(?:Digit|Numpad)([1-7])$/); if (m) fin(+m[1], 'key'); };
      addEventListener('keydown', onKey);
      p.querySelectorAll('.survey-scale button').forEach((b) => { b.onclick = () => fin(+b.dataset.v, 'click'); });
    });
    p.querySelector(`.survey-scale button[data-v="${value}"]`).classList.add('pressed');
    V.items.push({ id: q.id, question: q.q, lo: q.lo, hi: q.hi, value, shown_t: shown.t, response_t: at.t, rt_ms: dur(shown, at), input });
    save(`survey_${q.id}`);
    await sleep(300);
  }
  V.end = stamp(); V.duration_ms = dur(V.start, V.end);
  return V;
}

// ---------- 8. Trial 결과를 Word 파일로 (서버 data/word/에 자동 저장) ----------
const fmtMs = (ms) => { const sec = ms / 1000; return sec >= 60 ? `${Math.floor(sec / 60)}분 ${(sec % 60).toFixed(1)}초 (${Math.round(ms)} ms)` : `${sec.toFixed(1)}초 (${Math.round(ms)} ms)`; };
function wordPayload(rec) {
  return { pid: S.pid, trial: rec.trial, text: rec.text, title: rec.title, cue_condition: rec.cue_condition,
    session_id: S.data.meta.session_id, submitted_iso: new Date().toISOString(),
    sections: [
      { name: '시간 기록', items: [
        ['Trial 전체', rec.times?.trial_ms], ['글 읽기', rec.times?.reading_ms], ['중단 영상', rec.times?.video_ms], ['cue 읽기', rec.times?.cue_ms],
        ['퀴즈 1 작성', rec.times?.recall_ms], ['퀴즈 2 응답 시간 합 (문항 사이 간격 제외)', rec.times?.tf_rt_total_ms],
        ['퀴즈 2 문항 평균 응답 시간', rec.times?.tf_rt_mean_ms], ['퀴즈 2 화면 전체 (안내 뒤부터)', rec.times?.tf_screen_ms], ['설문', rec.times?.survey_ms],
      ].map(([k, v]) => ({ question: k, answer: v == null ? '해당 없음' : fmtMs(v) })) },
      { name: `${S.qs.recall.title} (자유 회상)`, items: [{ question: '이야기 내용 재구성', answer: rec.recall?.answer || '' }] },
      { name: `${S.qs.tf.title} (T/F)`, items: (rec.tf?.items || []).map((x) => ({ question: x.statement,
          answer: `응답 ${x.response} · 정답 ${x.answer_key} · ${x.correct ? '맞음' : '틀림'} · 응답 시간 ${(x.rt_ms / 1000).toFixed(2)}초 (${Math.round(x.rt_ms)} ms)` })) },
      { name: '설문 (7점)', items: (rec.survey?.items || []).map((x) => ({ question: x.question, answer: `${x.value} / 7  (1 = ${x.lo}, 7 = ${x.hi})` })) },
    ] };
}
// 자유 회상 채점용 Word: 내용은 회상 답변만(제목·정보·cue 조건 없음, 눈가림 채점). 참가자·Trial·글은 파일 이름에 있다.
function recallPayload(rec) {
  const R = rec.recall || {};
  return { kind: 'recall', hide_cue: true, pid: S.pid, trial: rec.trial, text: rec.text, title: rec.title, cue_condition: rec.cue_condition,
    session_id: S.data.meta.session_id, submitted_iso: R.end?.iso || new Date().toISOString(),
    extra_info: [`글자 수: ${R.chars ?? 0} (공백 제외 ${R.chars_no_space ?? 0})`, `작성 시간: ${R.duration_ms == null ? '–' : fmtMs(R.duration_ms)}`],
    sections: [{ name: '', items: [{ question: '', answer: R.answer || '' }] }] };  // 파일 이름에 정보가 있으므로 내용은 답변만
}
async function saveWord(rec) {
  const payload = wordPayload(rec), rpayload = recallPayload(rec);
  if (S.STATIC) {  // 서버 없는 모드: Word는 실험 끝 zip에 넣고, 지금까지의 기록을 Google 드라이브로 보낸다
    const w = STATIC_STORE.wordFor(S.pid, S.data.meta.session_id, payload);
    const wr = STATIC_STORE.wordFor(S.pid, S.data.meta.session_id, rpayload);
    rec.word_file = w.name; rec.recall_word_file = wr.name; rec.word_saved = new Date().toISOString();
    rec.word_payload = payload; rec.recall_payload = rpayload;  // 기록 보기 페이지에서 Word를 다시 만들 수 있게 내용을 함께 둔다
    await save(`word_${rec.trial}`);
    if (S.cfg.word_browser_download) { STATIC_STORE.download(w.name, w.blob); STATIC_STORE.download(wr.name, wr.blob); }
    // 드라이브 전송은 몇 초 걸리므로 기다리지 않고 뒤에서 보낸다(화면이 멈춘 것처럼 보이지 않게). 실패해도 다음 Trial 때 전체 기록을 다시 보낸다.
    driveSync([{ name: w.name, blob: w.blob }, { name: wr.name, blob: wr.blob }], `trial${rec.trial}`);
    return;
  }
  for (let tries = 0; tries < 3; tries++) {
    try {
      const r = await fetch('/api/word', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const name = decodeURIComponent(r.headers.get('X-File-Name') || `${S.pid}_answers.docx`);
      if (S.cfg.word_browser_download) {  // 기본은 끔
        const url = URL.createObjectURL(await r.blob());
        const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 10000);
      }
      rec.word_file = name; rec.word_saved = new Date().toISOString();
      try {  // 회상 채점용 Word도 서버에 저장한다
        const r2 = await fetch('/api/word', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(rpayload) });
        if (r2.ok) rec.recall_word_file = decodeURIComponent(r2.headers.get('X-File-Name') || '');
      } catch (e) { logEvent('word_failed', { error: String(e), trial: rec.trial, kind: 'recall' }); }
      return;
    } catch (e) { logEvent('word_failed', { error: String(e), trial: rec.trial }); await sleep(1000); }
  }
  // 실패해도 답변은 JSON 기록에 있으므로 진행한다.
}

// Google 드라이브 전송 (서버 없는 모드, config.gdrive.endpoint가 있을 때만): 기록 JSON·CSV와 덧붙일 파일
async function driveSync(extra = [], why = '') {
  const g = S.cfg.gdrive || {};
  if (!S.STATIC || !g.endpoint) return;
  try {
    await STATIC_STORE.sendDrive(g.endpoint, g.token || '', S.pid, [...STATIC_STORE.participantFiles(S.data), ...extra]);
    logEvent('drive_sent', { why });
  } catch (e) { logEvent('drive_failed', { why, error: String(e) }); }
}
// 서버 없는 모드의 실험 끝 묶음: JSON + CSV 2개 + 지금까지의 Word 파일 전부
function staticBundle() {
  const files = STATIC_STORE.participantFiles(S.data);
  for (const rec of [...(S.data.practice_runs || []).slice(-1), ...S.data.trials].filter((r) => r && r.end)) {
    for (const pl of [wordPayload(rec), recallPayload(rec)]) {
      const w = STATIC_STORE.wordFor(S.pid, S.data.meta.session_id, pl);
      files.push({ name: `word/${w.name}`, blob: w.blob });
    }
  }
  return files;
}

// ---------- Trial ----------
async function runTrial(spec) {
  const practice = spec.trial === 0;
  const mat = practice ? S.prac : S.stim.texts[spec.text];
  const video = practice ? S.cfg.practice.video : S.cfg.videos[spec.video];
  const cueMin = DEBUG ? S.cfg.debug.cue_min_sec : (practice ? S.cfg.practice.cue_min_sec : S.cfg.cue_min_sec);
  const attempt = practice ? (S.data.practice_runs || []).length + 1
                           : (S.data.aborted || []).filter((t) => t.trial === spec.trial).length + 1;
  const rec = { trial: spec.trial, practice, attempt, text: spec.text, title: mat.title, cue_condition: spec.cue,
                video_id: spec.video, video_file: video?.file || null, start: stamp(), end: null, duration_ms: null };
  if (practice) { S.data.practice = rec; (S.data.practice_runs ||= []).push(rec); } else S.data.trials.push(rec);

  await message(practice ? '연습' : `글 ${spec.trial} / 3`, ['준비되면 Space나 버튼을 누르세요. 첫 문장이 바로 나타납니다.'], '시작');
  await readSentences(mat.pre, rec, 'reading_pre');
  await interruption(rec, video, practice);
  if (spec.cue === 'none') rec.cue = null;
  else await cueScreen(rec, practice ? mat.cue : mat.cue[spec.cue], cueMin);
  await recallScreen(rec);
  const tfItems = practice ? S.qs.tf_practice : mat.quiz.filter((q) => q.section === '중단 전');
  await tfQuiz(rec, tfItems, `${S.pid}|${spec.text}`);
  await surveyScreens(rec);
  panel('<h2>저장 중입니다</h2><p class="hint">잠시만 기다려 주세요.</p>');  // 저장이 끝나면 바로 메뉴로 간다
  rec.end = stamp(); rec.duration_ms = dur(rec.start, rec.end);
  rec.times = { trial_ms: rec.duration_ms, reading_ms: rec.reading_pre?.duration_ms ?? null, video_ms: rec.interruption?.duration_ms ?? null,
                cue_ms: rec.cue?.duration_ms ?? null, recall_ms: rec.recall?.duration_ms ?? null, tf_screen_ms: rec.tf?.duration_ms ?? null,
                tf_rt_total_ms: rec.tf?.rt_total_ms ?? null, tf_rt_mean_ms: rec.tf?.rt_mean_ms ?? null, survey_ms: rec.survey?.duration_ms ?? null,
                started_iso: rec.start.iso, ended_iso: rec.end.iso };
  await saveWord(rec);
  await save(practice ? 'practice_end' : `trial${spec.trial}_end`);
}

// ---------- 전체 흐름 ----------
async function main() {
  try {
    const [cfg, stimText, cb, prac, qs] = await Promise.all([
      fetch('config.json').then((r) => r.json()), fetch('stimuli.json').then((r) => r.text()),
      fetch('counterbalance.json').then((r) => r.json()), fetch('practice.json').then((r) => r.json()),
      fetch('questions.json').then((r) => r.json())]);
    S.cfg = cfg; S.stim = JSON.parse(stimText); S.cb = cb; S.qs = qs;
    S.STATIC = cfg.mode === 'static';
    const cut = prac.sentences.findIndex((s) => s.sid === prac.cut_after) + 1;
    S.prac = { title: prac.title, pre: prac.sentences.slice(0, cut), cue: prac.cue };
    S.stimSha = await sha12(stimText);
  } catch (e) {
    panel(`<h2>자료를 불러오지 못했습니다</h2><p class="error">${esc(e)}</p><p class="hint">server.py로 띄운 주소(http://localhost:8000)로 열었는지 확인하세요.</p>`);
    return;
  }
  if (DEBUG) document.getElementById('debug-badge').classList.remove('hidden');

  const { pid, assign, missing, existing } = await idScreen();
  S.pid = pid;
  const choice = existing ? await resumeScreen(pid, existing) : 'new';
  if (choice === 'fresh' && S.STATIC) {
    try { localStorage.setItem(`exp_backup_${pid}_${Date.now()}`, localStorage.getItem('exp_' + pid)); } catch (e) {}
  }
  if (choice === 'resume') {
    // 이어서 하기: 같은 세션 기록을 그대로 쓴다. 끝내지 못한 Trial은 aborted로 옮기고 처음부터 다시 한다.
    S.data = existing;
    S.data.aborted ||= [];
    const unfinished = S.data.trials.filter((t) => !t.end);
    const phaseOf = (t) => t.survey ? '설문' : t.tf ? '퀴즈 2' : t.recall ? '퀴즈 1' : t.cue ? 'cue' : t.interruption ? '영상' : t.reading_pre ? '읽기' : '시작 화면';
    for (const t of unfinished) S.data.aborted.push({ ...t, aborted_phase: phaseOf(t), aborted_saved_at: S.data.meta.saved_at });
    S.data.trials = S.data.trials.filter((t) => t.end);
    (S.data.meta.resumes ||= []).push({ iso: new Date().toISOString(), moved_to_aborted: unfinished.map((t) => t.trial),
                                        user_agent: navigator.userAgent, missing_videos: missing });
    S.data.meta.t0_note = '이어서 한 뒤의 t는 새 페이지 기준 ms이므로, 이전 부분과 비교할 때는 iso 시각을 쓴다';
    await save('resumed');
  } else {
    S.data = {
      meta: { pid, session_id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random(),
              test: pid === TEST_PID ? 'researcher' : (S.cb[pid] ? null : 'debug'),
              sequence: assign.sequence, assignment: assign.trials, assignment_from: S.cb[pid] ? pid : 'P01',
              debug: DEBUG, missing_videos: missing, started: stamp(), finished: null, duration_ms: null, stage: 'start', saved_at: null,
              user_agent: navigator.userAgent, screen: { w: screen.width, h: screen.height, dpr: devicePixelRatio },
              viewport: { w: innerWidth, h: innerHeight }, stimuli_sha: S.stimSha, stimuli_sources: S.stim.sources,
              config: S.cfg, questions: S.qs, ot_seen: false },
      practice: null, practice_runs: [], trials: [], aborted: [], events: [],
    };
    await save('start');
  }

  // 실험 메뉴: 연습과 본 Trial을 여기서 고르고, 하나가 끝나면 메뉴로 돌아온다.
  for (;;) {
    save('menu');
    const act = await menuScreen();
    logEvent('menu', { action: act });
    if (act === 'finish') break;
    await ensureFullscreen();
    if (act === 'practice') {
      if (!S.data.meta.ot_seen) { for (const [title, lines] of TXT.ot) await message(title, lines); S.data.meta.ot_seen = true; }
      await runTrial({ trial: 0, text: 'PRACTICE', cue: 'example', video: 'practice' });
    } else {
      if (!S.data.meta.ot_seen) { for (const [title, lines] of TXT.ot) await message(title, lines); S.data.meta.ot_seen = true; }
      await runTrial(nextSpec());
    }
  }

  if (!S.data.meta.finished) S.data.meta.finished = stamp();
  const M = S.data.meta;  // 전체 시간은 실제 시각으로 계산한다(이어서 한 경우 페이지 기준 ms가 다시 0부터 시작하므로)
  M.duration_ms = Date.parse(M.finished.iso) - Date.parse(M.started.iso);
  M.trials_total_ms = Math.round(S.data.trials.reduce((n, t) => n + (t.duration_ms || 0), 0));
  M.practice_total_ms = Math.round((S.data.practice_runs || []).reduce((n, t) => n + (t.duration_ms || 0), 0));
  await save('finished');
  try { if (document.fullscreenElement) await document.exitFullscreen(); } catch (e) {}
  const end = panel(`<h1>실험이 끝났습니다</h1><p>참여해 주셔서 감사합니다. 실험자에게 알려 주세요.</p><p class="hint" id="st"></p>
    <p class="hint" id="dl"></p><button type="button" class="ghost hidden" id="retry">다시 저장</button><button type="button" class="ghost" id="bundle">기록 파일 다시 내려받기</button>`);
  const st = end.querySelector('#st'), dl = end.querySelector('#dl'), retry = end.querySelector('#retry');
  const where = S.STATIC ? '이 브라우저와 다운로드 폴더' : '이 컴퓨터의 experiment/data 폴더';
  const show = () => { st.textContent = S.lastSaveOk ? `기록 저장 완료 (${S.pid}, ${where})` : '기록 저장 실패 — 실험자: 서버를 확인한 뒤 다시 저장을 누르세요. (브라우저에 백업은 남아 있음)'; retry.classList.toggle('hidden', !!S.lastSaveOk); };
  show();
  retry.onclick = async () => { await save('finished'); show(); };
  // 이 참가자의 기록(JSON + Word 파일)을 zip 하나로 다운로드 폴더에도 내려받는다(서버 폴더와 별도의 사본).
  const bundle = async () => {
    if (S.STATIC) {
      const name = `${S.pid}_기록.zip`;
      try {
        const files = staticBundle();
        STATIC_STORE.download(name, STATIC_STORE.makeZip(await Promise.all(files.map(async (f) => ({ name: f.name, data: f.blob ? new Uint8Array(await f.blob.arrayBuffer()) : f.data })))));
        dl.textContent = `다운로드 폴더에 ${name}을 저장했습니다. (기록 JSON, 응답 CSV, Word 파일)`;
        logEvent('bundle_downloaded', { name });
      } catch (e) { dl.textContent = '기록 파일을 만들지 못했습니다. 기록 보기 페이지(records.html)에서 다시 내려받을 수 있습니다.'; logEvent('bundle_failed', { error: String(e) }); }
      save('finished'); driveSync([], 'finished');
      return;
    }
    try {
      const r = await fetch(`/api/bundle?pid=${S.pid}`);
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const name = decodeURIComponent(r.headers.get('X-File-Name') || `${S.pid}_기록.zip`);
      const url = URL.createObjectURL(await r.blob());
      const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
      dl.textContent = `다운로드 폴더에도 ${name}을 내려받았습니다.`;
      logEvent('bundle_downloaded', { name });
    } catch (e) { dl.textContent = '기록 파일을 내려받지 못했습니다. 기록 보기 페이지(/records.html)에서 내려받을 수 있습니다.'; logEvent('bundle_failed', { error: String(e) }); }
    save('finished');
  };
  end.querySelector('#bundle').onclick = bundle;
  if (S.cfg.bundle_download_at_end !== false) bundle();
}

main();
