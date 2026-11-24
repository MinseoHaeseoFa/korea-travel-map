/*!
 * 🔒 주인장 PIN 잠금 공통 모듈 (Owner PIN lock) · v20261124a
 * ---------------------------------------------------------------------------
 *  구경은 자유롭게, 저장·수정·삭제는 주인장만.
 *
 *  · 읽기(doGet) 요청은 이 모듈이 관여하지 않습니다. 누구나 그대로 열람합니다.
 *  · 쓰기(doPost) 요청 본문에 pin 을 함께 실어 보냅니다.
 *      OwnerPin.post(URL, function (pin) { return { type: 'korea', data: data, pin: pin }; })
 *  · 서버(Apps Script)가 { ok:false, code:'UNAUTHORIZED' } 등으로 거절하면
 *    - 잘못된 PIN이 기억되지 않도록 localStorage 에서 지우고
 *    - "PIN이 올바르지 않습니다. 다시 입력해 주세요." 안내와 함께 모달을 다시 띄웁니다.
 *  · 저장된 PIN이 없으면 [🔒 주인장 PIN 입력] 모달을 먼저 띄운 뒤 이어서 저장합니다.
 *  · [🔑 PIN 초기화(잠금)] 버튼은 공용 PC 등에서 쓴 뒤 바로 잠글 때 사용합니다.
 *
 *  반환값: { cancelled: false, json: <파싱된 응답>, text: <응답 원문> }
 *          { cancelled: true,  json: null, unauthorized: <bool> }  ← 사용자가 취소
 *
 *  2026-11-24 · 쿠사리님 여행 지도·플래너 4종 공통 적용
 */
