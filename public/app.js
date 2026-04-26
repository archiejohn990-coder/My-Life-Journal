
const API_BASE = "https://my-life-journal.onrender.com/api";
const LS_CURRENT = "journal_api_current";
const LS_THEME = "journal_ultra_theme";

const $ = (id) => document.getElementById(id);
let captchaCode = "";
let authMode = "login";
let pinHidden = true;
let editingId = null;
let editingImageB64 = null;
let currentUser = null;
let currentPosts = [];
let pending2FA = null;

function toast(type, title, msg){
  const wrap = $("toastWrap");
  const el = document.createElement("div");
  el.className = "toast" + (type ? " " + type : "");
  el.innerHTML = `
    <i class="fas ${type === "danger" ? "fa-triangle-exclamation" : type === "warn" ? "fa-circle-exclamation" : "fa-circle-check"}"></i>
    <div>
      <div class="t-title">${escapeHtml(title)}</div>
      <div class="t-msg">${escapeHtml(msg)}</div>
    </div>
    <button class="x" aria-label="Close" onclick="this.parentElement.remove()">✕</button>
  `;
  wrap.appendChild(el);
  setTimeout(() => { if (el.parentElement) el.remove(); }, 4500);
}
function escapeHtml(str){
  return String(str ?? "")
    .replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;")
    .replaceAll('"',"&quot;").replaceAll("'","&#039;");
}
function readCurrent(){ return JSON.parse(localStorage.getItem(LS_CURRENT) || "null"); }
function writeCurrent(obj){ localStorage.setItem(LS_CURRENT, JSON.stringify(obj)); }
function clearCurrent(){ localStorage.removeItem(LS_CURRENT); }

async function api(path, options={}){
  const session = readCurrent();
  const headers = {"Content-Type":"application/json", ...(options.headers||{})};
  if(session?.token) headers.Authorization = `Bearer ${session.token}`;
  const res = await fetch(`${API_BASE}${path}`, {...options, headers});
  let data = {};
  try { data = await res.json(); } catch {}
  if(!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

function applyTheme(theme){
  document.documentElement.setAttribute("data-theme", theme);
  localStorage.setItem(LS_THEME, theme);
}
function toggleTheme(){
  const cur = localStorage.getItem(LS_THEME) || "light";
  applyTheme(cur === "light" ? "dark" : "light");
}
(function initTheme(){
  const saved = localStorage.getItem(LS_THEME);
  if(saved) applyTheme(saved);
  else {
    const prefersDark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
    applyTheme(prefersDark ? "dark" : "light");
  }
})();

function validPin(pin){ return /^[0-9]{6}$/.test(pin); }
function generateCaptcha(){
  captchaCode = Math.random().toString(36).substring(2,6).toUpperCase();
  $("captchaBox").innerText = captchaCode;
  $("captchaInp").value = "";
}
function toggleMode(mode){
  authMode = mode;
  $("tabLogin").classList.toggle("active", mode === "login");
  $("tabSignup").classList.toggle("active", mode === "signup");
  $("tabLogin").setAttribute("aria-selected", mode === "login" ? "true" : "false");
  $("tabSignup").setAttribute("aria-selected", mode === "signup" ? "true" : "false");
  $("fieldName").classList.toggle("hidden", mode === "login");
  $("submitBtn").innerText = mode === "login" ? "Login" : "Create Account";
  $("pass").setAttribute("autocomplete", mode === "login" ? "current-password" : "new-password");
  generateCaptcha();
}
function toggleRecovery(show){
  $("loginFormContainer").classList.toggle("hidden", show);
  $("recoveryFormContainer").classList.toggle("hidden", !show);
  generateCaptcha();
}

async function handleRecovery(){
  const email = $("recoverEmail").value.trim().toLowerCase();
  const name  = $("recoverNameInput").value.trim();
  const newPass = $("newPass").value;
  const newPin  = $("newPin").value;
  if(!email || !name || !newPass || !newPin) return toast("warn","Missing details","Complete all recovery fields.");
  if(newPass.length < 8) return toast("warn","Weak password","Use at least 8 characters.");
  if(!validPin(newPin)) return toast("warn","Invalid PIN","PIN must be exactly 6 digits.");
  try{
    await api('/auth/recover', {method:'POST', body: JSON.stringify({email, name, newPassword:newPass, newPin})});
    toast('', 'Updated!', 'Password and PIN were reset.');
    toggleRecovery(false);
    $("recoverEmail").value = '';
    $("recoverNameInput").value = '';
    $("newPass").value = '';
    $("newPin").value = '';
  }catch(err){ toast('danger','Recovery failed', err.message); }
}

$("authForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  if(($("captchaInp").value || "").trim().toUpperCase() !== captchaCode){
    generateCaptcha();
    return toast("danger","Wrong captcha","Try again.");
  }
  const email = $("email").value.trim().toLowerCase();
  const password = $("pass").value;
  const pin = ($("pin").value || "").trim();
  if(!email || !password || !validPin(pin)) return toast('warn','Incomplete form','Enter email, password, and a valid 6-digit PIN.');
  try{
    if(authMode === 'signup'){
      const name = $("regName").value.trim();
      if(name.length < 2) return toast('warn','Name required','Enter your full name.');
      const out = await api('/auth/signup', {method:'POST', body: JSON.stringify({name, email, password, pin})});
      pending2FA = { email, password, pin, mode: 'signup' };
      show2FAOverlay(out.demoCode);
      return;
    }
    const out = await api('/auth/login', {method:'POST', body: JSON.stringify({email, password, pin})});
    pending2FA = { email, password, pin, mode: 'login' };
    show2FAOverlay(out.demoCode);
  }catch(err){
    generateCaptcha();
    toast('danger', authMode === 'signup' ? 'Signup failed' : 'Login failed', err.message);
  }
});

