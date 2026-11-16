cat << 'EOF' > manifest.json
{
  "display_name": "双击就地编辑 (稳固版)",
  "loading_order": 100,
  "requires": [],
  "optional": [],
  "js": "index.js",
  "author": "Custom",
  "version": "1.0.0"
}
EOF

cat << 'EOF' > index.js
const STYLE_ID = 'st-stable-inplace-edit-style';
const BTN_CLASS = 'st-stable-edit-save-btn';
const HOST_CLASS = 'st-stable-edit-host';
const TA_CLASS = 'st-stable-edit-ta';

let currentSession = null;

function ensureStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const st = document.createElement('style');
    st.id = STYLE_ID;
    st.textContent = `
        #chat .mes_text .${TA_CLASS} {
            display: block !important;
            width: 100% !important;
            box-sizing: border-box !important;
            margin: 0 !important;
            padding: 0 !important;
            border: 0 !important;
            background: transparent !important;
            outline: none !important;
            box-shadow: none !important;
            color: inherit;
            font: inherit;
            line-height: inherit;
            letter-spacing: inherit;
            text-align: inherit;
            white-space: pre-wrap;
            overflow-wrap: break-word;
            resize: none !important;
            overflow: hidden !important;
            min-height: 1.2em !important;
        }
        #chat .mes_text.${HOST_CLASS} > :not(.${TA_CLASS}) {
            display: none !important;
        }
        .${BTN_CLASS} {
            position: fixed;
            z-index: 9999;
            width: 36px;
            height: 36px;
            min-width: 36px;
            min-height: 36px;
            padding: 0;
            margin: 0;
            box-sizing: border-box;
            border-radius: 8px;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 1.1em;
            cursor: pointer;
            box-shadow: 0 2px 10px rgba(0,0,0,0.3);
            transition: transform 0.1s ease;
        }
        .${BTN_CLASS}:hover {
            transform: scale(1.08);
        }
    `;
    document.head.appendChild(st);
}

function autoResize(ta) {
    if (!ta) return;
    ta.style.height = '0px';
    ta.style.height = ta.scrollHeight + 'px';
}

function placeButton(sess) {
    if (!sess || !sess.btn || !sess.ta || !document.body.contains(sess.btn)) return;
    const taRect = sess.ta.getBoundingClientRect();
    const bw = sess.btn.offsetWidth || 36;
    const bh = sess.btn.offsetHeight || 36;

    let top = (sess.clickY !== null && sess.clickY !== undefined) ? (sess.clickY - bh / 2) : (window.innerHeight / 2);
    top = Math.max(60, Math.min(window.innerHeight - bh - 60, Math.max(taRect.top, Math.min(taRect.bottom - bh, top))));
    let left = Math.min(window.innerWidth - bw - 12, taRect.right - bw - 6);

    sess.btn.style.left = Math.round(left) + 'px';
    sess.btn.style.top = Math.round(top) + 'px';
}

function dropSession() {
    if (!currentSession) return;
    const s = currentSession;
    currentSession = null;
    if (s.btn && s.btn.parentNode) s.btn.parentNode.removeChild(s.btn);
    if (s.ta && s.ta.parentNode) s.ta.parentNode.removeChild(s.ta);
    if (s.mesText) s.mesText.classList.remove(HOST_CLASS);
}

async function commitEdit(sess) {
    if (!sess) return;
    const ctx = window.SillyTavern?.getContext?.();
    if (!ctx || !ctx.chat || !ctx.chat[sess.mesid]) {
        dropSession();
        return;
    }

    const newText = sess.ta.value;
    const mesid = sess.mesid;
    const mes = ctx.chat[mesid];

    mes.mes = newText;
    if (mes.swipe_id !== undefined && Array.isArray(mes.swipes)) {
        mes.swipes[mes.swipe_id] = newText;
    }

    dropSession();

    try {
        if (ctx.eventSource && ctx.eventTypes) {
            await ctx.eventSource.emit(ctx.eventTypes.MESSAGE_EDITED, mesid);
        }
        if (window.TavernHelper?.refreshOneMessage) {
            await window.TavernHelper.refreshOneMessage(mesid);
        } else if (typeof updateMessageBlock === 'function') {
            updateMessageBlock(mesid, mes);
        }
        if (ctx.eventSource && ctx.eventTypes) {
            await ctx.eventSource.emit(ctx.eventTypes.MESSAGE_UPDATED, mesid);
        }
        if (typeof saveChatConditional === 'function') {
            await saveChatConditional();
        } else if (ctx.saveChat) {
            await ctx.saveChat();
        }
    } catch (e) {
        console.warn('[双击就地编辑] 保存写盘失败:', e);
    }
}

function enterEdit(mesid, mesEl, mesText, clickY) {
    dropSession();
    ensureStyles();

    const ctx = window.SillyTavern?.getContext?.();
    const mes = ctx?.chat?.[mesid];
    if (!mes) return;

    const raw = String(mes.mes || '');
    const ta = document.createElement('textarea');
    ta.className = TA_CLASS + ' mdHotkeys';
    ta.spellcheck = false;
    ta.value = raw;

    mesText.classList.add(HOST_CLASS);
    mesText.appendChild(ta);
    autoResize(ta);

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'menu_button ' + BTN_CLASS;
    btn.title = '保存 (Ctrl+Enter 或 Ctrl+S)';
    btn.innerHTML = '<i class="fa-solid fa-save"></i>';

    const stop = (e) => e.stopPropagation();
    btn.addEventListener('mousedown', stop);
    btn.addEventListener('pointerdown', stop);
    btn.addEventListener('dblclick', stop);
    btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        commitEdit(currentSession);
    });

    document.body.appendChild(btn);

    const sess = {
        mesid, mesEl, mesText, ta, btn, clickY
    };
    currentSession = sess;

    placeButton(sess);
    ta.focus();

    ta.addEventListener('input', () => {
        autoResize(ta);
        placeButton(sess);
    });

    ta.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            dropSession();
        } else if ((e.ctrlKey || e.metaKey) && (e.key === 'Enter' || e.key === 's' || e.key === 'S')) {
            e.preventDefault();
            e.stopPropagation();
            commitEdit(sess);
        }
    });

    const onReposition = () => placeButton(sess);
    const chatEl = document.getElementById('chat');
    if (chatEl) chatEl.addEventListener('scroll', onReposition, { passive: true });
    window.addEventListener('resize', onReposition);
}

document.addEventListener('dblclick', (ev) => {
    if (ev.target.closest(`.${TA_CLASS}`)) return;
    if (document.getElementById('curEditTextarea')) return;

    const mesText = ev.target.closest('#chat .mes_text');
    if (!mesText) return;
    const mesEl = mesText.closest('.mes');
    if (!mesEl) return;
    const mesid = Number(mesEl.getAttribute('mesid'));
    if (!Number.isFinite(mesid)) return;

    const dm = document.getElementById('dialogue_del_mes');
    if (dm && getComputedStyle(dm).display !== 'none') return;

    ev.preventDefault();
    enterEdit(mesid, mesEl, mesText, ev.clientY);
}, true);

console.log('[双击就地编辑] 独立稳固版已成功挂载。');
EOF