(function (global) {
  'use strict';

  var STORAGE_KEY = 'kusari_owner_pin';
  var MAX_REJECTS = 4;              // 잘못된 PIN 연속 거절 허용 횟수
  var memoryPin = '';               // 이 탭에서만 기억하는 PIN (기억하기 해제 시)
  var modal = null;
  var pendingResolve = null;

  /* ------------------------------------------------------------------ 저장소 */
  function readStored() {
    try { return global.localStorage.getItem(STORAGE_KEY) || ''; } catch (e) { return ''; }
  }
  function writeStored(v) {
    try { global.localStorage.setItem(STORAGE_KEY, v); } catch (e) { /* 저장 차단 환경 */ }
  }
  function clearStored() {
    try { global.localStorage.removeItem(STORAGE_KEY); } catch (e) { /* 무시 */ }
  }
  function currentPin() { return memoryPin || readStored(); }
  function hasPin() { return !!currentPin(); }

  /* --------------------------------------------------------------------- 스타일 */
  var CSS = [
    '.pinl-backdrop{position:fixed;inset:0;z-index:2147482000;display:flex;align-items:center;justify-content:center;padding:18px;background:rgba(15,23,42,.55);-webkit-backdrop-filter:blur(4px);backdrop-filter:blur(4px);}',
    '.pinl-backdrop[hidden]{display:none !important;}',
    '.pinl-card{width:min(94vw,382px);background:#fff;border-radius:18px;box-shadow:0 24px 60px rgba(15,23,42,.32);padding:22px 20px 18px;font-family:-apple-system,BlinkMacSystemFont,"Apple SD Gothic Neo","Malgun Gothic","Noto Sans KR",sans-serif;color:#1e293b;animation:pinl-pop .16s ease-out;}',
    '@keyframes pinl-pop{from{transform:translateY(8px) scale(.98);opacity:0}to{transform:none;opacity:1}}',
    '.pinl-head{display:flex;align-items:center;gap:12px;margin-bottom:14px;}',
    '.pinl-badge{flex:0 0 auto;width:44px;height:44px;border-radius:14px;background:linear-gradient(135deg,#fef3c7,#fde68a);display:flex;align-items:center;justify-content:center;font-size:22px;line-height:1;box-shadow:inset 0 0 0 1px #fcd34d;}',
    '.pinl-titles{min-width:0;}',
    '.pinl-title{margin:0;font-size:17px;font-weight:800;letter-spacing:-.2px;color:#0f172a;}',
    '.pinl-desc{margin:3px 0 0;font-size:12.5px;line-height:1.4;color:#64748b;}',
    '.pinl-msg{margin:0 0 10px;padding:9px 11px;border-radius:10px;background:#fef2f2;border:1px solid #fecaca;color:#b91c1c;font-size:12.5px;font-weight:600;line-height:1.4;}',
    '.pinl-msg[hidden]{display:none !important;}',
    '.pinl-input{width:100%;box-sizing:border-box;padding:13px 14px;font-size:17px;letter-spacing:.22em;text-align:center;border:1.5px solid #cbd5e1;border-radius:12px;background:#f8fafc;color:#0f172a;outline:none;transition:border-color .15s,box-shadow .15s;}',
    '.pinl-input:focus{border-color:#f59e0b;background:#fff;box-shadow:0 0 0 3px rgba(245,158,11,.18);}',
    '.pinl-remember{display:flex;align-items:center;gap:8px;margin:12px 2px 16px;font-size:12.5px;color:#475569;cursor:pointer;user-select:none;}',
    '.pinl-remember .pinl-check{width:15px;height:15px;accent-color:#f59e0b;cursor:pointer;}',
    '.pinl-actions{display:flex;gap:8px;}',
    '.pinl-btn{flex:1;padding:12px 10px;font-size:14px;font-weight:700;border-radius:12px;border:1px solid transparent;cursor:pointer;font-family:inherit;}',
    '.pinl-ghost{background:#f1f5f9;color:#475569;border-color:#e2e8f0;}',
    '.pinl-ghost:hover{background:#e2e8f0;}',
    '.pinl-primary{background:#f59e0b;color:#fff;box-shadow:0 4px 12px rgba(245,158,11,.32);}',
    '.pinl-primary:hover{background:#d97706;}',
    '.pinl-toast{position:fixed;left:50%;bottom:26px;transform:translateX(-50%);z-index:2147482100;max-width:88vw;padding:11px 16px;border-radius:12px;background:rgba(15,23,42,.93);color:#fff;font-size:13px;font-weight:600;line-height:1.4;font-family:-apple-system,BlinkMacSystemFont,"Apple SD Gothic Neo","Malgun Gothic","Noto Sans KR",sans-serif;box-shadow:0 10px 30px rgba(15,23,42,.3);opacity:0;transition:opacity .2s,transform .2s;pointer-events:none;}',
    '.pinl-toast.on{opacity:1;transform:translateX(-50%) translateY(-4px);}',
    '.owner-pin-bar{margin-top:10px;display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;padding-top:10px;border-top:1px dashed #e2e8f0;}',
    '.owner-pin-state{font-size:11.5px;line-height:1.4;color:#64748b;font-weight:600;}',
    '.owner-pin-reset{flex:0 0 auto;padding:6px 10px;font-size:11.5px;font-weight:700;border-radius:9px;border:1px solid #fcd34d;background:#fffbeb;color:#b45309;cursor:pointer;font-family:inherit;}',
    '.owner-pin-reset:hover{background:#fef3c7;}'
  ].join('\n');

  /* --------------------------------------------------------------------- 토스트 */
  var toastEl = null, toastTimer = null;
  function toast(msg) {
    if (!toastEl) {
      toastEl = document.createElement('div');
      toastEl.className = 'pinl-toast';
      appendToBody(toastEl);
    }
    toastEl.textContent = msg;
    toastEl.classList.add('on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { if (toastEl) toastEl.classList.remove('on'); }, 2600);
  }
  function appendToBody(el) {
    if (document.body) document.body.appendChild(el);
    else document.addEventListener('DOMContentLoaded', function () { document.body.appendChild(el); });
  }

  /* --------------------------------------------------------------------- 모달 */
  function ensureModal() {
    if (modal) return modal;

    var style = document.createElement('style');
    style.setAttribute('data-owner-pin-style', '1');
    style.textContent = CSS;
    (document.head || document.documentElement).appendChild(style);

    var wrap = document.createElement('div');
    wrap.className = 'pinl-backdrop';
    wrap.setAttribute('hidden', '');
    wrap.innerHTML =
      '<div class="pinl-card" role="dialog" aria-modal="true" aria-labelledby="pinl-title">' +
        '<div class="pinl-head">' +
          '<div class="pinl-badge" aria-hidden="true">🔒</div>' +
          '<div class="pinl-titles">' +
            '<h2 class="pinl-title" id="pinl-title">주인장 PIN 입력</h2>' +
            '<p class="pinl-desc">저장·수정·삭제는 주인장만 할 수 있습니다.</p>' +
          '</div>' +
        '</div>' +
        '<p class="pinl-msg" hidden></p>' +
        '<input class="pinl-input" type="password" inputmode="numeric" autocomplete="current-password" spellcheck="false" maxlength="32" placeholder="PIN" aria-label="주인장 PIN">' +
        '<label class="pinl-remember"><input type="checkbox" class="pinl-check" checked> <span>이 기기에 기억하기</span></label>' +
        '<div class="pinl-actions">' +
          '<button type="button" class="pinl-btn pinl-ghost" data-pinl="cancel">취소</button>' +
          '<button type="button" class="pinl-btn pinl-primary" data-pinl="ok">확인</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(wrap);

    var input = wrap.querySelector('.pinl-input');
    var check = wrap.querySelector('.pinl-check');
    var msg = wrap.querySelector('.pinl-msg');

    function close(result) {
      wrap.setAttribute('hidden', '');
      input.value = '';
      var fn = pendingResolve;
      pendingResolve = null;
      if (fn) fn(result);
    }

    function submit() {
      var v = input.value.trim();
      if (!v) {
        showMsg('PIN을 입력해 주세요.');
        input.focus();
        return;
      }
      close({ pin: v, remember: !!check.checked });
    }

    function showMsg(text) {
      if (!text) { msg.textContent = ''; msg.hidden = true; return; }
      msg.textContent = text;
      msg.hidden = false;
    }

    wrap.addEventListener('click', function (e) {
      var t = e.target;
      if (t && t.getAttribute && t.getAttribute('data-pinl') === 'cancel') { e.preventDefault(); close(null); return; }
      if (t && t.getAttribute && t.getAttribute('data-pinl') === 'ok') { e.preventDefault(); submit(); return; }
      if (t === wrap) { close(null); }
    });

    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); submit(); }
      else if (e.key === 'Escape') { e.preventDefault(); close(null); }
      e.stopPropagation();
    });
    input.addEventListener('input', function () { if (!msg.hidden) showMsg(''); });

    wrap.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { e.preventDefault(); close(null); }
      e.stopPropagation();
    });

    modal = { wrap: wrap, input: input, check: check, msg: msg, showMsg: showMsg, close: close };
    return modal;
  }

  function askPin(opts) {
    opts = opts || {};
    var m = ensureModal();
    m.showMsg(opts.message || '');
    m.input.value = '';
    m.check.checked = opts.remember !== false;
    m.wrap.removeAttribute('hidden');
    setTimeout(function () { try { m.input.focus(); } catch (e) {} }, 30);
    return new Promise(function (resolve) { pendingResolve = resolve; });
  }

  /* ------------------------------------------------------------- 인증 실패 판별 */
  function isUnauthorized(json) {
    if (!json || typeof json !== 'object') return false;
    var code = String(json.code || '').toUpperCase();
    var err = String(json.error || '').toUpperCase();
    var msg = String(json.message || json.msg || '');
    if (code === 'UNAUTHORIZED' || err === 'UNAUTHORIZED') return true;
    if (code.indexOf('UNAUTHORIZED') > -1 || err.indexOf('UNAUTHORIZED') > -1) return true;
    if (json.auth === false) return true;
    if (/주인장\s*PIN/.test(msg) || /PIN\s*이?\s*일치하지/.test(msg)) return true;
    return false;
  }

  /* --------------------------------------------------------------- 쓰기 요청 */
  /**
   * @param {string} url           Apps Script 웹앱 URL
   * @param {function} buildPayload  function (pin) { return <보낼 객체>; }
   * @param {object} [opts]        { headers, message }
   */
  function post(url, buildPayload, opts) {
    opts = opts || {};
    var rejects = 0;

    return (async function () {
      while (rejects <= MAX_REJECTS) {
        var pin = currentPin();

        if (!pin) {
          var answer = await askPin({
            message: rejects > 0
              ? 'PIN이 올바르지 않습니다. 다시 입력해 주세요.'
              : (opts.message || '')
          });
          if (!answer) {
            return { cancelled: true, json: null, text: '', unauthorized: rejects > 0 };
          }
          pin = answer.pin;
          memoryPin = pin;
          if (answer.remember) writeStored(pin);
          else clearStored();
          renderStates();
        }

        var payload = buildPayload(pin);
        if (payload && typeof payload === 'object' && payload.pin === undefined) payload.pin = pin;

        var res = await fetch(url, {
          method: 'POST',
          headers: opts.headers || undefined,
          body: typeof payload === 'string' ? payload : JSON.stringify(payload)
        });
        var text = await res.text();
        var json = null;
        try { json = JSON.parse(text); } catch (e) { json = null; }

        if (!isUnauthorized(json)) return { cancelled: false, json: json, text: text };

        // 서버가 PIN 불일치로 거절 → 잘못된 PIN을 지우고 다시 묻는다
        clearStored();
        memoryPin = '';
        renderStates();
        rejects++;
      }
      toast('🔒 PIN 인증에 실패했습니다. 잠시 후 다시 시도해 주세요.');
      return { cancelled: true, json: null, text: '', unauthorized: true };
    })();
  }

  /* ------------------------------------------------------------ 잠금·초기화 UI */
  function renderStates() {
    var nodes = document.querySelectorAll('[data-owner-pin-state]');
    if (!nodes.length) return;
    var stored = !!readStored();
    var txt = stored
      ? '🔑 주인장 PIN이 이 기기에 저장되어 있습니다.'
      : (memoryPin
        ? '🔑 이 탭에서만 PIN을 기억하고 있습니다.'
        : '🔒 저장된 PIN 없음 — 저장할 때 PIN을 묻습니다.');
    for (var i = 0; i < nodes.length; i++) nodes[i].textContent = txt;
  }

  function resetPin(skipConfirm) {
    if (!hasPin() && !readStored()) {
      renderStates();
      toast('이미 잠겨 있습니다. 저장·수정할 때 PIN을 묻습니다.');
      return;
    }
    if (!skipConfirm) {
      var ok = global.confirm('이 기기에 기억된 주인장 PIN을 지울까요?\n\n지우면 다음 저장·수정·삭제 때 PIN을 다시 입력해야 합니다.');
      if (!ok) return;
    }
    clearStored();
    memoryPin = '';
    renderStates();
    toast('🔒 잠갔습니다. 다음 저장 때 PIN을 다시 입력하게 됩니다.');
  }

  function bindGlobalUI() {
    document.addEventListener('click', function (e) {
      var t = e.target;
      if (!t || !t.closest) return;
      var btn = t.closest('[data-owner-pin-reset], #btn-owner-pin-reset');
      if (!btn) return;
      e.preventDefault();
      resetPin(false);
    });

    if (global.addEventListener) {
      global.addEventListener('storage', function (e) {
        if (e && e.key === STORAGE_KEY) renderStates();
      });
    }

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', renderStates);
    } else {
      renderStates();
    }
  }

  bindGlobalUI();

  global.OwnerPin = {
    post: post,
    askPin: askPin,
    isUnauthorized: isUnauthorized,
    hasPin: hasPin,
    reset: resetPin,
    renderStates: renderStates,
    toast: toast,
    STORAGE_KEY: STORAGE_KEY
  };
})(window);
