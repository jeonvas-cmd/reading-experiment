// 서버 없는 모드(GitHub Pages)에서 쓰는 도구: zip·Word(docx)·CSV를 브라우저에서 만들고, 다운로드 폴더에 저장하거나 Google 드라이브로 보낸다.
// 서버 모드의 docx_writer.py(Word)와 export_csv.py의 participant_rows(CSV)를 그대로 옮겼다. 외부 라이브러리 없음.
const STATIC_STORE = (() => {
  // ---------- zip (압축 없이 저장하는 방식, docx와 기록 묶음에 사용) ----------
  const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  const crc32 = (u8) => { let c = 0xFFFFFFFF; for (let i = 0; i < u8.length; i++) c = CRC[(c ^ u8[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
  const enc = new TextEncoder();
  function makeZip(files) {  // files: [{name, data: string | Uint8Array}]
    const parts = [], central = []; let offset = 0;
    const now = new Date();
    const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
    const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
    for (const f of files) {
      const name = enc.encode(f.name), data = typeof f.data === 'string' ? enc.encode(f.data) : f.data, crc = crc32(data);
      const lh = new DataView(new ArrayBuffer(30));
      lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true); lh.setUint16(8, 0, true);
      lh.setUint16(10, dosTime, true); lh.setUint16(12, dosDate, true); lh.setUint32(14, crc, true);
      lh.setUint32(18, data.length, true); lh.setUint32(22, data.length, true); lh.setUint16(26, name.length, true); lh.setUint16(28, 0, true);
      parts.push(new Uint8Array(lh.buffer), name, data);
      const ch = new DataView(new ArrayBuffer(46));
      ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true); ch.setUint16(10, 0, true);
      ch.setUint16(12, dosTime, true); ch.setUint16(14, dosDate, true); ch.setUint32(16, crc, true);
      ch.setUint32(20, data.length, true); ch.setUint32(24, data.length, true); ch.setUint16(28, name.length, true);
      ch.setUint32(42, offset, true);
      central.push(new Uint8Array(ch.buffer), name);
      offset += 30 + name.length + data.length;
    }
    const csize = central.reduce((n, p) => n + p.length, 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
    end.setUint32(12, csize, true); end.setUint32(16, offset, true);
    return new Blob([...parts, ...central, new Uint8Array(end.buffer)], { type: 'application/zip' });
  }

  // ---------- Word (docx_writer.py와 같은 구성) ----------
  const FONT = '맑은 고딕';
  const x = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const run = (text, { bold, size, color } = {}) => {
    let p = `<w:rFonts w:ascii="${FONT}" w:hAnsi="${FONT}" w:eastAsia="${FONT}"/>`;
    if (bold) p += '<w:b/>'; if (color) p += `<w:color w:val="${color}"/>`; if (size) p += `<w:sz w:val="${size * 2}"/><w:szCs w:val="${size * 2}"/>`;
    return `<w:r><w:rPr>${p}</w:rPr><w:t xml:space="preserve">${x(text)}</w:t></w:r>`;
  };
  const para = (runs, after = 120, before = 0) => `<w:p><w:pPr><w:spacing w:before="${before}" w:after="${after}"/></w:pPr>${runs}</w:p>`;
  function buildDocx(title, infoLines, sections) {
    const body = [para(run(title, { bold: true, size: 16 }), 200), ...infoLines.map((l) => para(run(l, { size: 10, color: '555555' }), 40))];
    for (const s of sections) {
      body.push(para(run(s.name, { bold: true, size: 13 }), 160, 360));
      s.items.forEach((it, n) => {
        body.push(para(run(`${n + 1}. ${it.question}`, { bold: true, size: 11 }), 80, 200));
        const a = String(it.answer ?? '');
        (a.trim() ? a.split('\n') : ['(응답 없음)']).forEach((line) => body.push(para(run(line, { size: 11, color: a.trim() ? null : '999999' }), 40)));
      });
    }
    const doc = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>'
      + body.join('') + '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr></w:body></w:document>';
    const types = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>';
    const rels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>';
    return makeZip([{ name: '[Content_Types].xml', data: types }, { name: '_rels/.rels', data: rels }, { name: 'word/document.xml', data: doc }]);
  }
  const cueKo = { none: '없음', mdds: 'MDDS', sm: '상황 모델', example: '연습 예시' };
  function wordFor(pid, sessionId, payload) {  // payload: saveWord가 서버에 보내는 것과 같은 구조
    const label = payload.trial === 0 ? '연습' : `Trial ${payload.trial}`;
    const info = [`참가자: ${pid}`, `Trial: ${payload.trial === 0 ? '연습' : payload.trial}`, `글: ${payload.title} (${payload.text})`,
                  `cue 조건: ${cueKo[payload.cue_condition] || payload.cue_condition}`, `제출 시각: ${payload.submitted_iso}`, `세션: ${sessionId}`];
    const name = `${pid}_${payload.trial === 0 ? 'practice' : 'trial' + payload.trial}_${payload.text}.docx`;
    return { name, blob: buildDocx(`${pid} · ${label} 답변`, info, payload.sections) };
  }

  // ---------- CSV (export_csv.py의 participant_rows 중 responses·trials와 같은 열) ----------
  function participantRows(d) {
    const m = d.meta, responses = [], trials = [];
    const list = (d.practice ? [d.practice] : []).concat(d.trials || []);
    for (const tr of list) {
      const key = { participant: m.pid, sequence: m.sequence, trial: tr.trial, attempt: tr.attempt ?? 1, practice: tr.practice,
                    text: tr.text, cue_condition: tr.cue_condition, video_id: tr.video_id };
      const R = tr.reading_pre || {}, sents = (R.sentences || []).filter((s) => 'rt_ms' in s);
      const Rc = tr.recall || null, T = tr.tf || {}, Vitems = (tr.survey || {}).items || [], I = tr.interruption || {}, C = tr.cue || null;
      const resp = (o) => ({ ...key, task: null, position: null, item_id: null, question: null, response: null, answer_key: null,
                             correct: null, rt_ms: null, input: null, extra: null, ...o });
      if (C) responses.push(resp({ task: 'cue', item_id: 'cue', question: `cue ${(C.items || []).length}개 읽기`, response: '넘김', rt_ms: C.duration_ms, input: C.input }));
      if (Rc) responses.push(resp({ task: '퀴즈1_회상', item_id: 'recall', question: '이야기 내용 재구성', response: Rc.answer, rt_ms: Rc.duration_ms,
                                    extra: `글자 수 ${Rc.chars} (공백 제외 ${Rc.chars_no_space})` }));
      for (const it of T.items || []) responses.push(resp({ task: '퀴즈2_TF', position: it.position, item_id: it.qid, question: it.statement,
        response: it.response, answer_key: it.answer_key, correct: it.correct ? 1 : 0, rt_ms: it.rt_ms, input: it.input,
        extra: `${it.level || ''} / cue 범주: ${it.cue_category || ''}` }));
      Vitems.forEach((it, i) => responses.push(resp({ task: '설문', position: i + 1, item_id: it.id, question: it.question, response: it.value,
        rt_ms: it.rt_ms, input: it.input, extra: `1 = ${it.lo}, 7 = ${it.hi}` })));
      const chars = sents.reduce((n, s) => n + s.chars, 0), V = Object.fromEntries(Vitems.map((v) => [v.id, v.value]));
      trials.push({ ...key, complete: !!tr.end, trial_ms: tr.duration_ms, reading_pre_ms: R.duration_ms, reading_pre_n: sents.length, reading_pre_chars: chars,
        reading_pre_ms_per_char: chars ? Math.round(sents.reduce((n, s) => n + s.rt_ms, 0) / chars * 100) / 100 : null,
        interruption_ms: I.duration_ms, video_file: I.video_file, video_duration: I.video_duration, video_time_at_stop: I.video_time_at_stop,
        video_ended_by: I.ended_by, video_error: I.error, video_buffering_n: (I.events || []).filter((e) => e.state === 'buffering').length,
        cue_ms: C ? C.duration_ms : null, cue_n_items: C ? (C.items || []).length : null, cue_input: C ? C.input : null,
        recall_ms: Rc ? Rc.duration_ms : null, recall_chars: Rc ? Rc.chars : null,
        tf_ms: T.duration_ms, tf_rt_total_ms: T.rt_total_ms, tf_rt_mean_ms: T.rt_mean_ms, tf_n: (T.items || []).length, tf_correct: T.n_correct,
        survey_ms: (tr.survey || {}).duration_ms, word_file: tr.word_file, started_iso: tr.start?.iso, ended_iso: tr.end?.iso,
        s1: V.s1 ?? null, s2: V.s2 ?? null, s3: V.s3 ?? null, s4: V.s4 ?? null, s5: V.s5 ?? null });
    }
    return { responses, trials };
  }
  function toCsv(rows) {  // 엑셀에서 한글이 깨지지 않도록 BOM을 붙인다
    const cols = [...new Set(rows.flatMap((r) => Object.keys(r)))];
    const cell = (v) => { if (v == null) return ''; const s = String(v); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    return '﻿' + [cols.join(','), ...rows.map((r) => cols.map((c) => cell(r[c])).join(','))].join('\r\n');
  }
  function participantFiles(d) {  // 참가자 한 명의 결과 파일 묶음 (JSON + CSV 2개)
    const pid = d.meta.pid, rows = participantRows(d);
    return [{ name: `${pid}.json`, data: JSON.stringify(d, null, 1) },
            { name: `csv/${pid}_responses.csv`, data: toCsv(rows.responses) },
            { name: `csv/${pid}_trials.csv`, data: toCsv(rows.trials) }];
  }

  // ---------- 다운로드 폴더 저장 ----------
  function download(name, blob) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 15000);
  }

  // ---------- Google 드라이브 전송 (Apps Script 웹 앱, experiment/apps_script.gs) ----------
  const b64 = async (blob) => { const u8 = new Uint8Array(await blob.arrayBuffer()); let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000)); return btoa(s); };
  async function sendDrive(endpoint, token, pid, files) {  // files: [{name, data: string} | {name, blob}]
    if (!endpoint) return false;
    const payload = { token, pid, files: [] };
    for (const f of files) {
      if (f.blob) payload.files.push({ name: f.name.split('/').pop(), base64: await b64(f.blob), mime: f.blob.type || 'application/octet-stream' });
      else payload.files.push({ name: f.name.split('/').pop(), text: f.data, mime: f.name.endsWith('.csv') ? 'text/csv' : 'application/json' });
    }
    // Apps Script는 다른 출처의 응답을 읽을 수 없으므로(no-cors) 보내기만 하고 성공 여부는 확인하지 않는다.
    await fetch(endpoint, { method: 'POST', mode: 'no-cors', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(payload) });
    return true;
  }

  // 참가자 기록 하나의 전체 묶음(zip): JSON + CSV 2개 + Word(기록에 남은 word_payload로 다시 만든다)
  async function bundleZip(d) {
    const files = participantFiles(d).map((f) => ({ name: f.name, data: f.data }));
    for (const rec of [...(d.practice_runs || []).slice(-1), ...(d.trials || [])].filter((r) => r && r.end && r.word_payload)) {
      const w = wordFor(d.meta.pid, d.meta.session_id, rec.word_payload);
      files.push({ name: `word/${w.name}`, data: new Uint8Array(await w.blob.arrayBuffer()) });
    }
    return makeZip(files);
  }

  return { makeZip, buildDocx, wordFor, participantRows, toCsv, participantFiles, download, sendDrive, bundleZip };
})();