function ensure2FAModal(){
  if(document.getElementById('twofaBackdrop')) return;
  const div = document.createElement('div');
  div.className = 'modal-backdrop';
  div.id = 'twofaBackdrop';
  div.innerHTML = `
    <div class="modal" style="max-width:460px;">
      <div class="modal-head"><h3>Two-Factor Verification</h3></div>
      <div class="modal-body">
        <div class="card notice" style="margin:0 0 12px 0;">
          <div style="font-weight:900; margin-bottom:6px;">Backend-connected 2FA</div>
          <div class="muted">Enter the 6-digit code from the backend. Demo code appears below while testing locally.</div>
        </div>
        <div class="field"><div class="label">One-Time Code</div><input id="twofaCode" class="input" maxlength="6" placeholder="123456"></div>
        <div class="hint" id="twofaHint" style="text-align:left; margin-top:10px;"></div>
      </div>
      <div class="modal-foot">
        <button class="btn-ghost" onclick="close2FA()">Cancel</button>
        <button class="btn-inline" onclick="submit2FA()">Verify</button>
      </div>
    </div>`;
  document.body.appendChild(div);
}
function show2FAOverlay(demoCode){
  ensure2FAModal();
  $('twofaBackdrop').style.display = 'flex';
  $('twofaCode').value = '';
  $('twofaHint').innerHTML = demoCode ? `Demo code: <span class="kbd">${escapeHtml(demoCode)}</span>` : 'Check your authenticator or email service.';
}
function close2FA(){
  if($('twofaBackdrop')) $('twofaBackdrop').style.display = 'none';
  pending2FA = null;
}
async function submit2FA(){
  const code = ($('twofaCode').value || '').trim();
  if(!pending2FA) return toast('warn','No pending login','Start login again.');
  if(!/^\d{6}$/.test(code)) return toast('warn','Invalid code','Enter the 6-digit code.');
  try{
    const out = await api('/auth/verify-2fa', {method:'POST', body: JSON.stringify({...pending2FA, code})});
    writeCurrent({ token: out.token });
    currentUser = out.user;
    close2FA();
    afterLogin();
  }catch(err){ toast('danger','2FA failed', err.message); }
}

