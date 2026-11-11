/* Login + data loading for the NIAT fee dashboard.
   The database (Row Level Security) only returns rows for the universities
   linked to the logged-in email, so nothing about other universities reaches the browser. */
(function () {
  const DATASETS = ['dates_2025', 'dates_2026', 'tracker_2025', 'tracker_2026', 'sheet9', 'contacts', 'regional_cos', 'uni_meta'];
  const sb = window.supabase.createClient(window.NIAT_CONFIG.supabaseUrl, window.NIAT_CONFIG.supabaseAnonKey);
  const files = {};
  const calcs = {}, draws = {}, cache = {};
  let params = { batch: 'all' };
  let ready = false;

  const get = (id) => {
    if (id in cache) return cache[id];
    let out;
    try {
      if (files[id]) out = { status: 'ok', data: files[id] };
      else if (calcs[id]) out = { status: 'ok', data: calcs[id].fn(...calcs[id].inputs.map((i) => { const r = get(i); if (r.status !== 'ok') throw new Error(i); return r.data; })) };
      else out = { status: ready ? 'error' : 'loading', data: [] };
    } catch (e) { console.error(id, e); out = { status: 'error', data: [] }; }
    out.columns = out.data[0] ? Object.keys(out.data[0]) : [];
    if (ready) cache[id] = out;
    return out;
  };
  const runDraw = (name) => document.querySelectorAll('[data-draw="' + name + '"]').forEach((el) => {
    if (el.closest('[hidden]')) return;
    try { draws[name](el); } catch (e) { console.error(name, e); }
  });
  const runAll = () => { if (ready) Object.keys(draws).forEach(runDraw); };

  window.dash = {
    colors: ['var(--nf-c1)', 'var(--nf-c2)'],
    loader: () => {},
    calc: (id, o) => { calcs[id] = o; },
    data: (id) => get(id),
    draw: (name, fn) => { if (fn) draws[name] = fn; else if (draws[name] && ready) runDraw(name); },
    params: () => params,
    setParams: (p) => { params = Object.assign({}, params, p); runAll(); },
    setLink: (name) => { try { history.replaceState(null, '', '#' + name); } catch (e) {} setTimeout(runAll, 0); },
  };

  const $ = (id) => document.getElementById(id);
  const msg = (t, bad) => { const m = $('lg-msg'); m.textContent = t || ''; m.classList.toggle('bad', !!bad); };
  const showLogin = () => { $('login').hidden = false; $('app').hidden = true; $('userbar').hidden = true; };

  async function loadRows() {
    const all = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await sb.from('fee_rows').select('dataset,row').order('id').range(from, from + 999);
      if (error) throw error;
      all.push(...data);
      if (data.length < 1000) break;
    }
    DATASETS.forEach((d) => { files[d] = []; });
    all.forEach((r) => { (files[r.dataset] = files[r.dataset] || []).push(r.row); });
  }

  async function enter() {
    const { data: access, error } = await sb.rpc('my_access');
    if (error) { showLogin(); msg('Could not check your access: ' + error.message, true); return; }
    if (!access) {
      await sb.auth.signOut();
      showLogin(); msg('This email has no access to the dashboard. Ask the central team to add you.', true);
      return;
    }
    try { await loadRows(); } catch (e) { showLogin(); msg('Could not load data: ' + e.message, true); return; }
    $('ub-name').textContent = access.name;
    $('ub-scope').textContent = access.all_access ? 'All universities' : `${access.universities.length} universit${access.universities.length === 1 ? 'y' : 'ies'}`;
    $('login').hidden = true; $('userbar').hidden = false; $('app').hidden = false;
    ready = true;
    Object.keys(cache).forEach((k) => delete cache[k]);
    runAll();
  }

  window.addEventListener('DOMContentLoaded', async () => {
    let email = '';
    $('lg-email-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      email = $('lg-email').value.trim().toLowerCase();
      msg('Checking…');
      const { data: allowed, error: aErr } = await sb.rpc('email_allowed', { e: email });
      if (aErr) { msg('Something went wrong: ' + aErr.message, true); return; }
      if (!allowed) { msg('This email has no access to the dashboard. Ask the central team to add you.', true); return; }
      const { error } = await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: location.origin + location.pathname } });
      if (error) { msg(error.message, true); return; }
      $('lg-sent-to').textContent = email;
      $('lg-email-form').hidden = true; $('lg-code-form').hidden = false; msg('');
      $('lg-code').focus();
    });
    $('lg-code-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      msg('Checking code…');
      const { error } = await sb.auth.verifyOtp({ email, token: $('lg-code').value.trim(), type: 'email' });
      if (error) { msg(error.message, true); return; }
      msg('');
    });
    const on = (id, ev, fn) => { const el = $(id); if (el) el.addEventListener(ev, fn); };
    on('lg-to-pw', 'click', () => { $('lg-email-form').hidden = true; $('lg-pw-form').hidden = false; msg(''); $('lg-pw-email').focus(); });
    on('lg-to-email', 'click', () => { $('lg-pw-form').hidden = true; $('lg-email-form').hidden = false; msg(''); });
    on('lg-pw-form', 'submit', async (e) => {
      e.preventDefault();
      msg('Logging in…');
      const { error } = await sb.auth.signInWithPassword({ email: $('lg-pw-email').value.trim().toLowerCase(), password: $('lg-pw').value });
      if (error) { msg(error.message === 'Invalid login credentials' ? 'Wrong email or password.' : error.message, true); return; }
      msg('');
    });
    $('lg-back').addEventListener('click', () => { $('lg-code-form').hidden = true; $('lg-email-form').hidden = false; msg(''); });
    $('ub-logout').addEventListener('click', async () => { await sb.auth.signOut(); location.reload(); });

    let t;
    window.addEventListener('resize', () => { clearTimeout(t); t = setTimeout(runAll, 150); });

    sb.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_IN' && session && !ready) setTimeout(enter, 0);
    });
    const { data: { session } } = await sb.auth.getSession();
    if (session) enter(); else showLogin();
  });
})();