async function afterLogin(){
  $("authSection").style.display = "none";
  $("app").style.display = "block";
  await hydrateUserUI();
  showView('home');
  await refreshAll();
  toast('', 'Welcome', 'Your account is now connected to the backend.');
}
async function hydrateUserUI(){
  if(!currentUser){
    const out = await api('/me');
    currentUser = out.user;
  }
  const me = currentUser;
  $("userGreet").innerText = me.name;
  $("userEmailSmall").innerText = me.email;
  $("profName").innerText = me.name;
  $("profEmail").innerText = me.email;
  const fallback = `https://ui-avatars.com/api/?background=10b981&color=fff&name=${encodeURIComponent(me.name || 'User')}`;
  $("userAvatar").src = me.photo || fallback;
  $("topAvatar").src = me.photo || fallback;
  $("pinText").innerText = '••••••';
  $("pinToggle").className = 'fas fa-eye';
  pinHidden = true;
}
function toggleDrawer(){
  const side = $("sidebar");
  const back = $("drawerBackdrop");
  const open = !side.classList.contains("open");
  side.classList.toggle("open", open);
  back.classList.toggle("show", open);
}
function closeDrawer(){
  $("sidebar").classList.remove("open");
  $("drawerBackdrop").classList.remove("show");
}
function showView(v){
  ['home','diary','stats','settings'].forEach(id => $('view-'+id).classList.add('hidden'));
  $('view-'+v).classList.remove('hidden');
  document.querySelectorAll('.nav a').forEach(a => a.classList.remove('active'));
  $('nav-'+v).classList.add('active');
  if(window.innerWidth <= 820) closeDrawer();
  if(v === 'stats') updateStats();
}
function togglePinVisibility(){
  pinHidden = !pinHidden;
  $('pinText').innerText = pinHidden ? '••••••' : 'Stored securely in backend';
  $('pinToggle').className = pinHidden ? 'fas fa-eye' : 'fas fa-eye-slash';
}
function normalizeEntry(e){
  const nowIso = new Date().toISOString();
  return {
    id: e.id,
    title: String(e.title || '').slice(0,120),
    body: String(e.body || ''),
    mood: e.mood || '😐 Neutral',
    tags: Array.isArray(e.tags) ? e.tags : [],
    date: e.entry_date || e.date || nowIso.slice(0,10),
    createdAt: e.created_at || e.createdAt || nowIso,
    editedAt: e.updated_at || e.editedAt || '',
    image: e.image || null
  };
}
function extractInlineTags(text){
  const matches = (text.match(/(^|\s)#([a-zA-Z0-9_\-]{2,})/g) || []).map(m => m.trim().replace('#','').toLowerCase());
  return Array.from(new Set(matches));
}
async function fetchEntries(){
  const out = await api('/entries');
  currentPosts = (out.entries || []).map(normalizeEntry);
  return currentPosts;
}
async function quickSave(){
  const title = ($('quickTitle').value || '').trim();
  const mood = $('quickMood').value;
  const tags = ($('quickTags').value || '').split(',').map(t => t.trim()).filter(Boolean).map(t => t.toLowerCase());
  const body = ($('quickBody').value || '').trim();
  if(!body && !title) return toast('warn','Empty entry','Write something first.');
  const mergedTags = Array.from(new Set([...tags, ...extractInlineTags(body)]));
  try{
    await api('/entries', {method:'POST', body: JSON.stringify({title, body, mood, tags: mergedTags, date: new Date().toISOString().slice(0,10), image:null})});
    $('quickTitle').value = ''; $('quickTags').value = ''; $('quickBody').value = '';
    toast('', 'Saved', 'Quick memory added.');
    await refreshAll();
  }catch(err){ toast('danger','Save failed', err.message); }
}
function openEditor(entry){
  editingId = entry?.id || null;
  editingImageB64 = entry?.image || null;
  $('editorTitle').innerText = editingId ? 'Edit Entry' : 'New Entry';
  $('eTitle').value = entry?.title || '';
  $('eMood').value = entry?.mood || '😐 Neutral';
  $('eTags').value = (entry?.tags || []).join(', ');
  $('eDate').value = entry?.date || new Date().toISOString().slice(0,10);
  $('eBody').value = entry?.body || '';
  $('eImage').value = '';
  $('imagePreview').classList.toggle('hidden', !editingImageB64);
  if(editingImageB64) $('imagePreview').src = editingImageB64;
  updatePreview();
  $('editorBackdrop').style.display = 'flex';
}
function closeEditor(){ $('editorBackdrop').style.display = 'none'; editingId = null; editingImageB64 = null; }
function openAbout(){ $('aboutBackdrop').style.display = 'flex'; }
function closeAbout(){ $('aboutBackdrop').style.display = 'none'; }
function basicMarkdownToHtml(text){
  let t = escapeHtml(text);
  t = t.replace(/^###\s(.+)$/gm, '<h3>$1</h3>').replace(/^##\s(.+)$/gm, '<h2>$1</h2>').replace(/^#\s(.+)$/gm, '<h1>$1</h1>');
  t = t.replace(/^>\s(.+)$/gm, '<blockquote>$1</blockquote>');
  t = t.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\n/g, '<br>');
  return t;
}
function updatePreview(){ $('preview').innerHTML = ($('eBody').value || '').trim() ? basicMarkdownToHtml($('eBody').value) : 'Start typing to see preview…'; }
$('eBody').addEventListener('input', updatePreview);
function loadEntryImage(e){
  const file = e.target.files && e.target.files[0];
  if(!file) return;
  if(file.size > 1_000_000){ e.target.value=''; return toast('warn','Image too large','Choose an image under ~1MB.'); }
  const reader = new FileReader();
  reader.onload = () => { editingImageB64 = reader.result; $('imagePreview').src = editingImageB64; $('imagePreview').classList.remove('hidden'); };
  reader.readAsDataURL(file);
}
async function saveFromEditor(){
  const title = ($('eTitle').value || '').trim();
  const mood = $('eMood').value;
  const date = $('eDate').value || new Date().toISOString().slice(0,10);
  const body = ($('eBody').value || '').trim();
  const tags = ($('eTags').value || '').split(',').map(t => t.trim()).filter(Boolean).map(t => t.toLowerCase());
  if(!title && !body) return toast('warn','Empty entry','Add a title or body.');
  const mergedTags = Array.from(new Set([...tags, ...extractInlineTags(body)]));
  try{
    const payload = {title, mood, date, body, tags: mergedTags, image: editingImageB64 || null};
    if(editingId) await api(`/entries/${editingId}`, {method:'PUT', body: JSON.stringify(payload)});
    else await api('/entries', {method:'POST', body: JSON.stringify(payload)});
    closeEditor();
    toast('', editingId ? 'Updated' : 'Saved', editingId ? 'Entry saved.' : 'New entry added.');
    await refreshAll();
  }catch(err){ toast('danger','Save failed', err.message); }
}
async function renderDiary(){
  const posts = await fetchEntries();
  const term = ($('diarySearch').value || '').trim().toLowerCase();
  const sortMode = $('sortMode').value;
  const dateFilter = $('dateFilter').value;
  const moodFilter = $('moodFilter').value;
  const sorted = [...posts].sort((a,b) => sortMode === 'oldest' ? new Date(a.createdAt)-new Date(b.createdAt) : new Date(b.createdAt)-new Date(a.createdAt));
  const filtered = sorted.filter(p => {
    const hay = (p.title + ' ' + p.body + ' ' + (p.tags || []).join(' ')).toLowerCase();
    return (!term || hay.includes(term)) && (!dateFilter || p.date === dateFilter) && (!moodFilter || p.mood === moodFilter);
  });
  $('entryCount').innerText = `${posts.length} entries`;
  if(filtered.length === 0){ $('diaryContainer').innerHTML = '<div class="card empty">No matching entries found.</div>'; return; }
  $('diaryContainer').innerHTML = filtered.map(p => {
    const tags = (p.tags || []).slice(0, 8).map(t => `<span class="chip"><i class="fas fa-hashtag"></i> ${escapeHtml(t)}</span>`).join('');
    const meta = `${escapeHtml(p.date)} • ${escapeHtml(p.mood)}${p.editedAt ? ' • edited' : ''}`;
    const img = p.image ? `<img class="thumb" src="${p.image}" alt="attachment">` : '';
    return `<div class="card"><div class="entry"><div style="flex:1;"><small>${meta}</small>${p.title ? `<h4>${escapeHtml(p.title)}</h4>` : ''}<p>${escapeHtml(p.body)}</p>${img}<div class="chips">${tags}</div></div><div class="entry-actions"><button class="iconbtn" onclick="editEntry('${p.id}')"><i class="fas fa-pen"></i></button><button class="iconbtn danger" onclick="deleteEntry('${p.id}')"><i class="fas fa-trash"></i></button></div></div></div>`;
  }).join('');
}
async function editEntry(id){ const entry = currentPosts.find(p => String(p.id) === String(id)); if(entry) openEditor(entry); }
async function deleteEntry(id){
  if(!confirm('Delete this entry?')) return;
  try{ await api(`/entries/${id}`, {method:'DELETE'}); toast('','Deleted','Entry removed.'); await refreshAll(); }catch(err){ toast('danger','Delete failed', err.message); }
}
async function updateStats(){
  const posts = currentPosts.length ? currentPosts : await fetchEntries();
  $('kpiTotal').innerText = String(posts.length);
  const dates = new Set(posts.map(p => p.date));
  let streak = 0;
  for(let d = new Date(); ; ){
    const iso = new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,10);
    if(dates.has(iso)) streak++; else break;
    d.setDate(d.getDate()-1);
  }
  $('kpiStreak').innerText = String(streak);
  const ym = new Date().toISOString().slice(0,7);
  $('kpiThisMonth').innerText = String(posts.filter(p => (p.date || '').slice(0,7) === ym).length);
  drawChart(posts);
}
function drawChart(posts){
  const c = $('chart'); const ctx = c.getContext('2d');
  const dpr = window.devicePixelRatio || 1; const cssW = c.clientWidth || 600; const cssH = c.clientHeight || 160;
  c.width = Math.floor(cssW*dpr); c.height = Math.floor(cssH*dpr); ctx.setTransform(dpr,0,0,dpr,0,0);
  const now = new Date(); const labels=[]; const counts=[];
  for(let i=11;i>=0;i--){ const d = new Date(now.getFullYear(), now.getMonth()-i, 1); const key = d.toISOString().slice(0,7); labels.push(key); counts.push(posts.filter(p => (p.date || '').slice(0,7) === key).length); }
  const W=cssW,H=cssH,pad=18,max=Math.max(1,...counts),barW=(W-pad*2)/counts.length; ctx.clearRect(0,0,W,H);
  ctx.globalAlpha=.25; ctx.strokeStyle=getComputedStyle(document.documentElement).getPropertyValue('--border');
  for(let i=0;i<=4;i++){ const y=pad+(H-pad*2)*(i/4); ctx.beginPath(); ctx.moveTo(pad,y); ctx.lineTo(W-pad,y); ctx.stroke(); }
  ctx.globalAlpha=1;
  const primary = getComputedStyle(document.documentElement).getPropertyValue('--primary').trim() || '#10b981';
  for(let i=0;i<counts.length;i++){
    const v=counts[i], bh=(H-pad*2)*(v/max), x=pad+i*barW+6, y=H-pad-bh, bw=Math.max(6,barW-12);
    ctx.fillStyle=hexToRgba(primary,.6); ctx.fillRect(x,y,bw,bh); ctx.fillStyle=hexToRgba(primary,.95); ctx.fillRect(x,y+bh-3,bw,3);
  }
  ctx.fillStyle=getComputedStyle(document.documentElement).getPropertyValue('--muted'); ctx.font='12px system-ui';
  [0,5,11].forEach(i => { const x=pad+i*barW+6; ctx.fillText(labels[i],x,H-4); });
}
function hexToRgba(hex,a){ const h=hex.replace('#','').trim(); const full=h.length===3?h.split('').map(c=>c+c).join(''):h.padEnd(6,'0').slice(0,6); return `rgba(${parseInt(full.slice(0,2),16)},${parseInt(full.slice(2,4),16)},${parseInt(full.slice(4,6),16)},${a})`; }
function uploadPhoto(e){
  const file = e.target.files && e.target.files[0];
  if(!file) return;
  if(file.size > 2_000_000) return toast('warn','Too large','Please choose an image under 2MB.');
  const reader = new FileReader();
  reader.onload = async () => {
    try{ const out = await api('/profile/photo', {method:'PUT', body: JSON.stringify({photo: reader.result})}); currentUser = out.user; await hydrateUserUI(); toast('','Updated','Profile photo updated.'); }
    catch(err){ toast('danger','Upload failed', err.message); }
  };
  reader.readAsDataURL(file);
}
async function resetPhoto(){ try{ const out = await api('/profile/photo', {method:'PUT', body: JSON.stringify({photo:null})}); currentUser=out.user; await hydrateUserUI(); toast('','Reset','Profile photo reset.'); }catch(err){ toast('danger','Reset failed', err.message); } }
async function exportData(){
  try{ const out = await api('/export');
    const blob = new Blob([JSON.stringify(out, null, 2)], {type:'application/json'});
    const url = URL.createObjectURL(blob); const a = document.createElement('a');
    a.href = url; a.download = `journal_backup_${(currentUser?.name || 'user').replaceAll(' ','_')}.json`; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
    toast('','Exported','Backup downloaded from backend.');
  }catch(err){ toast('danger','Export failed', err.message); }
}
function importData(event){
  const file = event.target.files && event.target.files[0];
  if(!file) return;
  const reader = new FileReader();
  reader.onload = async () => {
    try{ const payload = JSON.parse(reader.result); await api('/import', {method:'POST', body: JSON.stringify(payload)}); toast('','Imported','Backup restored into the backend database.'); await refreshAll(); }
    catch(err){ toast('danger','Import failed', err.message); }
    finally { event.target.value = ''; }
  };
  reader.readAsText(file);
}
async function wipeMyData(){ if(!confirm('This will delete your account and diary from the backend database. Continue?')) return; try{ await api('/me', {method:'DELETE'}); toast('','Deleted','Your account was removed.'); logout(false); }catch(err){ toast('danger','Delete failed', err.message); } }
function logout(showToast){ if(showToast) toast('','Logged out','See you next time!'); clearCurrent(); currentUser = null; currentPosts = []; location.reload(); }
async function refreshAll(){ await renderDiary(); await updateStats(); }
document.addEventListener('keydown', (e) => {
  if(e.ctrlKey && e.key.toLowerCase() === 'k' && $('app').style.display !== 'none'){ e.preventDefault(); openEditor(); }
  if($('editorBackdrop').style.display === 'flex'){
    if(e.key === 'Escape'){ e.preventDefault(); closeEditor(); }
    if(e.ctrlKey && e.key === 'Enter'){ e.preventDefault(); saveFromEditor(); }
  }
});
window.addEventListener('load', async () => {
  generateCaptcha(); toggleMode('login');
  const cur = readCurrent();
  if(cur?.token){
    try{ const out = await api('/me'); currentUser = out.user; await afterLogin(); }
    catch{ clearCurrent(); toast('warn','Session expired','Please log in again.'); }
  }
});
document.querySelectorAll('input, textarea').forEach(el => {
  el.addEventListener('focus', () => {
    setTimeout(() => {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 300);
  });
});
let touchStartX = 0;

document.addEventListener('touchstart', e => {
  touchStartX = e.touches[0].clientX;
});

document.addEventListener('touchend', e => {
  const touchEndX = e.changedTouches[0].clientX;

  if (touchStartX < 50 && touchEndX > 120) {
    toggleDrawer(); // swipe right → open
  }

  if (touchStartX > 200 && touchEndX < 100) {
    closeDrawer(); // swipe left → close
  }
});
document.addEventListener("DOMContentLoaded", () => {
  try {
    genCaptcha();
  } catch(e) {
    console.log("Captcha error:", e);
  }

  try {
    loadTheme();
  } catch(e) {
    console.log("Theme error:", e);
  }
});